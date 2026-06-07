Status: done

## What to build

Add configurable Transcode Acceleration Mode and production deployment support for Intel Arc A310 Hardware Transcoding. Development and tests must still be able to run CPU-only, while production can require hardware acceleration and fail closed when the GPU path is unavailable.

## Acceptance criteria

- [x] Transcode Acceleration Mode supports required, preferred, and disabled behavior.
- [x] CPU-only mode remains usable for development and automated tests.
- [x] Production startup validation fails closed when hardware acceleration is required but unavailable.
- [x] Container/runtime documentation covers ffmpeg, Intel media support, and `/dev/dri` device access.
- [x] Diagnostics report the active acceleration mode and whether hardware acceleration is being used.
- [x] Intel Arc A310 behavior is verified or explicitly documented as requiring host validation.

## Blocked by

- `.scratch/ersatztv-removal/issues/03-produce-cpu-live-hls-output-for-current-media-asset.md`
