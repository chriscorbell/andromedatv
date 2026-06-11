import { ChildProcess, spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { Database } from "sqlite";
import {
    InternalMediaAsset,
    InternalPlayoutPlan,
    InternalPlayoutPlanStep,
    InternalScheduleOptions,
    MediaProbe,
    loadInternalPlayoutPlan,
    persistInternalPlayoutPlanState,
} from "./internal-schedule";
import {
    buildLiveHlsTranscodeAttempts,
    TranscodeAccelerationStatus,
} from "./transcode-acceleration";
import { runExclusiveTransaction } from "./sqlite-transaction";

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
    plannedDurationSeconds: number | null;
    plannedItemCount: number | null;
    plannedStopAt: string | null;
    plannedRenewalAt: string | null;
    lastStartAt: string | null;
    lastFailureAt: string | null;
    lastFailureMessage: string | null;
    ffmpegPid: number | null;
    hardwareAccelerationActive: boolean;
    hardwareAccelerationAvailable: boolean;
    hardwareDevicePath: string | null;
    transcodeAccelerationMode: TranscodeAccelerationStatus["mode"] | null;
};

export type InternalLiveHlsTranscodeRequest = {
    concatPlaylistPath?: string;
    mediaAsset: InternalMediaAsset;
    mediaAssets?: InternalMediaAsset[];
    outputRoot: string;
    playlistPath: string;
    segmentPattern: string;
    startOffsetSeconds: number;
    transcodeAcceleration: TranscodeAccelerationStatus;
};

export type InternalLiveHlsTranscodeResult = {
    playlistPath: string;
    process?: ChildProcess;
    usesHardwareAcceleration?: boolean;
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
    transcodeAcceleration?: TranscodeAccelerationStatus;
    transcodeLiveHls?: InternalLiveHlsTranscoder;
    logger?: Pick<Console, "info" | "warn" | "error">;
};

type ActivePlayout = {
    assetId: number;
    finalState: InternalPlayoutPlan["finalState"];
    historyId: number;
    outputRoot: string;
    planStopAt: Date;
    playlistPath: string;
    process?: ChildProcess;
    renewing: boolean;
};

const PLAYLIST_FILE_NAME = "hls.m3u8";
const CHANNEL_OUTPUT_DIRECTORY = "channel-1";
const CONCAT_PLAYLIST_FILE_NAME = "playout.ffconcat";
const SEGMENT_FILE_PATTERN = "segment-%010d.ts";
const PLAYOUT_HORIZON_MS = 48 * 60 * 60 * 1000;
const MIN_FUTURE_PLAYOUT_MS = 24 * 60 * 60 * 1000;
const RESTART_AFTER_EXIT_MS = 1_000;
const RESTART_AFTER_FAILURE_MS = 5_000;
const READY_TIMEOUT_MS = 15_000;

const DEFAULT_TRANSCODE_ACCELERATION: TranscodeAccelerationStatus = {
    devicePath: "/dev/dri/renderD128",
    hardwareAvailable: false,
    mode: "disabled",
};

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

