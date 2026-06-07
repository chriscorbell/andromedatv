# ErsatzTV Removal Plan

This plan replaces the current Jellyfin/ErsatzTV runtime dependency with AndromedaTV's own single-channel playout server. The first goal is a real vertical slice against the Andromeda Library at `/nas/media/andromeda`, while keeping the current web UI and compatibility routes stable.

## Current State

AndromedaTV currently serves the React app, chat API, schedule API, and IPTV proxy from one backend process. The stream and schedule behavior depend on external ErsatzTV routes:

- `/api/schedule` fetches and normalizes ErsatzTV XMLTV.
- `/iptv/session/1/hls.m3u8` proxies ErsatzTV HLS.
- `ERSATZTV_BASE_URL` is required at server startup.

Jellyfin is not directly integrated into this repo today. It is an upstream metadata/library source used by ErsatzTV. Existing Jellyfin metadata may seed the new SQLite metadata database before the first replacement run, but Jellyfin should not become runtime app behavior.

## Target Shape

AndromedaTV remains a single-container deployment. Internally, the backend should be split into modules for scanning, metadata, scheduling, playout, and HLS serving.

The app should preserve these compatibility routes for v1:

- `/api/schedule`
- `/iptv/session/1/hls.m3u8`

The implementation behind those routes changes from external proxying to internal AndromedaTV behavior.

## Library Contract

Milestone 1 uses the real Andromeda Library:

- Series root: `/nas/media/andromeda/series`
- Bumps root: `/nas/media/andromeda/bumps`

The scanner should assume a Conventional Library Layout:

```text
/nas/media/andromeda/
  series/
    Series Name/
      ...episode files...
  bumps/
    bump01.mp4
    bump02.mp4
```

For the first vertical slice, support a temporary Series Allowlist so development can start with a small set of real series before reconciling the full library.

## Scheduler Model

On first run, AndromedaTV creates persistent Channel State:

1. Discover Schedulable Series from the configured library and allowlist.
2. Randomize Series Rotation.
3. Choose a random Episode Cursor for each Series.
4. Build a Round-robin Series Queue by playing one Episode per Series Rotation slot.
5. Insert the next Bump Asset after every Episode.
6. Use filename sort for Bump Rotation.
7. Wrap a Series cursor to the first Episode after the final Episode plays.
8. Wrap the Bump Cursor to the first Bump Asset after the final Bump Asset plays.

Channel State must survive restarts. Restart recovery should prefer Wall-clock Resume when durations and seeking support are available, with Boundary Resume as the fallback.

Library Reconciliation should preserve the existing rotation:

- New Schedulable Series are appended after the active Rotation Cycle.
- Removed or unschedulable Series are excluded from future selections.
- New Episodes enter their Series' Chronological Episode Order without resetting the cursor unless the cursor points to missing media.

## Metadata Model

The authority order is:

1. Sidecar Override
2. AniDB Metadata Cache
3. Filename/folder inference

AniDB Series and Episode metadata should be stored in SQLite. AniDB should be fetched only when a Series is first added or when an operator requests Metadata Refresh. Live playout must not depend on AniDB availability.

The current Jellyfin data under `/docker/data/jellyfin/config` may be used to seed the initial metadata database before first run. This migration does not need to be built into the app runtime.

The detailed Sidecar Override format, allowed override fields, Metadata Refresh triggers, and AniDB rate-limit/failure behavior are defined in `docs/metadata-contract.md`.

## Playout Model

Milestone 1 should run one ffmpeg process per Media Asset and produce Live HLS Output for the compatibility HLS route.

For v1, every source should transcode into a Uniform HLS Profile rather than attempting stream-copy. Development and initial tests may use CPU transcoding. Production should support Intel Arc A310 Hardware Transcoding through configurable Transcode Acceleration Mode:

- `required`: hardware acceleration is required; fail closed if unavailable.
- `preferred`: try hardware first, fall back to CPU with diagnostics.
- `disabled`: CPU only for development and tests.

The current Docker runtime does not include ffmpeg, Intel media drivers, or GPU device access, so production container work must add those explicitly.

## Phase 1: Scanner And Duration Index

Goal: discover real Media Assets and collect enough facts to schedule and play them.

Tasks:

- Add library configuration for series root, bumps root, and optional Series Allowlist.
- Scan Episode Assets under `series/`.
- Scan Bump Assets under `bumps/` using filename sort.
- Ignore unsupported or unreadable files with diagnostics.
- Use `ffprobe` to collect duration and basic stream facts.
- Persist discovered assets and durations in SQLite.

Acceptance:

- A small allowlisted set from `/nas/media/andromeda/series` scans successfully.
- `/nas/media/andromeda/bumps` produces a deterministic Bump Rotation.
- Scanner tests cover classification, sorting, and unsupported-file handling.

## Phase 2: Channel State And Queue Generation

Goal: create the internal schedule without ErsatzTV.

Tasks:

- Add SQLite tables for Channel State, Series Rotation, Episode Cursors, Bump Cursor, and playout history.
- Generate first-run randomized Series Rotation and random Episode Cursors.
- Generate a forward-looking Playout Queue from current Channel State.
- Keep schedule prediction separate from Playout Completion.
- Implement Library Reconciliation rules for added/removed assets.

