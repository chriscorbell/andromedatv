import assert from "node:assert/strict";
import test from "node:test";

import {
    buildLiveHlsTranscodeAttempts,
    parseTranscodeAccelerationMode,
    validateTranscodeAcceleration,
} from "../dist/lib/transcode-acceleration.js";

test("transcode acceleration mode parses required, preferred, and disabled values", () => {
    assert.equal(parseTranscodeAccelerationMode("required"), "required");
    assert.equal(parseTranscodeAccelerationMode(" preferred "), "preferred");
    assert.equal(parseTranscodeAccelerationMode("DISABLED"), "disabled");
    assert.equal(parseTranscodeAccelerationMode(""), "disabled");
    assert.equal(parseTranscodeAccelerationMode(undefined), "disabled");
    assert.throws(
        () => parseTranscodeAccelerationMode("gpu"),
        /TRANSCODE_ACCEL must be "required", "preferred", or "disabled"/
    );
});

test("required transcode acceleration fails closed when the Intel render device is unavailable", async () => {
    await assert.rejects(
        validateTranscodeAcceleration({
            devicePath: "/missing/renderD128",
            mode: "required",
            pathExists: async () => false,
        }),
        /requires Intel hardware acceleration/
    );
});

test("disabled transcode acceleration keeps CPU-only development usable", async () => {
    const result = await validateTranscodeAcceleration({
        devicePath: "/missing/renderD128",
        mode: "disabled",
        pathExists: async () => false,
    });

    assert.deepEqual(result, {
        devicePath: "/missing/renderD128",
        hardwareAvailable: false,
        mode: "disabled",
    });
});

test("live HLS transcode attempts keep disabled mode on the CPU encoder", () => {
    const attempts = buildLiveHlsTranscodeAttempts({
        inputPath: "/media/episode.mkv",
        playlistPath: "/hls/hls.m3u8",
        segmentPattern: "/hls/segment-%05d.ts",
        startOffsetSeconds: 12,
        transcodeAcceleration: {
            devicePath: "/dev/dri/renderD128",
            hardwareAvailable: true,
            mode: "disabled",
        },
    });

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].usesHardwareAcceleration, false);
    assert.equal(attempts[0].label, "cpu");
    assert.ok(attempts[0].args.includes("libx264"));
    assert.ok(!attempts[0].args.includes("h264_vaapi"));
    const hlsListSizeIndex = attempts[0].args.indexOf("-hls_list_size");
    assert.notEqual(hlsListSizeIndex, -1);
    assert.equal(attempts[0].args[hlsListSizeIndex + 1], "24");
});

test("live HLS transcode attempts can read a concat playout plan", () => {
    const attempts = buildLiveHlsTranscodeAttempts({
        inputFormat: "concat",
        inputPath: "/hls/playout.ffconcat",
        playlistPath: "/hls/hls.m3u8",
        segmentPattern: "/hls/segment-%010d.ts",
        startOffsetSeconds: 0,
        transcodeAcceleration: {
            devicePath: "/dev/dri/renderD128",
            hardwareAvailable: true,
            mode: "disabled",
        },
    });

    const args = attempts[0].args;
    const inputIndex = args.indexOf("-i");

    assert.equal(args[inputIndex - 4], "-f");
    assert.equal(args[inputIndex - 3], "concat");
    assert.equal(args[inputIndex - 2], "-safe");
    assert.equal(args[inputIndex - 1], "0");
    assert.equal(args[inputIndex + 1], "/hls/playout.ffconcat");
    assert.ok(args.includes("-hls_start_number_source"));
});

test("preferred transcode acceleration tries Intel hardware before CPU fallback", () => {
    const attempts = buildLiveHlsTranscodeAttempts({
        inputPath: "/media/episode.mkv",
        playlistPath: "/hls/hls.m3u8",
        segmentPattern: "/hls/segment-%05d.ts",
        startOffsetSeconds: 0,
        transcodeAcceleration: {
            devicePath: "/dev/dri/renderD128",
            hardwareAvailable: true,
            mode: "preferred",
        },
    });

    assert.equal(attempts.length, 2);
    assert.deepEqual(
        attempts.map((attempt) => attempt.label),
        ["intel-vaapi", "cpu"]
    );
    assert.equal(attempts[0].usesHardwareAcceleration, true);
    assert.ok(attempts[0].args.includes("/dev/dri/renderD128"));
    assert.ok(attempts[0].args.includes("h264_vaapi"));
    assert.equal(attempts[1].usesHardwareAcceleration, false);
    assert.ok(attempts[1].args.includes("libx264"));
});

test("preferred transcode acceleration uses CPU when the Intel device is unavailable", () => {
    const attempts = buildLiveHlsTranscodeAttempts({
        inputPath: "/media/episode.mkv",
        playlistPath: "/hls/hls.m3u8",
        segmentPattern: "/hls/segment-%05d.ts",
        startOffsetSeconds: 0,
        transcodeAcceleration: {
            devicePath: "/dev/dri/renderD128",
            hardwareAvailable: false,
            mode: "preferred",
        },
    });

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].label, "cpu");
    assert.equal(attempts[0].usesHardwareAcceleration, false);
    assert.ok(attempts[0].args.includes("libx264"));
});

test("required transcode acceleration has no CPU fallback when hardware is available", () => {
    const attempts = buildLiveHlsTranscodeAttempts({
        inputPath: "/media/episode.mkv",
        playlistPath: "/hls/hls.m3u8",
        segmentPattern: "/hls/segment-%05d.ts",
        startOffsetSeconds: 0,
        transcodeAcceleration: {
            devicePath: "/dev/dri/renderD128",
            hardwareAvailable: true,
            mode: "required",
        },
    });

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].label, "intel-vaapi");
    assert.equal(attempts[0].usesHardwareAcceleration, true);
    assert.ok(!attempts[0].args.includes("libx264"));
});
