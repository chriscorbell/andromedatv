import { ChildProcess, spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { Database } from "sqlite";
import {
    advanceInternalPlayoutOnCompletion,
    InternalMediaAsset,
    InternalScheduleOptions,
    MediaProbe,
    loadCurrentInternalMediaAsset,
} from "./internal-schedule";

export type InternalPlayoutResumeMode = "boundary" | "wall-clock";

export type InternalPlayoutDiagnostics = {
    configured: boolean;
    outputRoot: string | null;
    activeAssetPath: string | null;
    activeAssetTitle: string | null;
    activeAssetRole: string | null;
    resumeMode: InternalPlayoutResumeMode | null;
    resumeReason: string | null;
    resumeOffsetSeconds: number | null;
    lastStartAt: string | null;
    lastFailureAt: string | null;
    lastFailureMessage: string | null;
    ffmpegPid: number | null;
};

export type InternalLiveHlsTranscodeRequest = {
    mediaAsset: InternalMediaAsset;
    outputRoot: string;
    playlistPath: string;
    segmentPattern: string;
    startOffsetSeconds: number;
};

export type InternalLiveHlsTranscodeResult = {
    playlistPath: string;
    process?: ChildProcess;
};

export type InternalLiveHlsTranscoder = (
    request: InternalLiveHlsTranscodeRequest
) => Promise<InternalLiveHlsTranscodeResult>;

export type InternalPlayoutOptions = {
    db: Database;
    seriesRoot: string;
    bumpsRoot: string;
    hlsOutputRoot: string;
    seriesAllowlist?: string[];
    now?: () => Date;
    random?: () => number;
    probeMediaAsset?: MediaProbe;
    canSeekMediaAsset?: (mediaAsset: InternalMediaAsset) => boolean;
    transcodeLiveHls?: InternalLiveHlsTranscoder;
    logger?: Pick<Console, "info" | "warn" | "error">;
};

type ActivePlayout = {
    assetId: number;
    historyId: number;
    outputRoot: string;
    playlistPath: string;
    process?: ChildProcess;
};

type PlayoutHistoryRow = {
    id: number;
    media_asset_id: number;
    started_at: string;
    start_offset_seconds: number;
};

type ResumeDecision = {
    historyId?: number;
    mode: InternalPlayoutResumeMode;
    offsetSeconds: number;
    reason: string;
};

const PLAYLIST_FILE_NAME = "hls.m3u8";

function scheduleOptions(options: InternalPlayoutOptions): InternalScheduleOptions {
    return {
        bumpsRoot: options.bumpsRoot,
        db: options.db,
        now: options.now,
        probeMediaAsset: options.probeMediaAsset,
        random: options.random,
        seriesAllowlist: options.seriesAllowlist,
        seriesRoot: options.seriesRoot,
    };
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function getCurrentDate(options: InternalPlayoutOptions): Date {
    return options.now ? options.now() : new Date();
}

function normalizeResumeOffset(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return 0;
    }

    return Math.floor(seconds);
}

function formatFfmpegSeconds(seconds: number): string {
    return Math.max(0, seconds)
        .toFixed(3)
        .replace(/\.?0+$/, "");
}

async function loadActivePlayoutHistory(db: Database): Promise<PlayoutHistoryRow | null> {
    const row = await db.get<PlayoutHistoryRow>(
        "SELECT id, media_asset_id, started_at, start_offset_seconds " +
        "FROM playout_history " +
        "WHERE completed_at IS NULL " +
        "ORDER BY started_at DESC, id DESC " +
        "LIMIT 1"
    );

    return row || null;
}

function resolveResumeDecision(
    activeHistory: PlayoutHistoryRow | null,
    mediaAsset: InternalMediaAsset,
    now: Date,
    canSeekMediaAsset: (mediaAsset: InternalMediaAsset) => boolean
): ResumeDecision {
    if (!activeHistory) {
        return {
            mode: "boundary",
            offsetSeconds: 0,
            reason: "No active playout history was available",
        };
    }

    if (activeHistory.media_asset_id !== mediaAsset.id) {
        return {
            mode: "boundary",
            offsetSeconds: 0,
            reason: "Active playout history pointed at a different Media Asset",
        };
    }

    const startedAtMs = new Date(activeHistory.started_at).getTime();
    if (!Number.isFinite(startedAtMs)) {
        return {
            mode: "boundary",
            offsetSeconds: 0,
            reason: "Active playout history had an invalid start time",
        };
    }

    if (!Number.isFinite(mediaAsset.durationSeconds) || mediaAsset.durationSeconds <= 0) {
        return {
            mode: "boundary",
            offsetSeconds: 0,
            reason: "Current Media Asset duration was unavailable",
        };
    }

    if (!canSeekMediaAsset(mediaAsset)) {
        return {
            mode: "boundary",
            offsetSeconds: 0,
            reason: "Current Media Asset is not seek-safe",
        };
    }

    const elapsedSeconds = normalizeResumeOffset(
        ((now.getTime() - startedAtMs) / 1000) +
        Number(activeHistory.start_offset_seconds || 0)
    );
    if (elapsedSeconds <= 0) {
        return {
            historyId: activeHistory.id,
            mode: "boundary",
            offsetSeconds: 0,
            reason: "Active playout was still at the current Media Asset boundary",
        };
    }

    if (elapsedSeconds >= mediaAsset.durationSeconds) {
        return {
            mode: "boundary",
            offsetSeconds: 0,
            reason: "Elapsed wall-clock time exceeded the current Media Asset duration",
        };
    }

    return {
        historyId: activeHistory.id,
        mode: "wall-clock",
        offsetSeconds: elapsedSeconds,
        reason: "Elapsed wall-clock time was within the current seek-safe Media Asset",
    };
}

async function recordPlayoutStart(
    db: Database,
    mediaAsset: InternalMediaAsset,
    startedAt: Date,
    startOffsetSeconds: number
): Promise<number> {
    const timestamp = startedAt.toISOString();
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
        await db.run(
            "UPDATE playout_history SET completed_at = ?, completion_reason = ? " +
            "WHERE completed_at IS NULL",
            timestamp,
            "replaced"
        );
        const result = await db.run(
            "INSERT INTO playout_history " +
            "(media_asset_id, media_file_path, media_title, media_role, started_at, start_offset_seconds, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            mediaAsset.id,
            mediaAsset.filePath,
            mediaAsset.title,
            mediaAsset.role,
            timestamp,
            startOffsetSeconds,
            timestamp
        );
        await db.exec("COMMIT");
        return Number(result.lastID);
    } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
    }
}

