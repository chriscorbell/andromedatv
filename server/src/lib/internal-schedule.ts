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
    current_media_role: MediaRole;
};

type EpisodeCursorRow = {
    series_title: string;
    episode_index: number;
};

type SeriesRotationRow = {
    series_title: string;
};

type PlayoutCursor = {
    bumpCursor: number;
    currentMediaRole: MediaRole;
    episodeCursorsBySeries: Map<string, number>;
    rotationIndex: number;
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

const channelStateInitializationLocks = new WeakMap<Database, Promise<void>>();

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
        "INSERT INTO channel_state (id, current_rotation_index, bump_cursor, current_media_role, created_at, updated_at) " +
        "VALUES (1, 0, 0, 'episode', ?, ?)",
        timestamp,
        timestamp
    );

    await createInitialRotation(db, random);

    return {
        id: 1,
        current_rotation_index: 0,
        bump_cursor: 0,
        current_media_role: "episode",
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

function normalizeIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return ((index % length) + length) % length;
}

function groupEpisodesBySeries(episodes: MediaAssetRow[]) {
    const episodesBySeries = new Map<string, MediaAssetRow[]>();
    for (const episode of episodes) {
        if (!episode.series_title) {
            continue;
        }
        const list = episodesBySeries.get(episode.series_title) || [];
        list.push(episode);
        episodesBySeries.set(episode.series_title, list);
    }
    return episodesBySeries;
}

function createPlayoutCursor(
    state: ChannelStateRow,
    cursorRows: EpisodeCursorRow[]
): PlayoutCursor {
    return {
        bumpCursor: state.bump_cursor,
        currentMediaRole: state.current_media_role === "bump" ? "bump" : "episode",
        episodeCursorsBySeries: new Map(
            cursorRows.map((row) => [row.series_title, row.episode_index])
        ),
        rotationIndex: state.current_rotation_index,
    };
}

function resolveCurrentEpisode(
    cursor: PlayoutCursor,
    rotationRows: SeriesRotationRow[],
    episodesBySeries: Map<string, MediaAssetRow[]>
): MediaAssetRow | null {
    const rotationRow = rotationRows[normalizeIndex(cursor.rotationIndex, rotationRows.length)];
    const seriesTitle = rotationRow?.series_title;
    if (!seriesTitle) {
        return null;
    }

    const seriesEpisodes = episodesBySeries.get(seriesTitle) || [];
    if (seriesEpisodes.length === 0) {
        return null;
    }

    const episodeCursor = cursor.episodeCursorsBySeries.get(seriesTitle) || 0;
    return seriesEpisodes[normalizeIndex(episodeCursor, seriesEpisodes.length)] || null;
}

function resolveCurrentAsset(
    cursor: PlayoutCursor,
    rotationRows: SeriesRotationRow[],
    episodesBySeries: Map<string, MediaAssetRow[]>,
    bumps: MediaAssetRow[]
): MediaAssetRow | null {
    if (cursor.currentMediaRole === "bump" && bumps.length > 0) {
        return bumps[normalizeIndex(cursor.bumpCursor, bumps.length)] || null;
    }

    const episode = resolveCurrentEpisode(cursor, rotationRows, episodesBySeries);
    if (episode) {
        return episode;
    }

    if (bumps.length > 0) {
        return bumps[normalizeIndex(cursor.bumpCursor, bumps.length)] || null;
    }

    return null;
}

function advanceCurrentSeriesCursor(
    cursor: PlayoutCursor,
    rotationRows: SeriesRotationRow[],
    episodesBySeries: Map<string, MediaAssetRow[]>
) {
    const rotationRow = rotationRows[normalizeIndex(cursor.rotationIndex, rotationRows.length)];
    const seriesTitle = rotationRow?.series_title;
    if (seriesTitle) {
        const seriesEpisodes = episodesBySeries.get(seriesTitle) || [];
        if (seriesEpisodes.length > 0) {
            const episodeCursor = cursor.episodeCursorsBySeries.get(seriesTitle) || 0;
            cursor.episodeCursorsBySeries.set(
                seriesTitle,
                normalizeIndex(episodeCursor + 1, seriesEpisodes.length)
            );
        }
    }

    if (rotationRows.length > 0) {
        cursor.rotationIndex = normalizeIndex(cursor.rotationIndex + 1, rotationRows.length);
    }
}