async function recordPlayoutStart(
    db: Database,
    mediaAsset: InternalMediaAsset,
    startedAt: Date,
    startOffsetSeconds: number
): Promise<number> {
    const timestamp = startedAt.toISOString();
    return runExclusiveTransaction(db, async () => {
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
        return Number(result.lastID);
    });
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

    while (Date.now() - startedAt < READY_TIMEOUT_MS) {
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

function formatFfconcatSeconds(seconds: number): string {
    return Math.max(0, seconds)
        .toFixed(3)
        .replace(/\.?0+$/, "");
}

function quoteFfconcatPath(filePath: string): string {
    return `'${filePath.replace(/'/g, "'\\''")}'`;
}

async function writeConcatPlaylist(
    concatPlaylistPath: string,
    mediaAssets: InternalMediaAsset[]
) {
    const lines = ["ffconcat version 1.0"];
    for (const mediaAsset of mediaAssets) {
        lines.push(`file ${quoteFfconcatPath(mediaAsset.filePath)}`);
        lines.push(`duration ${formatFfconcatSeconds(mediaAsset.durationSeconds)}`);
    }
    await fs.writeFile(concatPlaylistPath, `${lines.join("\n")}\n`);
}

export async function transcodeMediaAssetToLiveHls({
    concatPlaylistPath,
    mediaAsset,
    mediaAssets,
    outputRoot,
    playlistPath,
    segmentPattern,
    startOffsetSeconds,
    transcodeAcceleration,
}: InternalLiveHlsTranscodeRequest): Promise<InternalLiveHlsTranscodeResult> {
    const plannedMediaAssets = mediaAssets?.length ? mediaAssets : [mediaAsset];
    const inputFormat = plannedMediaAssets.length > 1 ? "concat" : "media";
    const inputPath = inputFormat === "concat"
        ? concatPlaylistPath || path.join(outputRoot, CONCAT_PLAYLIST_FILE_NAME)
        : mediaAsset.filePath;
    const attempts = buildLiveHlsTranscodeAttempts({
        inputFormat,
        inputPath,
        playlistPath,
        segmentPattern,
        startOffsetSeconds,
        transcodeAcceleration,
    });
    let lastError: unknown = null;

    for (const [attemptIndex, attempt] of attempts.entries()) {
        await fs.rm(outputRoot, { recursive: true, force: true });
        await fs.mkdir(outputRoot, { recursive: true });
        if (inputFormat === "concat") {
            await writeConcatPlaylist(inputPath, plannedMediaAssets);
        }

        const ffmpeg = spawn("ffmpeg", attempt.args, {
            stdio: ["ignore", "pipe", "pipe"],
        });

        try {
            await waitForPlaylist(playlistPath, ffmpeg);
            return {
                playlistPath,
                process: ffmpeg,
                usesHardwareAcceleration: attempt.usesHardwareAcceleration,
            };
        } catch (error) {
            lastError = error;
            if (!ffmpeg.killed) {
                ffmpeg.kill("SIGTERM");
            }
            if (attemptIndex === attempts.length - 1) {
                break;
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function plannedDurationSeconds(steps: InternalPlayoutPlanStep[]): number {
    if (!steps[0] || !steps.at(-1)) {
        return 0;
    }
    return Math.max(
        0,
        (steps.at(-1)!.stopAt.getTime() - steps[0].startAt.getTime()) / 1000
    );
}

function resolvePlannedRenewalAt(steps: InternalPlayoutPlanStep[]): Date | null {
    const lastStep = steps.at(-1);
    if (!steps[0] || !lastStep) {
        return null;
    }

    const latestRenewalBoundaryMs = lastStep.stopAt.getTime() - MIN_FUTURE_PLAYOUT_MS;
    let renewalAt: Date | null = null;
    for (const step of steps) {
        if (step.stopAt.getTime() > latestRenewalBoundaryMs) {
            break;
        }
        renewalAt = step.stopAt;
    }

    return renewalAt;
}

export function createInternalPlayout(options: InternalPlayoutOptions) {
    const transcodeAcceleration =
        options.transcodeAcceleration || DEFAULT_TRANSCODE_ACCELERATION;
    let active: ActivePlayout | null = null;
    let diagnostics: InternalPlayoutDiagnostics = {
        configured: true,
        activeAssetPath: null,
        activeAssetRole: null,
        activeAssetTitle: null,
        ffmpegPid: null,
        hardwareAccelerationActive: false,
        hardwareAccelerationAvailable: transcodeAcceleration.hardwareAvailable,
        hardwareDevicePath: transcodeAcceleration.devicePath,
        lastFailureAt: null,
        lastFailureMessage: null,
        lastStartAt: null,
        outputRoot: path.join(options.hlsOutputRoot, CHANNEL_OUTPUT_DIRECTORY),
        plannedDurationSeconds: null,
        plannedItemCount: null,
        plannedRenewalAt: null,
        plannedStopAt: null,
        resumeMode: null,
        resumeOffsetSeconds: null,
        resumeReason: null,
        transcodeAccelerationMode: transcodeAcceleration.mode,
    };

    let desiredRunning = false;
    let startInFlight: Promise<ActivePlayout> | null = null;
    let stateUpdateInFlight: Promise<void> | null = null;
    let restartTimer: NodeJS.Timeout | null = null;
    let renewalTimer: NodeJS.Timeout | null = null;

    function clearRestartTimer() {
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
    }

    function clearRenewalTimer() {
        if (renewalTimer) {
            clearTimeout(renewalTimer);
            renewalTimer = null;
        }
    }

    function scheduleRestart(delayMs: number) {
        if (!desiredRunning || restartTimer) {
            return;
        }
        restartTimer = setTimeout(() => {
            restartTimer = null;
            void ensureLiveHls().catch((error) => {
                diagnostics = {
                    ...diagnostics,
                    lastFailureAt: new Date().toISOString(),
                    lastFailureMessage: error instanceof Error ? error.message : String(error),
                };
                scheduleRestart(RESTART_AFTER_FAILURE_MS);
            });
        }, delayMs);
        restartTimer.unref?.();
    }

    function scheduleRenewal(playout: ActivePlayout, steps: InternalPlayoutPlanStep[]) {
        clearRenewalTimer();
        const process = playout.process;
        if (!process) {
            return;
        }

        const renewalAt = resolvePlannedRenewalAt(steps);
        diagnostics = {
            ...diagnostics,
            plannedRenewalAt: renewalAt?.toISOString() || null,
        };
        if (!renewalAt) {
            return;
        }

        const delayMs = Math.max(0, renewalAt.getTime() - getCurrentDate(options).getTime());
        renewalTimer = setTimeout(() => {
            if (active !== playout || process.killed) {
                return;
            }
            playout.renewing = true;
            process.kill("SIGTERM");
        }, delayMs);
        renewalTimer.unref?.();
    }

    function ensureLiveHls(): Promise<ActivePlayout> {
        desiredRunning = true;
        clearRestartTimer();
        if (startInFlight) {
            return startInFlight;
        }
        startInFlight = runEnsureLiveHls().finally(() => {
            startInFlight = null;
        });
        return startInFlight;
    }

    async function runEnsureLiveHls() {
        if (stateUpdateInFlight) {
            await stateUpdateInFlight;
        }

        if (active && await pathExists(active.playlistPath)) {
            return active;
        }

        const now = getCurrentDate(options);
        const outputRoot = path.join(options.hlsOutputRoot, CHANNEL_OUTPUT_DIRECTORY);
        const playlistPath = path.join(outputRoot, PLAYLIST_FILE_NAME);
        const concatPlaylistPath = path.join(outputRoot, CONCAT_PLAYLIST_FILE_NAME);
        const segmentPattern = path.join(outputRoot, SEGMENT_FILE_PATTERN);
        const plan = await loadInternalPlayoutPlan(scheduleOptions(options), {
            canSeekMediaAsset: options.canSeekMediaAsset || (() => true),
            horizonMs: PLAYOUT_HORIZON_MS,
        });
        const mediaAssets = plan.steps.map((step) => step.mediaAsset);
        const transcodeLiveHls = options.transcodeLiveHls || transcodeMediaAssetToLiveHls;

        if (active?.process && !active.process.killed) {
            active.renewing = true;
            active.process.kill("SIGTERM");
        }

        try {
            const result = await transcodeLiveHls({
                concatPlaylistPath,
                mediaAsset: plan.mediaAsset,
                mediaAssets,
                outputRoot,
                playlistPath,
                segmentPattern,
                startOffsetSeconds: plan.startOffsetSeconds,
                transcodeAcceleration,
            });
            const historyId = await recordPlayoutStart(
                options.db,
                plan.mediaAsset,
                now,
                plan.startOffsetSeconds
            );
            await persistInternalPlayoutPlanState(
                scheduleOptions(options),
                plan.currentState
            );

            const playout: ActivePlayout = {
                assetId: plan.mediaAsset.id,
                finalState: plan.finalState,
                historyId,
                outputRoot,
                planStopAt: plan.steps.at(-1)?.stopAt || now,
                playlistPath: result.playlistPath,
                process: result.process,
                renewing: false,
            };
            active = playout;

            result.process?.once("exit", (code, signal) => {
                void handleProcessExit(playout, code, signal);
            });

            diagnostics = {
                ...diagnostics,
                activeAssetPath: plan.mediaAsset.filePath,
                activeAssetRole: plan.mediaAsset.role,
                activeAssetTitle: plan.mediaAsset.title,
                ffmpegPid: result.process?.pid || null,
                hardwareAccelerationActive: Boolean(result.usesHardwareAcceleration),
                lastFailureAt: null,
                lastFailureMessage: null,
                lastStartAt: now.toISOString(),
                outputRoot,
                plannedDurationSeconds: plannedDurationSeconds(plan.steps),
                plannedItemCount: plan.steps.length,
                plannedStopAt: playout.planStopAt.toISOString(),
                resumeMode: plan.resumeMode,
                resumeOffsetSeconds: plan.startOffsetSeconds,
                resumeReason: plan.resumeReason,
            };
            scheduleRenewal(playout, plan.steps);
            return playout;
        } catch (error) {
            diagnostics = {
                ...diagnostics,
                activeAssetPath: plan.mediaAsset.filePath,
                activeAssetRole: plan.mediaAsset.role,
                activeAssetTitle: plan.mediaAsset.title,
                ffmpegPid: null,
                hardwareAccelerationActive: false,
                lastFailureAt: new Date().toISOString(),
                lastFailureMessage: error instanceof Error ? error.message : String(error),
            };
            throw error;
        }
    }

    async function handleProcessExit(
        playout: ActivePlayout,
        code: number | null,
        signal: NodeJS.Signals | null
    ) {
        if (active !== playout) {
            return;
        }

        clearRenewalTimer();
        active = null;
        diagnostics = {
            ...diagnostics,
            ffmpegPid: null,
            hardwareAccelerationActive: false,
        };

        if (playout.renewing) {
            scheduleRestart(RESTART_AFTER_EXIT_MS);
            return;
        }

        if (code === 0) {
            stateUpdateInFlight = (async () => {
                await markPlayoutHistoryCompleted(
                    options.db,
                    playout.historyId,
                    getCurrentDate(options),
                    "completed"
                );
                await persistInternalPlayoutPlanState(
                    scheduleOptions(options),
                    playout.finalState
                );
            })()
                .catch((error) => {
                    diagnostics = {
                        ...diagnostics,
                        lastFailureAt: new Date().toISOString(),
                        lastFailureMessage: error instanceof Error
                            ? error.message
                            : String(error),
                    };
                })
                .finally(() => {
                    stateUpdateInFlight = null;
                    scheduleRestart(RESTART_AFTER_EXIT_MS);
                });
            return;
        }

        diagnostics = {
            ...diagnostics,
            lastFailureAt: new Date().toISOString(),
            lastFailureMessage: `ffmpeg exited (${signal || code})`,
        };
        scheduleRestart(RESTART_AFTER_FAILURE_MS);
    }

    async function waitForCompletion() {
        while (stateUpdateInFlight) {
            await stateUpdateInFlight;
        }
    }

    async function waitUntilReady(timeoutMs = READY_TIMEOUT_MS): Promise<ActivePlayout> {
        if (active && await pathExists(active.playlistPath)) {
            return active;
        }
        if (!startInFlight) {
            throw new Error("internal playout has not started");
        }

        let timeout: NodeJS.Timeout | null = null;
        try {
            return await Promise.race([
                startInFlight,
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(() => {
                        reject(new Error("internal playout is still starting"));
                    }, timeoutMs);
                    timeout.unref?.();
                }),
            ]);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
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
        getDiagnostics: () => diagnostics,
        resolveHlsFile,
        start: ensureLiveHls,
        waitForCompletion,
        waitUntilReady,
    };
}
