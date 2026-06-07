import { ChildProcess, spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { Database } from "sqlite";
import {
    InternalMediaAsset,
    InternalScheduleOptions,
    MediaProbe,
    loadCurrentInternalMediaAsset,
} from "./internal-schedule";

export type InternalPlayoutDiagnostics = {
    configured: boolean;
    outputRoot: string | null;
    activeAssetPath: string | null;
    activeAssetTitle: string | null;
    activeAssetRole: string | null;
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
    transcodeLiveHls?: InternalLiveHlsTranscoder;
    logger?: Pick<Console, "info" | "warn" | "error">;
};

type ActivePlayout = {
    assetId: number;
    outputRoot: string;
    playlistPath: string;
    process?: ChildProcess;
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
}: InternalLiveHlsTranscodeRequest): Promise<InternalLiveHlsTranscodeResult> {
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.mkdir(outputRoot, { recursive: true });

    const ffmpeg = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-re",
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
    };

    async function ensureLiveHls() {
        const { mediaAsset } = await loadCurrentInternalMediaAsset(scheduleOptions(options));
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
            });
            active = {
                assetId: mediaAsset.id,
                outputRoot,
                playlistPath: result.playlistPath,
                process: result.process,
            };
            result.process?.once("exit", (code, signal) => {
                if (active?.assetId !== mediaAsset.id || code === 0) {
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
                lastStartAt: new Date().toISOString(),
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