async function markPlayoutHistoryCompleted(
    db: Database,
    historyId: number,
    completedAt: Date,
    reason: string
) {
    await db.run(
        "UPDATE playout_history SET completed_at = ?, completion_reason = ? " +
        "WHERE id = ? AND completed_at IS NULL",
        completedAt.toISOString(),
        reason,
        historyId
    );
}

async function waitForPlaylist(playlistPath: string, process: ChildProcess) {
    const startedAt = Date.now();
    let exitError: Error | null = null;
    let stderr = "";
    process.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    process.once("error", (error) => {
        exitError = error;
    });
    process.once("exit", (code, signal) => {
        if (code !== 0) {
            const detail = stderr.trim();
            exitError = new Error(
                `ffmpeg exited before HLS output was ready (${signal || code})${detail ? `: ${detail}` : ""}`
            );
        }
    });

    while (Date.now() - startedAt < 15_000) {
        if (await pathExists(playlistPath)) {
            return;
        }
        if (exitError) {
            throw exitError;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error("ffmpeg did not produce an HLS playlist within 15s");
}

export async function transcodeMediaAssetToLiveHls({
    mediaAsset,
    outputRoot,
    playlistPath,
    segmentPattern,
    startOffsetSeconds,
}: InternalLiveHlsTranscodeRequest): Promise<InternalLiveHlsTranscodeResult> {
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.mkdir(outputRoot, { recursive: true });

    const ffmpeg = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-re",
        ...(startOffsetSeconds > 0 ? ["-ss", formatFfmpegSeconds(startOffsetSeconds)] : []),
        "-i",
        mediaAsset.filePath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-c:a",
        "aac",
        "-f",
        "hls",
        "-hls_time",
        "4",
        "-hls_list_size",
        "6",
        "-hls_flags",
        "delete_segments+independent_segments",
        "-hls_segment_filename",
        segmentPattern,
        playlistPath,
    ], {
        stdio: ["ignore", "pipe", "pipe"],
    });

    await waitForPlaylist(playlistPath, ffmpeg);
    return { playlistPath, process: ffmpeg };
}

