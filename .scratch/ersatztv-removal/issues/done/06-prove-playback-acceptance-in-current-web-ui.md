Status: done

## What to build

Prove Playback Acceptance for the internal playout Vertical Slice through the existing AndromedaTV web UI. The UI should display the generated internal schedule, play the generated HLS stream, and observe an episode-to-bump-to-episode transition without depending on ErsatzTV.

## Acceptance criteria

- [x] The app runs against the Andromeda Library with a small Series Allowlist in internal playout mode.
- [x] The existing schedule panel displays the generated internal schedule.
- [x] The existing video player plays the internal HLS stream through `/iptv/session/1/hls.m3u8`.
- [x] A browser-level smoke check observes or verifies an episode-to-bump-to-episode transition.
- [x] The acceptance path does not require an external ErsatzTV container or `ERSATZTV_BASE_URL`.

## Blocked by

- `.scratch/ersatztv-removal/issues/05-resume-internal-playout-deterministically-after-restart.md`
