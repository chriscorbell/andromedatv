import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import type { Database } from "sqlite";
import { computeScheduleRefreshDelay, SchedulePayload } from "./schedule";
import { runExclusiveTransaction } from "./sqlite-transaction";
import {
    advancePlayoutQueue,
    getCurrentPlayoutQueueItem,
    projectPlayoutQueue,
    PlayoutQueueAsset,
    PlayoutQueueChannelState,
    PlayoutQueueSnapshot,
    resolvePlayoutQueueCursor,
} from "./playout-queue";
import { reconcileLibrary } from "./library-reconciliation";
import {
    MetadataAuthorityCache,
    MetadataAuthorityEpisode,
    MetadataAuthoritySeries,
    MetadataAuthoritySource,
    normalizeEpisodeNumber,
    normalizeMetadataLookupKey,
    resolveMetadataAuthority,
    resolveMetadataAuthoritySeriesTitle,
} from "./metadata-authority";
import { parseSidecarOverride, SIDECAR_FILE_NAME, type SidecarOverride } from "./sidecar-override";

const execFileAsync = promisify(execFile);

const PROBE_CONCURRENCY = 8;
const DEFAULT_PLAYOUT_PROJECTION_MAX_STEPS = 10_000;
export const INTERNAL_SCHEDULE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
    ".avi",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".webm",
]);

export type MediaProbeFacts = {
    durationSeconds: number;
    videoCodec?: string | null;
    audioCodec?: string | null;
};

export type MediaProbe = (filePath: string) => Promise<MediaProbeFacts>;

export type InternalScheduleOptions = {
    db: Database;
    seriesRoot: string;
    bumpsRoot: string;
    seriesAllowlist?: string[];
    now?: () => Date;
    random?: () => number;
    probeMediaAsset?: MediaProbe;
};

export type InternalScheduleDiagnostics = {
    configured: boolean;
    seriesRoot: string | null;
    bumpsRoot: string | null;
    seriesAllowlist: string[];
    lastScanAt: string | null;
    lastError: string | null;
    scannedEpisodeAssets: number;
    scannedBumpAssets: number;
    scannerDiagnostics: string[];
    unresolvedEpisodeAssets: UnresolvedEpisodeAssetDiagnostic[];
    excludedSeries: ExcludedSeriesDiagnostic[];
    channelState: InternalChannelStateDiagnostic | null;
};

type MediaRole = "episode" | "bump";

type InternalChannelStateDiagnostic = {
    currentRotationIndex: number;
    bumpCursor: number;
    currentMediaRole: MediaRole;
    seriesRotation: string[];
    episodeCursors: Array<{
        seriesTitle: string;
        episodeIndex: number;
    }>;
};

type UnresolvedEpisodeAssetDiagnostic = {
    filePath: string;
    reason: string;
    seriesTitle: string;
};

type ExcludedSeriesDiagnostic = {
    reason: string;
    seriesTitle: string;
};

type ScannedAsset = {
    role: MediaRole;
    filePath: string;
    title: string;
    seriesTitle: string | null;
    sortKey: string;
    durationSeconds: number;
    videoCodec?: string | null;
    audioCodec?: string | null;
    mtimeMs?: number | null;
    fileSize?: number | null;
    anidbSeriesId?: number | null;
    anidbEpisodeId?: number | null;
    episodeNumber?: string | null;
    summary?: string | null;
    airDate?: string | null;
    chronologicalOrder?: number | null;
    metadataSource?: MetadataAuthoritySource | null;
};

type MediaAssetRow = {
    id: number;
    role: MediaRole;
    file_path: string;
    series_title: string | null;
    title: string;
    duration_seconds: number | null;
    summary: string | null;
};

type ChannelStateRow = {
    id: number;
    current_rotation_index: number;
    bump_cursor: number;
    current_media_role: MediaRole;
};

type EpisodeCursorRow = {
    media_file_path: string | null;
    series_title: string;
    episode_index: number;
};

type SeriesRotationRow = {
    series_title: string;
};

type PositionedSeriesRotationRow = SeriesRotationRow & {
    position: number;
};

type AnidbSeriesRow = {
    anidb_series_id: number;
    title: string;
    sort_title: string | null;
    synonyms_json: string;
};

type AnidbEpisodeRow = {
    anidb_episode_id: number;
    anidb_series_id: number;
    episode_number: string;
    title: string;
    summary: string | null;
    air_date: string | null;
    chronological_order: number;
};

type MetadataCache = MetadataAuthorityCache;

type EpisodeFileEntry = {
    filePath: string;
    fileName: string;
    relativePath: string;
};

type SchedulableSeriesRow = {
    episode_count: number;
    series_title: string;
};

type EpisodeCursorTargetRow = {
    file_path: string;
    series_title: string;
};

export type InternalMediaAsset = {
    id: number;
    role: MediaRole;
    filePath: string;
    seriesTitle: string | null;
    title: string;
    durationSeconds: number;
};

export type InternalPlayoutPlanStep = {
    index: number;
    mediaAsset: InternalMediaAsset;
    startAt: Date;
    stopAt: Date;
};

export type InternalPlayoutPlan = {
    currentState: PlayoutQueueChannelState;
    finalState: PlayoutQueueChannelState;
    mediaAsset: InternalMediaAsset;
    resumeMode: "boundary" | "wall-clock";
    resumeReason: string;
    startOffsetSeconds: number;
    steps: InternalPlayoutPlanStep[];
};

export type InternalPlayoutPlanOptions = {
    canSeekMediaAsset?: (mediaAsset: InternalMediaAsset) => boolean;
    horizonMs: number;
    maxSteps?: number;
};

type FfprobeJson = {
    format?: {
        duration?: string;
    };
    streams?: Array<{
        codec_name?: string;
        codec_type?: string;
    }>;
};

const channelStateInitializationLocks = new WeakMap<Database, Promise<void>>();