function advancePlayoutCursor(
    cursor: PlayoutCursor,
    completedAsset: MediaAssetRow,
    rotationRows: SeriesRotationRow[],
    episodesBySeries: Map<string, MediaAssetRow[]>,
    bumps: MediaAssetRow[]
) {
    if (completedAsset.role === "episode" && bumps.length > 0) {
        cursor.currentMediaRole = "bump";
        return;
    }

    advanceCurrentSeriesCursor(cursor, rotationRows, episodesBySeries);
    if (completedAsset.role === "bump" && bumps.length > 0) {
        cursor.bumpCursor = normalizeIndex(cursor.bumpCursor + 1, bumps.length);
    }
    cursor.currentMediaRole = "episode";
}

async function loadRotationRows(db: Database) {
    return await db.all<Array<SeriesRotationRow>>(
        "SELECT series_title FROM series_rotation WHERE channel_state_id = 1 ORDER BY position"
    );
}

async function loadCursorRows(db: Database) {
    return await db.all<Array<EpisodeCursorRow>>(
        "SELECT series_title, episode_index FROM episode_cursors WHERE channel_state_id = 1"
    );
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
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const cursor = createPlayoutCursor(state, cursorRows);
    const currentAsset = resolveCurrentAsset(
        cursor,
        rotationRows,
        groupEpisodesBySeries(episodes),
        bumps
    );
    const mediaAsset = currentAsset ? toInternalMediaAsset(currentAsset) : null;

    if (mediaAsset) {
        return {
            diagnostics: buildDiagnostics(options, scan, now),
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
    await persistMediaAssets(options.db, scan.assets, now);
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const episodesBySeries = groupEpisodesBySeries(episodes);
    const cursor = createPlayoutCursor(state, cursorRows);
    const currentAsset = resolveCurrentAsset(cursor, rotationRows, episodesBySeries, bumps);
    const currentMediaAsset = currentAsset ? toInternalMediaAsset(currentAsset) : null;

    if (!currentAsset || !currentMediaAsset || currentMediaAsset.id !== completedMediaAsset.id) {
        return false;
    }

    advancePlayoutCursor(cursor, currentAsset, rotationRows, episodesBySeries, bumps);

    await options.db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
        await options.db.run(
            "UPDATE channel_state SET " +
            "current_rotation_index = ?, " +
            "bump_cursor = ?, " +
            "current_media_role = ?, " +
            "updated_at = ? " +
            "WHERE id = 1",
            cursor.rotationIndex,
            cursor.bumpCursor,
            cursor.currentMediaRole,
            now.toISOString()
        );

        for (const [seriesTitle, episodeIndex] of cursor.episodeCursorsBySeries) {
            await options.db.run(
                "UPDATE episode_cursors SET episode_index = ? " +
                "WHERE channel_state_id = 1 AND series_title = ?",
                episodeIndex,
                seriesTitle
            );
        }

        await options.db.exec("COMMIT");
    } catch (error) {
        await options.db.exec("ROLLBACK");
        throw error;
    }

    return true;
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
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const episodesBySeries = groupEpisodesBySeries(episodes);
    const cursor = createPlayoutCursor(state, cursorRows);
    const schedule = [];
    let cursorTime = now;

    while (schedule.length < 25) {
        const asset = resolveCurrentAsset(cursor, rotationRows, episodesBySeries, bumps);
        if (!asset) {
            break;
        }

        const stopAt = addSeconds(cursorTime, asset.duration_seconds || 0);
        schedule.push({
            ...(asset.role === "episode" ? { episode: asset.title } : {}),
            live: schedule.length === 0,
            startAt: cursorTime.toISOString(),
            stopAt: stopAt.toISOString(),
            ...(schedule.length === 0 ? { time: "live" } : {}),
            title: asset.role === "episode" && asset.series_title ? asset.series_title : asset.title,
        });
        cursorTime = stopAt;
        advancePlayoutCursor(cursor, asset, rotationRows, episodesBySeries, bumps);
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
