import fs from "fs/promises";

export type TranscodeAccelerationMode = "required" | "preferred" | "disabled";

export type TranscodeAccelerationStatus = {
    devicePath: string;
    hardwareAvailable: boolean;
    mode: TranscodeAccelerationMode;
};

export type LiveHlsTranscodeAttempt = {
    args: string[];
    label: "cpu" | "intel-vaapi";
    usesHardwareAcceleration: boolean;
};

export type BuildLiveHlsTranscodeAttemptsOptions = {
    inputFormat?: "concat" | "media";
    inputPath: string;
    playlistPath: string;
    segmentPattern: string;
    startOffsetSeconds: number;
    transcodeAcceleration: TranscodeAccelerationStatus;
};

export type ValidateTranscodeAccelerationOptions = {
    devicePath: string;
    mode: TranscodeAccelerationMode;
    pathExists?: (filePath: string) => Promise<boolean>;
};

const LIVE_HLS_LIST_SIZE = 24;

async function defaultPathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export function parseTranscodeAccelerationMode(
    value: string | undefined
): TranscodeAccelerationMode {
    const normalized = (value || "").trim().toLowerCase();
    if (!normalized) {
        return "disabled";
    }
    if (
        normalized === "required" ||
        normalized === "preferred" ||
        normalized === "disabled"
    ) {
        return normalized;
    }

    throw new Error('TRANSCODE_ACCEL must be "required", "preferred", or "disabled"');
}

export async function validateTranscodeAcceleration({
    devicePath,
    mode,
    pathExists = defaultPathExists,
}: ValidateTranscodeAccelerationOptions): Promise<TranscodeAccelerationStatus> {
    const hardwareAvailable = await pathExists(devicePath);
    if (mode === "required" && !hardwareAvailable) {
        throw new Error(
            `TRANSCODE_ACCEL=required requires Intel hardware acceleration, but ${devicePath} is not available`
        );
    }

    return {
        devicePath,
        hardwareAvailable,
        mode,
    };
}

function formatFfmpegSeconds(seconds: number): string {
    return Math.max(0, seconds)
        .toFixed(3)
        .replace(/\.?0+$/, "");
}

function baseFfmpegInputArgs({
    inputFormat = "media",
    inputPath,
    startOffsetSeconds,
}: Pick<BuildLiveHlsTranscodeAttemptsOptions, "inputFormat" | "inputPath" | "startOffsetSeconds">): string[] {
    return [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-re",
        ...(startOffsetSeconds > 0 ? ["-ss", formatFfmpegSeconds(startOffsetSeconds)] : []),
        ...(inputFormat === "concat" ? ["-f", "concat", "-safe", "0"] : []),
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
    ];
}

function hlsOutputArgs({
    playlistPath,
    segmentPattern,
}: Pick<BuildLiveHlsTranscodeAttemptsOptions, "playlistPath" | "segmentPattern">): string[] {
    return [
        "-c:a",
        "aac",
        "-f",
        "hls",
        "-hls_time",
        "4",
        "-hls_list_size",
        String(LIVE_HLS_LIST_SIZE),
        "-hls_start_number_source",
        "epoch",
        "-hls_flags",
        "delete_segments+independent_segments",
        "-hls_segment_filename",
        segmentPattern,
        playlistPath,
    ];
}

function buildCpuAttempt(
    options: BuildLiveHlsTranscodeAttemptsOptions
): LiveHlsTranscodeAttempt {
    return {
        args: [
            ...baseFfmpegInputArgs(options),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            ...hlsOutputArgs(options),
        ],
        label: "cpu",
        usesHardwareAcceleration: false,
    };
}

function buildIntelVaapiAttempt(
    options: BuildLiveHlsTranscodeAttemptsOptions
): LiveHlsTranscodeAttempt {
    return {
        args: [
            "-hide_banner",
            "-loglevel",
            "warning",
            "-re",
            ...(options.startOffsetSeconds > 0
                ? ["-ss", formatFfmpegSeconds(options.startOffsetSeconds)]
                : []),
            "-vaapi_device",
            options.transcodeAcceleration.devicePath,
            ...(options.inputFormat === "concat" ? ["-f", "concat", "-safe", "0"] : []),
            "-i",
            options.inputPath,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            "format=nv12,hwupload",
            "-c:v",
            "h264_vaapi",
            // Arc (DG2) and recent iGPUs only expose the Low-Power H264 encode
            // entrypoint (VAEntrypointEncSliceLP); request it explicitly.
            "-low_power",
            "1",
            "-qp",
            "23",
            ...hlsOutputArgs(options),
        ],
        label: "intel-vaapi",
        usesHardwareAcceleration: true,
    };
}

export function buildLiveHlsTranscodeAttempts(
    options: BuildLiveHlsTranscodeAttemptsOptions
): LiveHlsTranscodeAttempt[] {
    const { transcodeAcceleration } = options;
    const cpuAttempt = buildCpuAttempt(options);

    if (transcodeAcceleration.mode === "disabled") {
        return [cpuAttempt];
    }

    if (!transcodeAcceleration.hardwareAvailable) {
        if (transcodeAcceleration.mode === "required") {
            throw new Error(
                `TRANSCODE_ACCEL=required requires Intel hardware acceleration, but ${transcodeAcceleration.devicePath} is not available`
            );
        }

        return [cpuAttempt];
    }

    const hardwareAttempt = buildIntelVaapiAttempt(options);
    if (transcodeAcceleration.mode === "required") {
        return [hardwareAttempt];
    }

    return [hardwareAttempt, cpuAttempt];
}