export function createInternalPlayout(options: InternalPlayoutOptions) {
    let active: ActivePlayout | null = null;
    let diagnostics: InternalPlayoutDiagnostics = {
        configured: true,
        activeAssetPath: null,
        activeAssetRole: null,
        activeAssetTitle: null,
        ffmpegPid: null,
        lastFailureAt: null,
        lastFailureMessage: null,
        lastStartAt: null,
        outputRoot: options.hlsOutputRoot,
        resumeMode: null,
        resumeOffsetSeconds: null,
        resumeReason: null,
    };

    async function ensureLiveHls() {
        const { mediaAsset } = await loadCurrentInternalMediaAsset(scheduleOptions(options));
        const now = getCurrentDate(options);
        const canSeekMediaAsset = options.canSeekMediaAsset || (() => true);
        const resume = resolveResumeDecision(
            await loadActivePlayoutHistory(options.db),
            mediaAsset,
            now,
            canSeekMediaAsset
        );
        const outputRoot = path.join(options.hlsOutputRoot, `asset-${mediaAsset.id}`);
        const playlistPath = path.join(outputRoot, PLAYLIST_FILE_NAME);

        if (active?.assetId === mediaAsset.id && await pathExists(active.playlistPath)) {
            return active;
        }

        if (active?.process && !active.process.killed) {
            active.process.kill("SIGTERM");
        }

        const segmentPattern = path.join(outputRoot, "segment-%05d.ts");
        const transcodeLiveHls = options.transcodeLiveHls || transcodeMediaAssetToLiveHls;

        try {
            const result = await transcodeLiveHls({
                mediaAsset,
                outputRoot,
                playlistPath,
                segmentPattern,
                startOffsetSeconds: resume.offsetSeconds,
            });
            const historyId = resume.historyId || await recordPlayoutStart(
                options.db,
                mediaAsset,
                now,
                resume.offsetSeconds
            );
            active = {
                assetId: mediaAsset.id,
                historyId,
                outputRoot,
                playlistPath: result.playlistPath,
                process: result.process,
            };
            result.process?.once("exit", (code, signal) => {
                if (active?.assetId !== mediaAsset.id) {
                    return;
                }

                if (code === 0) {
                    active = null;
                    diagnostics = {
                        ...diagnostics,
                        ffmpegPid: null,
                    };
                    void (async () => {
                        await markPlayoutHistoryCompleted(
                            options.db,
                            historyId,
                            getCurrentDate(options),
                            "completed"
                        );
                        await advanceInternalPlayoutOnCompletion(
                            scheduleOptions(options),
                            mediaAsset
                        );
                    })().catch((error) => {
                        diagnostics = {
                            ...diagnostics,
                            lastFailureAt: new Date().toISOString(),
                            lastFailureMessage: error instanceof Error
                                ? error.message
                                : String(error),
                        };
                    });
                    return;
                }

                diagnostics = {
                    ...diagnostics,
                    ffmpegPid: null,
                    lastFailureAt: new Date().toISOString(),
                    lastFailureMessage: `ffmpeg exited (${signal || code})`,
                };
            });
            diagnostics = {
                ...diagnostics,
                activeAssetPath: mediaAsset.filePath,
                activeAssetRole: mediaAsset.role,
                activeAssetTitle: mediaAsset.title,
                ffmpegPid: result.process?.pid || null,
                lastFailureAt: null,
                lastFailureMessage: null,
                lastStartAt: now.toISOString(),
                resumeMode: resume.mode,
                resumeOffsetSeconds: resume.offsetSeconds,
                resumeReason: resume.reason,
            };
            return active;
        } catch (error) {
            diagnostics = {
                ...diagnostics,
                activeAssetPath: mediaAsset.filePath,
                activeAssetRole: mediaAsset.role,
                activeAssetTitle: mediaAsset.title,
                ffmpegPid: null,
                lastFailureAt: new Date().toISOString(),
                lastFailureMessage: error instanceof Error ? error.message : String(error),
            };
            throw error;
        }
    }

    function resolveHlsFile(suffixPath: string): string | null {
        if (!active) {
            return null;
        }
        if (suffixPath === "/session/1/hls.m3u8") {
            return active.playlistPath;
        }
        const prefix = "/session/1/";
        if (!suffixPath.startsWith(prefix)) {
            return null;
        }

        const fileName = suffixPath.slice(prefix.length);
        if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
            return null;
        }

        const resolvedOutputRoot = path.resolve(active.outputRoot);
        const resolvedFilePath = path.resolve(active.outputRoot, fileName);
        if (!resolvedFilePath.startsWith(`${resolvedOutputRoot}${path.sep}`)) {
            return null;
        }

        return resolvedFilePath;
    }

    return {
        ensureLiveHls,
        getDiagnostics: () => diagnostics,
        resolveHlsFile,
    };
}