function naturalCompare(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function toSidecarRelativePath(seriesPath: string, filePath: string): string {
    return path.relative(seriesPath, filePath).split(path.sep).join("/");
}

function getMediaTitle(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
}

function isSupportedMediaFile(fileName: string): boolean {
    return SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export async function probeMediaAssetWithFfprobe(filePath: string): Promise<MediaProbeFacts> {
    const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name",
        "-of",
        "json",
        filePath,
    ]);
    const parsed = JSON.parse(stdout) as FfprobeJson;
    const durationSeconds = Number(parsed.format?.duration);

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error("ffprobe did not report a usable duration");
    }

    return {
        durationSeconds,
        videoCodec: parsed.streams?.find((stream) => stream.codec_type === "video")?.codec_name || null,
        audioCodec: parsed.streams?.find((stream) => stream.codec_type === "audio")?.codec_name || null,
    };
}

async function listDirectoryEntries(root: string, diagnostics: string[]) {
    try {
        return await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
        diagnostics.push(
            `Unable to read ${root}: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}

async function listEpisodeFileEntries(
    seriesPath: string,
    diagnostics: string[]
): Promise<EpisodeFileEntry[]> {
    const entries: EpisodeFileEntry[] = [];

    async function walk(directoryPath: string) {
        const directoryEntries = (await listDirectoryEntries(directoryPath, diagnostics))
            .sort((left, right) => naturalCompare(left.name, right.name));

        for (const entry of directoryEntries) {
            const filePath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                await walk(filePath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            entries.push({
                fileName: entry.name,
                filePath,
                relativePath: toSidecarRelativePath(seriesPath, filePath),
            });
        }
    }

    await walk(seriesPath);
    return entries.sort((left, right) => naturalCompare(left.relativePath, right.relativePath));
}

function parseSynonyms(
    value: string,
    seriesTitle: string,
    diagnostics: string[]
): string[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            diagnostics.push(`Ignoring AniDB synonyms for ${seriesTitle}: synonyms_json is not an array`);
            return [];
        }
        return parsed
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((item) => item.trim());
    } catch (error) {
        diagnostics.push(
            `Ignoring AniDB synonyms for ${seriesTitle}: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}

function addSeriesLookupKey(
    seriesByLookupKey: Map<string, MetadataAuthoritySeries>,
    value: string | null | undefined,
    series: MetadataAuthoritySeries
) {
    if (!value) {
        return;
    }
    const key = normalizeMetadataLookupKey(value);
    if (!key || seriesByLookupKey.has(key)) {
        return;
    }
    seriesByLookupKey.set(key, series);
}

async function loadMetadataCache(
    db: Database,
    diagnostics: string[]
): Promise<MetadataCache> {
    const seriesRows = await db.all<Array<AnidbSeriesRow>>(
        "SELECT anidb_series_id, title, sort_title, synonyms_json FROM anidb_series " +
        "WHERE last_success_at IS NOT NULL " +
        "ORDER BY title COLLATE NOCASE"
    );
    const episodeRows = await db.all<Array<AnidbEpisodeRow>>(
        "SELECT episodes.anidb_episode_id, episodes.anidb_series_id, episodes.episode_number, " +
        "episodes.title, episodes.summary, episodes.air_date, episodes.chronological_order " +
        "FROM anidb_episodes episodes " +
        "INNER JOIN anidb_series series ON series.anidb_series_id = episodes.anidb_series_id " +
        "WHERE series.last_success_at IS NOT NULL " +
        "ORDER BY episodes.anidb_series_id, episodes.chronological_order"
    );

    const seriesById = new Map<number, MetadataAuthoritySeries>();
    const seriesByLookupKey = new Map<string, MetadataAuthoritySeries>();
    const episodesById = new Map<number, MetadataAuthorityEpisode>();
    const episodesBySeriesAndNumber = new Map<number, Map<string, MetadataAuthorityEpisode>>();

    for (const row of seriesRows) {
        const series: MetadataAuthoritySeries = {
            anidbSeriesId: row.anidb_series_id,
            sortTitle: row.sort_title,
            title: row.title,
        };
        seriesById.set(series.anidbSeriesId, series);
        addSeriesLookupKey(seriesByLookupKey, series.title, series);
        addSeriesLookupKey(seriesByLookupKey, series.sortTitle, series);
        for (const synonym of parseSynonyms(row.synonyms_json, series.title, diagnostics)) {
            addSeriesLookupKey(seriesByLookupKey, synonym, series);
        }
    }

    for (const row of episodeRows) {
        const episode: MetadataAuthorityEpisode = {
            airDate: row.air_date,
            anidbEpisodeId: row.anidb_episode_id,
            anidbSeriesId: row.anidb_series_id,
            chronologicalOrder: row.chronological_order,
            episodeNumber: row.episode_number,
            summary: row.summary,
            title: row.title,
        };
        episodesById.set(episode.anidbEpisodeId, episode);
        const numberKey = normalizeEpisodeNumber(episode.episodeNumber);
        const episodeMap =
            episodesBySeriesAndNumber.get(episode.anidbSeriesId) || new Map<string, MetadataAuthorityEpisode>();
        if (!episodeMap.has(numberKey)) {
            episodeMap.set(numberKey, episode);
        }
        episodesBySeriesAndNumber.set(episode.anidbSeriesId, episodeMap);
    }

    return {
        episodesById,
        episodesBySeriesAndNumber,
        seriesById,
        seriesByLookupKey,
    };
}

async function readSidecarOverride(
    seriesPath: string,
    diagnostics: string[]
): Promise<SidecarOverride | null> {
    const sidecarPath = path.join(seriesPath, SIDECAR_FILE_NAME);
    let rawSidecar: string;
    try {
        rawSidecar = await fs.readFile(sidecarPath, "utf8");
    } catch (error) {
        if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code?: unknown }).code === "ENOENT"
        ) {
            return null;
        }
        diagnostics.push(
            `Unable to read Sidecar Override ${sidecarPath}: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }

    const result = parseSidecarOverride(rawSidecar, sidecarPath);
    diagnostics.push(...result.diagnostics);
    return result.sidecar;
}

type PersistedProbeFacts = {
    mtimeMs: number | null;
    fileSize: number | null;
    durationSeconds: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
};

type ScanProbeResult = {
    facts: MediaProbeFacts | null;
    mtimeMs: number | null;
    fileSize: number | null;
    probeError: unknown;
};

async function mapWithConcurrency(
    items: string[],
    limit: number,
    worker: (item: string) => Promise<void>
): Promise<void> {
    let cursor = 0;
    const runnerCount = Math.max(1, Math.min(limit, items.length));
    const runners = Array.from({ length: runnerCount }, async () => {
        while (cursor < items.length) {
            const item = items[cursor];
            cursor += 1;
            await worker(item);
        }
    });
    await Promise.all(runners);
}

async function loadPersistedProbeFacts(
    db: Database
): Promise<Map<string, PersistedProbeFacts>> {
    const rows = await db.all<Array<{
        file_path: string;
        mtime_ms: number | null;
        file_size: number | null;
        duration_seconds: number | null;
        video_codec: string | null;
        audio_codec: string | null;
    }>>(
        "SELECT file_path, mtime_ms, file_size, duration_seconds, video_codec, audio_codec FROM media_assets"
    );
    const map = new Map<string, PersistedProbeFacts>();
    for (const row of rows) {
        map.set(row.file_path, {
            audioCodec: row.audio_codec ?? null,
            durationSeconds: row.duration_seconds ?? null,
            fileSize: row.file_size ?? null,
            mtimeMs: row.mtime_ms ?? null,
            videoCodec: row.video_codec ?? null,
        });
    }
    return map;
}

// Resolves probe facts for a single file, reusing the persisted ffprobe result
// when the file's mtime and size are unchanged so we only spawn ffprobe for new
// or modified media. Network stat over the NAS is far cheaper than a subprocess.
async function resolveScanProbeFacts(
    filePath: string,
    persisted: Map<string, PersistedProbeFacts>,
    probeMediaAsset: MediaProbe
): Promise<ScanProbeResult> {
    let mtimeMs: number | null = null;
    let fileSize: number | null = null;

    try {
        const stat = await fs.stat(filePath);
        mtimeMs = stat.mtimeMs;
        fileSize = stat.size;

        const existing = persisted.get(filePath);
        if (
            existing &&
            existing.mtimeMs !== null &&
            existing.fileSize !== null &&
            existing.mtimeMs === mtimeMs &&
            existing.fileSize === fileSize &&
            Number.isFinite(existing.durationSeconds) &&
            (existing.durationSeconds ?? 0) > 0
        ) {
            return {
                facts: {
                    audioCodec: existing.audioCodec,
                    durationSeconds: existing.durationSeconds as number,
                    videoCodec: existing.videoCodec,
                },
                fileSize,
                mtimeMs,
                probeError: null,
            };
        }
    } catch {
        // Unable to stat (e.g. file vanished); fall through and let the probe
        // surface the failure the same way the previous implementation did.
    }

    try {
        const facts = await probeMediaAsset(filePath);
        return { facts, fileSize, mtimeMs, probeError: null };
    } catch (error) {
        return { facts: null, fileSize, mtimeMs, probeError: error };
    }
}

type SeriesScan = {
    seriesTitle: string;
    seriesPath: string;
    sidecar: SidecarOverride | null;
    episodeEntries: EpisodeFileEntry[];
};

export async function scanInternalLibrary(options: InternalScheduleOptions) {
    const diagnostics: string[] = [];
    const unresolvedEpisodeAssets: UnresolvedEpisodeAssetDiagnostic[] = [];
    const excludedSeriesByTitle = new Map<string, ExcludedSeriesDiagnostic>();
    const probeMediaAsset = options.probeMediaAsset || probeMediaAssetWithFfprobe;
    const allowlist = new Set(
        (options.seriesAllowlist || [])
            .map((seriesTitle) => seriesTitle.trim())
            .filter(Boolean)
    );
    const allowFilenameFallback = allowlist.size > 0;
    const metadataCache = await loadMetadataCache(options.db, diagnostics);
    const persistedProbeFacts = await loadPersistedProbeFacts(options.db);
    const assets: ScannedAsset[] = [];

    // Pass A — enumerate the library and collect every media file that needs probe facts.
    const seriesEntries = (await listDirectoryEntries(options.seriesRoot, diagnostics))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => naturalCompare(left.name, right.name));

    const seriesScans: SeriesScan[] = [];
    const probeTargets = new Set<string>();

    for (const seriesEntry of seriesEntries) {
        const seriesTitle = seriesEntry.name;
        if (allowlist.size > 0 && !allowlist.has(seriesTitle)) {
            continue;
        }

        const seriesPath = path.join(options.seriesRoot, seriesTitle);
        const sidecar = await readSidecarOverride(seriesPath, diagnostics);
        const episodeEntries = await listEpisodeFileEntries(seriesPath, diagnostics);
        seriesScans.push({ episodeEntries, seriesPath, seriesTitle, sidecar });

        for (const episodeEntry of episodeEntries) {
            if (
                episodeEntry.fileName !== SIDECAR_FILE_NAME &&
                isSupportedMediaFile(episodeEntry.fileName)
            ) {
                probeTargets.add(episodeEntry.filePath);
            }
        }
    }

    const bumpEntries = (await listDirectoryEntries(options.bumpsRoot, diagnostics))
        .filter((entry) => entry.isFile())
        .sort((left, right) => naturalCompare(left.name, right.name));

    for (const bumpEntry of bumpEntries) {
        if (isSupportedMediaFile(bumpEntry.name)) {
            probeTargets.add(path.join(options.bumpsRoot, bumpEntry.name));
        }
    }

    // Pass B — probe (or reuse persisted facts for) every media file in parallel.
    const probeResults = new Map<string, ScanProbeResult>();
    await mapWithConcurrency([...probeTargets], PROBE_CONCURRENCY, async (filePath) => {
        probeResults.set(
            filePath,
            await resolveScanProbeFacts(filePath, persistedProbeFacts, probeMediaAsset)
        );
    });

    // Pass C — resolve metadata and emit assets/diagnostics in deterministic order.
    for (const { seriesTitle, sidecar, episodeEntries } of seriesScans) {
        let schedulableEpisodeCount = 0;
        let playableEpisodeCount = 0;
        let lastUnresolvedReason = "no trusted chronological episode order";

        for (const [episodeIndex, episodeEntry] of episodeEntries.entries()) {
            if (episodeEntry.fileName === SIDECAR_FILE_NAME) {
                continue;
            }
            if (!isSupportedMediaFile(episodeEntry.fileName)) {
                diagnostics.push(`Skipping unsupported Episode Asset ${episodeEntry.filePath}`);
                continue;
            }

            const probe = probeResults.get(episodeEntry.filePath);
            if (!probe || probe.facts === null) {
                diagnostics.push(
                    `Skipping ${episodeEntry.filePath}: ${probeErrorMessage(probe)}`
                );
                continue;
            }

            const facts = probe.facts;
            if (!Number.isFinite(facts.durationSeconds) || facts.durationSeconds <= 0) {
                diagnostics.push(`Skipping ${episodeEntry.filePath}: missing usable duration`);
                continue;
            }

            playableEpisodeCount += 1;
            const resolved = resolveMetadataAuthority({
                cache: metadataCache,
                episodeIndex,
                fileName: episodeEntry.fileName,
                filenameFallbackAllowed: allowFilenameFallback,
                folderTitle: seriesTitle,
                relativePath: episodeEntry.relativePath,
                sidecar,
            });
            if ("reason" in resolved) {
                lastUnresolvedReason = resolved.reason;
                unresolvedEpisodeAssets.push({
                    filePath: episodeEntry.filePath,
                    reason: resolved.reason,
                    seriesTitle: resolved.seriesTitle,
                });
                continue;
            }

            schedulableEpisodeCount += 1;
            assets.push({
                airDate: resolved.airDate,
                anidbEpisodeId: resolved.anidbEpisodeId,
                anidbSeriesId: resolved.anidbSeriesId,
                audioCodec: facts.audioCodec || null,
                chronologicalOrder: resolved.chronologicalOrder,
                durationSeconds: facts.durationSeconds,
                episodeNumber: resolved.episodeNumber,
                fileSize: probe.fileSize,
                filePath: episodeEntry.filePath,
                metadataSource: resolved.metadataSource,
                mtimeMs: probe.mtimeMs,
                role: "episode",
                seriesTitle: resolved.seriesTitle,
                sortKey: episodeEntry.relativePath,
                summary: resolved.summary,
                title: resolved.title,
                videoCodec: facts.videoCodec || null,
            });
        }

        if (playableEpisodeCount > 0 && schedulableEpisodeCount === 0) {
            const resolvedSeriesTitle = resolveMetadataAuthoritySeriesTitle({
                cache: metadataCache,
                folderTitle: seriesTitle,
                sidecar,
            });
            excludedSeriesByTitle.set(resolvedSeriesTitle, {
                reason: lastUnresolvedReason,
                seriesTitle: resolvedSeriesTitle,
            });
        }
    }

    for (const bumpEntry of bumpEntries) {
        const filePath = path.join(options.bumpsRoot, bumpEntry.name);
        if (!isSupportedMediaFile(bumpEntry.name)) {
            diagnostics.push(`Skipping unsupported Bump Asset ${filePath}`);
            continue;
        }

        const probe = probeResults.get(filePath);
        if (!probe || probe.facts === null) {
            diagnostics.push(`Skipping ${filePath}: ${probeErrorMessage(probe)}`);
            continue;
        }

        const facts = probe.facts;
        if (!Number.isFinite(facts.durationSeconds) || facts.durationSeconds <= 0) {
            diagnostics.push(`Skipping ${filePath}: missing usable duration`);
            continue;
        }

        assets.push({
            audioCodec: facts.audioCodec || null,
            durationSeconds: facts.durationSeconds,
            fileSize: probe.fileSize,
            filePath,
            mtimeMs: probe.mtimeMs,
            role: "bump",
            seriesTitle: null,
            sortKey: bumpEntry.name,
            title: getMediaTitle(filePath),
            videoCodec: facts.videoCodec || null,
        });
    }

    return {
        assets,
        diagnostics,
        excludedSeries: [...excludedSeriesByTitle.values()]
            .sort((left, right) => naturalCompare(left.seriesTitle, right.seriesTitle)),
        unresolvedEpisodeAssets,
    };
}

function probeErrorMessage(probe: ScanProbeResult | undefined): string {
    if (!probe) {
        return "probe facts unavailable";
    }
    if (probe.probeError instanceof Error) {
        return probe.probeError.message;
    }
    return String(probe.probeError ?? "probe facts unavailable");
}

function isPathWithinRoot(filePath: string, root: string): boolean {
    const relativePath = path.relative(root, filePath);
    return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function pruneStaleMediaAssets(
    db: Database,
    assets: ScannedAsset[],
    seriesRoot: string,
    bumpsRoot: string
) {
    const scannedPaths = new Set(assets.map((asset) => asset.filePath));
    const existingRows = await db.all<Array<{ file_path: string }>>(
        "SELECT file_path FROM media_assets"
    );

    for (const row of existingRows) {
        const isManagedPath =
            isPathWithinRoot(row.file_path, seriesRoot) ||
            isPathWithinRoot(row.file_path, bumpsRoot);
        if (isManagedPath && !scannedPaths.has(row.file_path)) {
            await db.run("DELETE FROM media_assets WHERE file_path = ?", row.file_path);
        }
    }
}

async function persistMediaAssets(
    db: Database,
    assets: ScannedAsset[],
    now: Date,
    seriesRoot: string,
    bumpsRoot: string
) {
    const updatedAt = now.toISOString();
    return runExclusiveTransaction(db, async () => {
        for (const asset of assets) {
            await db.run(
                "INSERT INTO media_assets " +
                "(file_path, role, series_title, title, duration_seconds, video_codec, audio_codec, sort_key, " +
                "anidb_series_id, anidb_episode_id, episode_number, summary, air_date, chronological_order, metadata_source, " +
                "mtime_ms, file_size, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
                "ON CONFLICT(file_path) DO UPDATE SET " +
                "role = excluded.role, " +
                "series_title = excluded.series_title, " +
                "title = excluded.title, " +
                "duration_seconds = excluded.duration_seconds, " +
                "video_codec = excluded.video_codec, " +
                "audio_codec = excluded.audio_codec, " +
                "sort_key = excluded.sort_key, " +
                "anidb_series_id = excluded.anidb_series_id, " +
                "anidb_episode_id = excluded.anidb_episode_id, " +
                "episode_number = excluded.episode_number, " +
                "summary = excluded.summary, " +
                "air_date = excluded.air_date, " +
                "chronological_order = excluded.chronological_order, " +
                "metadata_source = excluded.metadata_source, " +
                "mtime_ms = excluded.mtime_ms, " +
                "file_size = excluded.file_size, " +
                "updated_at = excluded.updated_at",
                asset.filePath,
                asset.role,
                asset.seriesTitle,
                asset.title,
                asset.durationSeconds,
                asset.videoCodec || null,
                asset.audioCodec || null,
                asset.sortKey,
                asset.anidbSeriesId || null,
                asset.anidbEpisodeId || null,
                asset.episodeNumber || null,
                asset.summary || null,
                asset.airDate || null,
                asset.chronologicalOrder ?? null,
                asset.metadataSource || null,
                asset.mtimeMs ?? null,
                asset.fileSize ?? null,
                updatedAt
            );
        }
        await pruneStaleMediaAssets(db, assets, seriesRoot, bumpsRoot);
    });
}

async function ensureChannelState(
    db: Database,
    random: () => number,
    now: Date
): Promise<ChannelStateRow> {
    return withChannelStateInitializationLock(db, async () => {
        return ensureChannelStateUnlocked(db, random, now);
    });
}

async function withChannelStateInitializationLock<T>(
    db: Database,
    action: () => Promise<T>
): Promise<T> {
    const previousLock = channelStateInitializationLocks.get(db) || Promise.resolve();
    let releaseLock = () => {};
    const currentLock = previousLock
        .catch(() => undefined)
        .then(() => new Promise<void>((resolve) => {
            releaseLock = resolve;
        }));

    channelStateInitializationLocks.set(db, currentLock);
    await previousLock.catch(() => undefined);

    try {
        return await action();
    } finally {
        releaseLock();
        if (channelStateInitializationLocks.get(db) === currentLock) {
            channelStateInitializationLocks.delete(db);
        }
    }
}

async function ensureChannelStateUnlocked(
    db: Database,
    random: () => number,
    now: Date
): Promise<ChannelStateRow> {
    const existingState = await db.get<ChannelStateRow>(
        "SELECT id, current_rotation_index, bump_cursor, current_media_role FROM channel_state WHERE id = 1"
    );
    if (existingState) {
        return reconcileChannelState(db, existingState, random, now);
    }

    const timestamp = now.toISOString();

    await db.run(
        "INSERT INTO channel_state (id, current_rotation_index, bump_cursor, current_media_role, created_at, updated_at) " +
        "VALUES (1, 0, 0, 'episode', ?, ?)",
        timestamp,
        timestamp
    );

    return reconcileChannelState(db, {
        id: 1,
        current_rotation_index: 0,
        bump_cursor: 0,
        current_media_role: "episode",
    }, random, now);
}

async function loadSchedulableSeriesRows(db: Database): Promise<SchedulableSeriesRow[]> {
    return db.all<Array<SchedulableSeriesRow>>(
        "SELECT series_title, COUNT(*) AS episode_count FROM media_assets " +
        "WHERE role = 'episode' AND series_title IS NOT NULL AND duration_seconds IS NOT NULL " +
        "AND chronological_order IS NOT NULL " +
        "GROUP BY series_title " +
        "ORDER BY series_title COLLATE NOCASE"
    );
}

async function loadPositionedRotationRows(db: Database): Promise<PositionedSeriesRotationRow[]> {
    return db.all<Array<PositionedSeriesRotationRow>>(
        "SELECT position, series_title FROM series_rotation " +
        "WHERE channel_state_id = 1 ORDER BY position"
    );
}

async function loadEpisodeCursorTargetRows(db: Database): Promise<EpisodeCursorTargetRow[]> {
    return db.all<Array<EpisodeCursorTargetRow>>(
        "SELECT file_path, series_title FROM media_assets " +
        "WHERE role = 'episode' AND series_title IS NOT NULL AND duration_seconds IS NOT NULL " +
        "AND chronological_order IS NOT NULL " +
        "ORDER BY series_title COLLATE NOCASE, chronological_order, sort_key COLLATE NOCASE, title COLLATE NOCASE"
    );
}

async function reconcileChannelState(
    db: Database,
    state: ChannelStateRow,
    random: () => number,
    now: Date
): Promise<ChannelStateRow> {
    return runExclusiveTransaction(db, async () => {
        const schedulableSeriesRows = await loadSchedulableSeriesRows(db);
        const existingRotationRows = await loadPositionedRotationRows(db);
        const existingCursorRows = await loadCursorRows(db);
        const episodeTargetRows = await loadEpisodeCursorTargetRows(db);
        const bumpCount = await db.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM media_assets " +
            "WHERE role = 'bump' AND duration_seconds IS NOT NULL"
        );
        const reconciled = reconcileLibrary({
            bumpCount: bumpCount?.count || 0,
            episodeTargets: episodeTargetRows.map((row) => ({
                filePath: row.file_path,
                seriesTitle: row.series_title,
            })),
            existingEpisodeCursors: existingCursorRows.map((row) => ({
                episodeIndex: row.episode_index,
                mediaFilePath: row.media_file_path,
                seriesTitle: row.series_title,
            })),
            existingSeriesRotation: existingRotationRows.map((row) => row.series_title),
            previousState: {
                bumpCursor: state.bump_cursor,
                currentMediaRole: state.current_media_role,
                currentRotationIndex: state.current_rotation_index,
            },
            random,
            schedulableSeries: schedulableSeriesRows.map((row) => row.series_title),
        });
        const timestamp = now.toISOString();

        await db.run("DELETE FROM series_rotation WHERE channel_state_id = 1");
        for (let index = 0; index < reconciled.seriesRotation.length; index += 1) {
            await db.run(
                "INSERT INTO series_rotation (channel_state_id, position, series_title) VALUES (1, ?, ?)",
                index,
                reconciled.seriesRotation[index]
            );
        }

        await db.run("DELETE FROM episode_cursors WHERE channel_state_id = 1");
        for (const cursor of reconciled.episodeCursors) {
            await db.run(
                "INSERT INTO episode_cursors " +
                "(channel_state_id, series_title, episode_index, media_file_path) " +
                "VALUES (1, ?, ?, ?)",
                cursor.seriesTitle,
                cursor.episodeIndex,
                cursor.mediaFilePath
            );
        }

        await db.run(
            "UPDATE channel_state SET " +
            "current_rotation_index = ?, " +
            "bump_cursor = ?, " +
            "current_media_role = ?, " +
            "updated_at = ? " +
            "WHERE id = 1",
            reconciled.currentRotationIndex,
            reconciled.bumpCursor,
            reconciled.currentMediaRole,
            timestamp
        );

        return {
            ...state,
            bump_cursor: reconciled.bumpCursor,
            current_media_role: reconciled.currentMediaRole,
            current_rotation_index: reconciled.currentRotationIndex,
        };
    });
}

async function loadScheduleAssets(db: Database) {
    const episodes = await db.all<Array<MediaAssetRow>>(
        "SELECT id, role, file_path, series_title, title, duration_seconds, summary FROM media_assets " +
        "WHERE role = 'episode' AND series_title IS NOT NULL AND duration_seconds IS NOT NULL " +
        "AND chronological_order IS NOT NULL " +
        "ORDER BY series_title COLLATE NOCASE, chronological_order, sort_key COLLATE NOCASE, title COLLATE NOCASE"
    );
    const bumps = await db.all<Array<MediaAssetRow>>(
        "SELECT id, role, file_path, series_title, title, duration_seconds, summary FROM media_assets " +
        "WHERE role = 'bump' AND duration_seconds IS NOT NULL " +
        "ORDER BY sort_key COLLATE NOCASE, title COLLATE NOCASE"
    );
    return { episodes, bumps };
}

function buildChannelStateDiagnostic(
    state: ChannelStateRow,
    rotationRows: SeriesRotationRow[],
    cursorRows: EpisodeCursorRow[]
): InternalChannelStateDiagnostic {
    return {
        bumpCursor: state.bump_cursor,
        currentMediaRole: state.current_media_role,
        currentRotationIndex: state.current_rotation_index,
        episodeCursors: cursorRows.map((row) => ({
            episodeIndex: row.episode_index,
            seriesTitle: row.series_title,
        })),
        seriesRotation: rotationRows.map((row) => row.series_title),
    };
}

function buildDiagnostics(
    options: InternalScheduleOptions,
    scan: Awaited<ReturnType<typeof scanInternalLibrary>>,
    now: Date,
    state: ChannelStateRow | null = null,
    rotationRows: SeriesRotationRow[] = [],
    cursorRows: EpisodeCursorRow[] = []
): InternalScheduleDiagnostics {
    return {
        configured: true,
        bumpsRoot: options.bumpsRoot,
        channelState: state
            ? buildChannelStateDiagnostic(state, rotationRows, cursorRows)
            : null,
        lastError: null,
        lastScanAt: now.toISOString(),
        scannedBumpAssets: scan.assets.filter((asset) => asset.role === "bump").length,
        scannedEpisodeAssets: scan.assets.filter((asset) => asset.role === "episode").length,
        seriesAllowlist: options.seriesAllowlist || [],
        seriesRoot: options.seriesRoot,
        scannerDiagnostics: scan.diagnostics,
        unresolvedEpisodeAssets: scan.unresolvedEpisodeAssets,
        excludedSeries: scan.excludedSeries,
    };
}

function normalizeIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return ((index % length) + length) % length;
}

function toPlayoutQueueAsset(row: MediaAssetRow): PlayoutQueueAsset | null {
    if (!row.duration_seconds || row.duration_seconds <= 0) {
        return null;
    }

    return {
        durationSeconds: row.duration_seconds,
        filePath: row.file_path,
        id: row.id,
        role: row.role,
        seriesTitle: row.series_title,
        summary: row.summary,
        title: row.title,
    };
}

function toInternalMediaAsset(asset: PlayoutQueueAsset): InternalMediaAsset {
    return {
        durationSeconds: asset.durationSeconds,
        filePath: asset.filePath,
        id: asset.id,
        role: asset.role,
        seriesTitle: asset.seriesTitle,
        title: asset.title,
    };
}

function buildPlayoutQueueSnapshot(
    state: ChannelStateRow,
    rotationRows: SeriesRotationRow[],
    cursorRows: EpisodeCursorRow[],
    episodes: MediaAssetRow[],
    bumps: MediaAssetRow[]
): PlayoutQueueSnapshot {
    const toAssetList = (rows: MediaAssetRow[]) =>
        rows
            .map(toPlayoutQueueAsset)
            .filter((asset): asset is PlayoutQueueAsset => Boolean(asset));

    return {
        bumpAssets: toAssetList(bumps),
        episodeAssets: toAssetList(episodes),
        seriesRotation: rotationRows.map((row) => row.series_title),
        state: {
            bumpCursor: state.bump_cursor,
            currentMediaRole: state.current_media_role === "bump" ? "bump" : "episode",
            currentRotationIndex: state.current_rotation_index,
            episodeCursors: cursorRows.map((row) => ({
                episodeIndex: row.episode_index,
                seriesTitle: row.series_title,
            })),
        },
    };
}

function groupQueueEpisodeAssetsBySeries(episodeAssets: PlayoutQueueAsset[]) {
    const episodesBySeries = new Map<string, PlayoutQueueAsset[]>();
    for (const episode of episodeAssets) {
        if (!episode.seriesTitle) {
            continue;
        }
        const list = episodesBySeries.get(episode.seriesTitle) || [];
        list.push(episode);
        episodesBySeries.set(episode.seriesTitle, list);
    }
    return episodesBySeries;
}

async function persistPlayoutQueueState(
    options: InternalScheduleOptions,
    snapshot: PlayoutQueueSnapshot,
    nextState: PlayoutQueueChannelState,
    now: Date
) {
    const episodesBySeries = groupQueueEpisodeAssetsBySeries(snapshot.episodeAssets);

    await runExclusiveTransaction(options.db, async () => {
        await options.db.run(
            "UPDATE channel_state SET " +
            "current_rotation_index = ?, " +
            "bump_cursor = ?, " +
            "current_media_role = ?, " +
            "updated_at = ? " +
            "WHERE id = 1",
            nextState.currentRotationIndex,
            nextState.bumpCursor,
            nextState.currentMediaRole,
            now.toISOString()
        );

        for (const cursor of nextState.episodeCursors) {
            const seriesEpisodes = episodesBySeries.get(cursor.seriesTitle) || [];
            const cursorEpisode = seriesEpisodes[normalizeIndex(
                cursor.episodeIndex,
                seriesEpisodes.length
            )];
            await options.db.run(
                "UPDATE episode_cursors SET episode_index = ?, media_file_path = ? " +
                "WHERE channel_state_id = 1 AND series_title = ?",
                cursor.episodeIndex,
                cursorEpisode?.filePath || null,
                cursor.seriesTitle
            );
        }
    });
}

type ActivePlayoutHistoryAnchorRow = {
    media_file_path: string;
    started_at: string;
    start_offset_seconds: number;
};

async function loadActivePlayoutHistoryAnchor(
    db: Database
): Promise<ActivePlayoutHistoryAnchorRow | null> {
    const row = await db.get<ActivePlayoutHistoryAnchorRow>(
        "SELECT media_file_path, started_at, start_offset_seconds FROM playout_history " +
        "WHERE completed_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1"
    );
    return row || null;
}

function resolveAnchorStartAt(
    active: ActivePlayoutHistoryAnchorRow | null,
    currentAsset: PlayoutQueueAsset | null,
    now: Date
): { reason: string; resumeMode: "boundary" | "wall-clock"; startAt: Date } {
    if (!active || !currentAsset || active.media_file_path !== currentAsset.filePath) {
        return {
            reason: active
                ? "Active playout history did not match the current Channel State"
                : "No active playout history was available",
            resumeMode: "boundary",
            startAt: now,
        };
    }

    const startedAtMs = Date.parse(active.started_at);
    if (!Number.isFinite(startedAtMs)) {
        return {
            reason: "Active playout history had an invalid start time",
            resumeMode: "boundary",
            startAt: now,
        };
    }

    const startOffsetSeconds = Number(active.start_offset_seconds) || 0;
    const startAt = new Date(startedAtMs - startOffsetSeconds * 1000);
    if (startAt.getTime() >= now.getTime()) {
        return {
            reason: "Active playout was still at the current Media Asset boundary",
            resumeMode: "boundary",
            startAt,
        };
    }

    return {
        reason: "Elapsed wall-clock time was projected through the active Playout Plan",
        resumeMode: "wall-clock",
        startAt,
    };
}

function toInternalPlayoutPlanStep(
    step: { asset: PlayoutQueueAsset; index: number; startAt: Date; stopAt: Date }
): InternalPlayoutPlanStep {
    return {
        index: step.index,
        mediaAsset: toInternalMediaAsset(step.asset),
        startAt: step.startAt,
        stopAt: step.stopAt,
    };
}

async function loadRotationRows(db: Database) {
    return await db.all<Array<SeriesRotationRow>>(
        "SELECT series_title FROM series_rotation WHERE channel_state_id = 1 ORDER BY position"
    );
}

async function loadCursorRows(db: Database) {
    return await db.all<Array<EpisodeCursorRow>>(
        "SELECT series_title, episode_index, media_file_path FROM episode_cursors " +
        "WHERE channel_state_id = 1 ORDER BY series_title COLLATE NOCASE"
    );
}

export async function loadCurrentInternalMediaAsset(
    options: InternalScheduleOptions
): Promise<{ mediaAsset: InternalMediaAsset; diagnostics: InternalScheduleDiagnostics }> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const scan = await scanInternalLibrary(options);
    await persistMediaAssets(options.db, scan.assets, now, options.seriesRoot, options.bumpsRoot);
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const snapshot = buildPlayoutQueueSnapshot(
        state,
        rotationRows,
        cursorRows,
        episodes,
        bumps
    );
    const currentAsset = getCurrentPlayoutQueueItem(snapshot);
    const mediaAsset = currentAsset ? toInternalMediaAsset(currentAsset) : null;

    if (mediaAsset) {
        return {
            diagnostics: buildDiagnostics(options, scan, now, state, rotationRows, cursorRows),
            mediaAsset,
        };
    }

    throw new Error("No current internal media asset is available");
}

export async function advanceInternalPlayoutOnCompletion(
    options: InternalScheduleOptions,
    completedMediaAsset: InternalMediaAsset
): Promise<boolean> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const scan = await scanInternalLibrary(options);
    await persistMediaAssets(options.db, scan.assets, now, options.seriesRoot, options.bumpsRoot);
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const snapshot = buildPlayoutQueueSnapshot(
        state,
        rotationRows,
        cursorRows,
        episodes,
        bumps
    );
    const result = advancePlayoutQueue(snapshot, completedMediaAsset.id);

    if (!result.advanced) {
        return false;
    }

    const nextState = result.state;
    await persistPlayoutQueueState(options, snapshot, nextState, now);

    return true;
}

export async function persistInternalPlayoutPlanState(
    options: InternalScheduleOptions,
    nextState: PlayoutQueueChannelState
): Promise<void> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const snapshot = buildPlayoutQueueSnapshot(
        state,
        rotationRows,
        cursorRows,
        episodes,
        bumps
    );

    await persistPlayoutQueueState(options, snapshot, nextState, now);
}

export async function loadInternalPlayoutPlan(
    options: InternalScheduleOptions,
    {
        canSeekMediaAsset = () => true,
        horizonMs,
        maxSteps = DEFAULT_PLAYOUT_PROJECTION_MAX_STEPS,
    }: InternalPlayoutPlanOptions
): Promise<InternalPlayoutPlan> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const snapshot = buildPlayoutQueueSnapshot(
        state,
        rotationRows,
        cursorRows,
        episodes,
        bumps
    );
    const currentAsset = getCurrentPlayoutQueueItem(snapshot);
    const anchor = resolveAnchorStartAt(
        await loadActivePlayoutHistoryAnchor(options.db),
        currentAsset,
        now
    );
    const cursor = resolvePlayoutQueueCursor(snapshot, {
        anchorStartAt: anchor.startAt,
        maxSteps,
        now,
    });

    if (!cursor) {
        throw new Error("No current internal media asset is available");
    }

    const cursorAsset = toInternalMediaAsset(cursor.asset);
    const seekSafe = canSeekMediaAsset(cursorAsset);
    const startOffsetSeconds = seekSafe
        ? cursor.offsetSeconds
        : 0;
    const planStartAt = new Date(now.getTime() - startOffsetSeconds * 1000);
    const planSnapshot: PlayoutQueueSnapshot = {
        ...snapshot,
        state: cursor.state,
    };
    const projection = projectPlayoutQueue(planSnapshot, {
        maxSteps,
        minStopAt: new Date(now.getTime() + horizonMs),
        startAt: planStartAt,
    });
    const steps = projection.steps.map(toInternalPlayoutPlanStep);
    if (!steps[0]) {
        throw new Error("No current internal media asset is available");
    }

    return {
        currentState: cursor.state,
        finalState: projection.finalState,
        mediaAsset: steps[0].mediaAsset,
        resumeMode: startOffsetSeconds > 0 ? "wall-clock" : "boundary",
        resumeReason: !seekSafe && cursor.offsetSeconds > 0
            ? "Current Media Asset is not seek-safe"
            : anchor.reason,
        startOffsetSeconds,
        steps,
    };
}

// Scans the media library and reconciles channel state. This is the expensive,
// ffprobe-driven half and is run out-of-band (boot + periodic refresh), never on
// the request path.
export async function refreshInternalLibrary(
    options: InternalScheduleOptions
): Promise<{ diagnostics: InternalScheduleDiagnostics }> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const scan = await scanInternalLibrary(options);
    await persistMediaAssets(options.db, scan.assets, now, options.seriesRoot, options.bumpsRoot);
    const state = await ensureChannelState(options.db, random, now);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    return {
        diagnostics: buildDiagnostics(options, scan, now, state, rotationRows, cursorRows),
    };
}

// Projects the current schedule purely from persisted DB state — no scan, no
// ffprobe. Cheap enough to run on every request. On an empty DB it returns an
// empty schedule so the client falls back to its built-in lineup.
// Anchors the schedule timeline to the first asset in the active Playout Plan.
// The plan began at its persisted playout_history start (minus any resume
// offset), not "now", so projection can skip elapsed items and keep the visible
// schedule aligned with the continuous broadcast.
async function resolvePlayoutAnchor(
    db: Database,
    currentAsset: PlayoutQueueAsset | null,
    now: Date
): Promise<Date> {
    if (!currentAsset || !(currentAsset.durationSeconds > 0)) {
        return now;
    }

    const active = await db.get<{
        media_file_path: string;
        started_at: string;
        start_offset_seconds: number;
    }>(
        "SELECT media_file_path, started_at, start_offset_seconds FROM playout_history " +
        "WHERE completed_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1"
    );
    if (!active || active.media_file_path !== currentAsset.filePath) {
        return now;
    }

    const startedAtMs = Date.parse(active.started_at);
    if (!Number.isFinite(startedAtMs)) {
        return now;
    }

    const offsetSeconds = Number(active.start_offset_seconds) || 0;
    const virtualStartMs = startedAtMs - offsetSeconds * 1000;
    // Never anchor in the future; clock skew should not push all boundaries ahead.
    return new Date(Math.min(virtualStartMs, now.getTime()));
}

export async function projectInternalSchedulePayload(
    options: InternalScheduleOptions
): Promise<{ payload: SchedulePayload }> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const snapshot = buildPlayoutQueueSnapshot(
        state,
        rotationRows,
        cursorRows,
        episodes,
        bumps
    );
    const anchor = await resolvePlayoutAnchor(
        options.db,
        getCurrentPlayoutQueueItem(snapshot),
        now
    );
    const projection = projectPlayoutQueue(snapshot, {
        maxSteps: DEFAULT_PLAYOUT_PROJECTION_MAX_STEPS,
        minStopAt: new Date(now.getTime() + INTERNAL_SCHEDULE_LOOKAHEAD_MS),
        startAt: anchor,
    });
    const schedule: SchedulePayload["schedule"] = [];
    const currentAndFutureSteps = projection.steps.filter(
        (step) => step.stopAt.getTime() > now.getTime()
    );
    const firstPlayoutStopAt = currentAndFutureSteps[0]?.stopAt;
    const scheduleHorizonMs = now.getTime() + INTERNAL_SCHEDULE_LOOKAHEAD_MS;

    for (const step of currentAndFutureSteps) {
        const asset = step.asset;
        if (step.startAt.getTime() > scheduleHorizonMs) {
            break;
        }
        if (asset.role === "episode") {
            const live = step.startAt.getTime() <= now.getTime() &&
                step.stopAt.getTime() > now.getTime();
            schedule.push({
                ...(asset.summary ? { description: asset.summary } : {}),
                episode: asset.title,
                live,
                startAt: step.startAt.toISOString(),
                stopAt: step.stopAt.toISOString(),
                ...(live ? { time: "live" } : {}),
                title: asset.seriesTitle || asset.title,
            });
        }
    }

    return {
        payload: {
            fetchedAt: now.toISOString(),
            refreshAfterMs: computeScheduleRefreshDelay(now, {
                stop: firstPlayoutStopAt,
            }),
            schedule,
        },
    };
}

// Back-compat helper: refresh the library, then project. Prefer the decoupled
// refreshInternalLibrary + projectInternalSchedulePayload in the request/refresh paths.
export async function loadInternalSchedulePayload(
    options: InternalScheduleOptions
): Promise<{ payload: SchedulePayload; diagnostics: InternalScheduleDiagnostics }> {
    const { diagnostics } = await refreshInternalLibrary(options);
    const { payload } = await projectInternalSchedulePayload(options);
    return { diagnostics, payload };
}
