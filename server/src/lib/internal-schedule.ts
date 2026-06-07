import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import type { Database } from "sqlite";
import { computeScheduleRefreshDelay, SchedulePayload } from "./schedule";

const execFileAsync = promisify(execFile);

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
};

type MediaRole = "episode" | "bump";

type ScannedAsset = {
    role: MediaRole;
    filePath: string;
    title: string;
    seriesTitle: string | null;
    sortKey: string;
    durationSeconds: number;
    videoCodec?: string | null;
    audioCodec?: string | null;
};

type MediaAssetRow = {
    id: number;
    role: MediaRole;
    file_path: string;
    series_title: string | null;
    title: string;
    duration_seconds: number | null;
};

type ChannelStateRow = {
    id: number;
    current_rotation_index: number;
    bump_cursor: number;
};

type EpisodeCursorRow = {
    series_title: string;
    episode_index: number;
};

export type InternalMediaAsset = {
    id: number;
    role: MediaRole;
    filePath: string;
    seriesTitle: string | null;
    title: string;
    durationSeconds: number;
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

function naturalCompare(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function getMediaTitle(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
}

function isSupportedMediaFile(fileName: string): boolean {
    return SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
}

function clampRandomIndex(random: () => number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    const value = random();
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}

function shuffleSeries(seriesTitles: string[], random: () => number): string[] {
    const shuffled = seriesTitles.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = clampRandomIndex(random, index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
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

async function scanMediaFile(
    filePath: string,
    asset: Omit<ScannedAsset, "durationSeconds" | "videoCodec" | "audioCodec">,
    probeMediaAsset: MediaProbe,
    diagnostics: string[]
): Promise<ScannedAsset | null> {
    try {
        const facts = await probeMediaAsset(filePath);
        if (!Number.isFinite(facts.durationSeconds) || facts.durationSeconds <= 0) {
            diagnostics.push(`Skipping ${filePath}: missing usable duration`);
            return null;
        }

        return {
            ...asset,
            audioCodec: facts.audioCodec || null,
            durationSeconds: facts.durationSeconds,
            videoCodec: facts.videoCodec || null,
        };
    } catch (error) {
        diagnostics.push(
            `Skipping ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }
}

export async function scanInternalLibrary(options: InternalScheduleOptions) {
    const diagnostics: string[] = [];
    const probeMediaAsset = options.probeMediaAsset || probeMediaAssetWithFfprobe;
    const allowlist = new Set(
        (options.seriesAllowlist || [])
            .map((seriesTitle) => seriesTitle.trim())
            .filter(Boolean)
    );
    const assets: ScannedAsset[] = [];

    const seriesEntries = (await listDirectoryEntries(options.seriesRoot, diagnostics))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => naturalCompare(left.name, right.name));

    for (const seriesEntry of seriesEntries) {
        const seriesTitle = seriesEntry.name;
        if (allowlist.size > 0 && !allowlist.has(seriesTitle)) {
            continue;
        }

        const seriesPath = path.join(options.seriesRoot, seriesTitle);
        const episodeEntries = (await listDirectoryEntries(seriesPath, diagnostics))
            .filter((entry) => entry.isFile())
            .sort((left, right) => naturalCompare(left.name, right.name));

        for (const episodeEntry of episodeEntries) {
            const filePath = path.join(seriesPath, episodeEntry.name);
            if (!isSupportedMediaFile(episodeEntry.name)) {
                diagnostics.push(`Skipping unsupported Episode Asset ${filePath}`);
                continue;
            }

            const asset = await scanMediaFile(
                filePath,
                {
                    filePath,
                    role: "episode",
                    seriesTitle,
                    sortKey: episodeEntry.name,
                    title: getMediaTitle(episodeEntry.name),
                },
                probeMediaAsset,
                diagnostics
            );
            if (asset) {
                assets.push(asset);
            }
        }
    }

    const bumpEntries = (await listDirectoryEntries(options.bumpsRoot, diagnostics))
        .filter((entry) => entry.isFile())
        .sort((left, right) => naturalCompare(left.name, right.name));

    for (const bumpEntry of bumpEntries) {
        const filePath = path.join(options.bumpsRoot, bumpEntry.name);
        if (!isSupportedMediaFile(bumpEntry.name)) {
            diagnostics.push(`Skipping unsupported Bump Asset ${filePath}`);
            continue;
        }

        const asset = await scanMediaFile(
            filePath,
            {
                filePath,
                role: "bump",
                seriesTitle: null,
                sortKey: bumpEntry.name,
                title: getMediaTitle(bumpEntry.name),
            },
            probeMediaAsset,
            diagnostics
        );
        if (asset) {
            assets.push(asset);
        }
    }

    return { assets, diagnostics };
}

async function persistMediaAssets(db: Database, assets: ScannedAsset[], now: Date) {
    const updatedAt = now.toISOString();
    for (const asset of assets) {
        await db.run(
            "INSERT INTO media_assets " +
            "(file_path, role, series_title, title, duration_seconds, video_codec, audio_codec, sort_key, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(file_path) DO UPDATE SET " +
            "role = excluded.role, " +
            "series_title = excluded.series_title, " +
            "title = excluded.title, " +
            "duration_seconds = excluded.duration_seconds, " +
            "video_codec = excluded.video_codec, " +
            "audio_codec = excluded.audio_codec, " +
            "sort_key = excluded.sort_key, " +
            "updated_at = excluded.updated_at",
            asset.filePath,
            asset.role,
            asset.seriesTitle,
            asset.title,
            asset.durationSeconds,
            asset.videoCodec || null,
            asset.audioCodec || null,
            asset.sortKey,
            updatedAt
        );
    }
}

async function ensureChannelState(db: Database, random: () => number, now: Date) {
    const existingState = await db.get<ChannelStateRow>(
        "SELECT id, current_rotation_index, bump_cursor FROM channel_state WHERE id = 1"
    );
    if (existingState) {
        const rotationCount = await db.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM series_rotation WHERE channel_state_id = 1"
        );
        if ((rotationCount?.count || 0) === 0) {
            await createInitialRotation(db, random);
        }
        return existingState;
    }

    const timestamp = now.toISOString();

    await db.run(
        "INSERT INTO channel_state (id, current_rotation_index, bump_cursor, created_at, updated_at) " +
        "VALUES (1, 0, 0, ?, ?)",
        timestamp,
        timestamp
    );

    await createInitialRotation(db, random);

    return {
        id: 1,
        current_rotation_index: 0,
        bump_cursor: 0,
    };
}

async function createInitialRotation(db: Database, random: () => number) {
    const seriesRows = await db.all<Array<{ series_title: string }>>(
        "SELECT DISTINCT series_title FROM media_assets " +
        "WHERE role = 'episode' AND series_title IS NOT NULL AND duration_seconds IS NOT NULL " +
        "ORDER BY series_title COLLATE NOCASE"
    );
    const seriesTitles = seriesRows.map((row) => row.series_title);
    const rotation = shuffleSeries(seriesTitles, random);

    for (let index = 0; index < rotation.length; index += 1) {
        const seriesTitle = rotation[index];
        await db.run(
            "INSERT INTO series_rotation (channel_state_id, position, series_title) VALUES (1, ?, ?)",
            index,
            seriesTitle
        );

        const episodeCount = await db.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM media_assets " +
            "WHERE role = 'episode' AND series_title = ? AND duration_seconds IS NOT NULL",
            seriesTitle
        );
        await db.run(
            "INSERT INTO episode_cursors (channel_state_id, series_title, episode_index) VALUES (1, ?, ?)",
            seriesTitle,
            clampRandomIndex(random, episodeCount?.count || 0)
        );
    }
}

async function loadScheduleAssets(db: Database) {
    const episodes = await db.all<Array<MediaAssetRow>>(
        "SELECT id, role, file_path, series_title, title, duration_seconds FROM media_assets " +
        "WHERE role = 'episode' AND series_title IS NOT NULL AND duration_seconds IS NOT NULL " +
        "ORDER BY series_title COLLATE NOCASE, sort_key COLLATE NOCASE, title COLLATE NOCASE"
    );
    const bumps = await db.all<Array<MediaAssetRow>>(
        "SELECT id, role, file_path, series_title, title, duration_seconds FROM media_assets " +
        "WHERE role = 'bump' AND duration_seconds IS NOT NULL " +
        "ORDER BY sort_key COLLATE NOCASE, title COLLATE NOCASE"
    );
    return { episodes, bumps };
}

function toInternalMediaAsset(row: MediaAssetRow): InternalMediaAsset | null {
    if (!row.duration_seconds || row.duration_seconds <= 0) {
        return null;
    }

    return {
        id: row.id,
        durationSeconds: row.duration_seconds,
        filePath: row.file_path,
        role: row.role,
        seriesTitle: row.series_title,
        title: row.title,
    };
}

function buildDiagnostics(
    options: InternalScheduleOptions,
    scan: Awaited<ReturnType<typeof scanInternalLibrary>>,
    now: Date
): InternalScheduleDiagnostics {
    return {
        configured: true,
        bumpsRoot: options.bumpsRoot,
        lastError: null,
        lastScanAt: now.toISOString(),
        scannedBumpAssets: scan.assets.filter((asset) => asset.role === "bump").length,
        scannedEpisodeAssets: scan.assets.filter((asset) => asset.role === "episode").length,
        seriesAllowlist: options.seriesAllowlist || [],
        seriesRoot: options.seriesRoot,
        scannerDiagnostics: scan.diagnostics,
    };
}

export async function loadCurrentInternalMediaAsset(
    options: InternalScheduleOptions
): Promise<{ mediaAsset: InternalMediaAsset; diagnostics: InternalScheduleDiagnostics }> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const scan = await scanInternalLibrary(options);
    await persistMediaAssets(options.db, scan.assets, now);
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRow = await options.db.get<{ series_title: string }>(
        "SELECT series_title FROM series_rotation WHERE channel_state_id = 1 AND position = ?",
        state.current_rotation_index
    );

    if (rotationRow) {
        const seriesEpisodes = episodes.filter(
            (episode) => episode.series_title === rotationRow.series_title
        );
        const cursorRow = await options.db.get<{ episode_index: number }>(
            "SELECT episode_index FROM episode_cursors WHERE channel_state_id = 1 AND series_title = ?",
            rotationRow.series_title
        );
        if (seriesEpisodes.length > 0) {
            const cursor = cursorRow?.episode_index || 0;
            const mediaAsset = toInternalMediaAsset(
                seriesEpisodes[cursor % seriesEpisodes.length]
            );
            if (mediaAsset) {
                return {
                    diagnostics: buildDiagnostics(options, scan, now),
                    mediaAsset,
                };
            }
        }
    }

    if (bumps.length > 0) {
        const mediaAsset = toInternalMediaAsset(bumps[state.bump_cursor % bumps.length]);
        if (mediaAsset) {
            return {
                diagnostics: buildDiagnostics(options, scan, now),
                mediaAsset,
            };
        }
    }

    throw new Error("No current internal media asset is available");
}

export async function loadInternalSchedulePayload(
    options: InternalScheduleOptions
): Promise<{ payload: SchedulePayload; diagnostics: InternalScheduleDiagnostics }> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const scan = await scanInternalLibrary(options);
    await persistMediaAssets(options.db, scan.assets, now);
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await options.db.all<Array<{ series_title: string }>>(
        "SELECT series_title FROM series_rotation WHERE channel_state_id = 1 ORDER BY position"
    );
    const cursorRows = await options.db.all<Array<EpisodeCursorRow>>(
        "SELECT series_title, episode_index FROM episode_cursors WHERE channel_state_id = 1"
    );

    const episodesBySeries = new Map<string, MediaAssetRow[]>();
    for (const episode of episodes) {
        if (!episode.series_title) {
            continue;
        }
        const list = episodesBySeries.get(episode.series_title) || [];
        list.push(episode);
        episodesBySeries.set(episode.series_title, list);
    }

    const cursorsBySeries = new Map(
        cursorRows.map((row) => [row.series_title, row.episode_index])
    );
    const seriesUseCounts = new Map<string, number>();
    const schedule = [];
    let cursorTime = now;
    let bumpUseCount = 0;

    for (let rotationAdvance = 0; schedule.length < 25 && rotationRows.length > 0; rotationAdvance += 1) {
        const rotationIndex = (state.current_rotation_index + rotationAdvance) % rotationRows.length;
        const seriesTitle = rotationRows[rotationIndex]?.series_title;
        const seriesEpisodes = seriesTitle ? episodesBySeries.get(seriesTitle) || [] : [];
        if (seriesTitle && seriesEpisodes.length > 0) {
            const seriesUseCount = seriesUseCounts.get(seriesTitle) || 0;
            const episodeCursor = cursorsBySeries.get(seriesTitle) || 0;
            const episode = seriesEpisodes[(episodeCursor + seriesUseCount) % seriesEpisodes.length];
            const stopAt = addSeconds(cursorTime, episode.duration_seconds || 0);
            schedule.push({
                episode: episode.title,
                live: schedule.length === 0,
                startAt: cursorTime.toISOString(),
                stopAt: stopAt.toISOString(),
                ...(schedule.length === 0 ? { time: "live" } : {}),
                title: seriesTitle,
            });
            cursorTime = stopAt;
            seriesUseCounts.set(seriesTitle, seriesUseCount + 1);
        }

        if (schedule.length < 25 && bumps.length > 0) {
            const bump = bumps[(state.bump_cursor + bumpUseCount) % bumps.length];
            const stopAt = addSeconds(cursorTime, bump.duration_seconds || 0);
            schedule.push({
                live: schedule.length === 0,
                startAt: cursorTime.toISOString(),
                stopAt: stopAt.toISOString(),
                ...(schedule.length === 0 ? { time: "live" } : {}),
                title: bump.title,
            });
            cursorTime = stopAt;
            bumpUseCount += 1;
        }
    }

    return {
        diagnostics: buildDiagnostics(options, scan, now),
        payload: {
            fetchedAt: now.toISOString(),
            refreshAfterMs: computeScheduleRefreshDelay(now, {
                stop: schedule[0]?.stopAt ? new Date(schedule[0].stopAt) : undefined,
            }),
            schedule,
        },
    };
}