Acceptance:

- Re-running the server does not reshuffle existing Channel State.
- Queue generation alternates Episode, Bump, Episode, Bump.
- Series and bump cursors wrap correctly.
- Unit tests prove deterministic behavior when seeded randomness is controlled.

## Phase 3: Internal Schedule API

Goal: keep `/api/schedule` stable while replacing XMLTV normalization.

Tasks:

- Replace or mode-gate the current ErsatzTV XMLTV schedule loader.
- Return the existing normalized schedule payload shape.
- Include title, episode label, description when available, start/stop times from predicted durations, and live marker.
- Keep diagnostics for schedule health.
- Remove `ERSATZTV_BASE_URL` as a requirement in internal playout mode.

Acceptance:

- The existing React schedule panel renders the internal queue.
- Existing schedule tests are adapted or preserved around the same API contract.
- Server starts without `ERSATZTV_BASE_URL` in internal mode.

## Phase 4: CPU/Dev HLS Playout

Goal: serve real HLS from AndromedaTV through the current HLS compatibility route.

Tasks:

- Add a Playout Engine that runs ffmpeg per Media Asset.
- Produce HLS playlist and segments into an app-controlled output directory.
- Serve `/iptv/session/1/hls.m3u8` and segment files from that output.
- Advance Channel State only on Playout Completion.
- Handle ffmpeg failure by reporting diagnostics and skipping or retrying according to a simple first policy.
- Implement a basic Boundary Resume, then add Wall-clock Resume once duration/seek behavior is reliable.

Acceptance:

- The existing video player loads the internal HLS URL.
- Playback transitions from episode to bump to next episode.
- A restart resumes deterministically.
- ffmpeg errors surface through logs or `/api/status` diagnostics.

## Phase 5: Playback Acceptance In Current UI

Goal: prove the replacement through the user-facing app.

Tasks:

- Run the app against `/nas/media/andromeda` with a small Series Allowlist.
- Confirm `/api/schedule` and video playback agree on the current item.
- Confirm controls and existing HLS.js behavior still work.
- Run or update Playwright smoke coverage for the internal playout mode when practical.

Acceptance:

- The existing web UI displays the generated schedule.
- The existing web UI plays the generated HLS stream.
- Episode-to-bump-to-episode transition is observed in-browser.
- No external ErsatzTV container is required for this path.

## Phase 6: AniDB Metadata Cache

Goal: move from filename fallback toward trusted metadata.

Tasks:

- Add SQLite tables for AniDB Series and Episode metadata.
- Resolve Series and Episode identities from Sidecar Overrides and cached AniDB metadata.
- Fetch AniDB metadata only on first Series addition or explicit Metadata Refresh.
- Keep unresolved assets playable only when safe, but exclude unresolved Series from Series Rotation.
- Add diagnostics for unresolved Episode Assets.

Acceptance:

- A Series can become schedulable from cached AniDB data.
- AniDB downtime does not interrupt playout.
- Sidecar Overrides win over cached AniDB data.

## Phase 7: Jellyfin Metadata Seed

Goal: preserve useful existing metadata before the first production run.

Tasks:

- Document or script an offline migration from `/docker/data/jellyfin/config` into AndromedaTV's SQLite metadata tables.
- Treat the result as AniDB Metadata Cache contents, not as an ongoing Jellyfin dependency.
- Keep the migration outside normal app startup.

Acceptance:

- The seed can populate known Series/Episode identities before first internal playout run.
- AndromedaTV runs afterward with no Jellyfin runtime access.

## Phase 8: Intel Arc Production Transcoding

Goal: make continuous production playout viable on the target server.

Tasks:

- Install or package an ffmpeg build with Intel hardware acceleration support.
- Add container runtime/device configuration for `/dev/dri`.
- Add `TRANSCODE_ACCEL` or equivalent configuration.
- Implement startup validation for `required` mode.
- Keep CPU-only mode available for dev/test.

Acceptance:

- Production mode fails closed when Intel hardware acceleration is required but unavailable.
- Hardware transcoding is used on the Intel Arc A310 host.
- Diagnostics clearly report the active acceleration mode.

## Phase 9: Full Library And Operations

Goal: remove temporary constraints and make the system maintainable.

Tasks:

- Remove or disable the Series Allowlist for normal production.
- Reconcile the full `/nas/media/andromeda/series` library.
- Add admin/diagnostic views or endpoints for scanner state, unresolved assets, playout state, and ffmpeg health.
- Update README and deployment docs for the new environment variables and volume mounts.
- Remove obsolete ErsatzTV proxy assumptions from docs and tests.

Acceptance:

- The full Andromeda Library participates in scheduling according to reconciliation rules.
- Operators can see why assets or Series are excluded.
- README no longer describes ErsatzTV as required for the internal playout path.

## Open Questions

These should be answered during implementation, not guessed too early:

- Exact Uniform HLS Profile: resolution cap, bitrate, segment length, audio layout, subtitle behavior.
- First ffmpeg failure policy: skip once, retry once, quarantine asset, or stop playout.
- How much Wall-clock Resume is needed in the first vertical slice.
- Whether `/iptv/*` should eventually be renamed after compatibility is no longer important.
