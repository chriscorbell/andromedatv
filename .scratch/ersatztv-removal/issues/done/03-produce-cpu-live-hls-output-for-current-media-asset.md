Status: done

## What to build

Use the current internal Playout Queue item to produce CPU/dev Live HLS Output for one Media Asset, then serve the generated playlist and segments through the existing `/iptv/session/1/hls.m3u8` compatibility route so the current video player can load AndromedaTV-owned HLS instead of proxying ErsatzTV.

## Acceptance criteria

- [x] The Playout Engine can run ffmpeg in CPU/dev mode for the current Media Asset.
- [x] Live HLS Output is written into an app-controlled output location.
- [x] `/iptv/session/1/hls.m3u8` serves the internal HLS playlist in internal playout mode.
- [x] HLS segment requests under the compatibility route are served from the internal output location.
- [x] The existing video player can load the internal HLS URL without changing its public URL.
- [x] ffmpeg startup and failure details are visible in logs or diagnostics.

## Blocked by

- `.scratch/ersatztv-removal/issues/02-serve-schedule-preview-from-allowlisted-media-assets.md`
