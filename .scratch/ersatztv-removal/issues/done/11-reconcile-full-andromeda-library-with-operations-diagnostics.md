Status: done

## What to build

Move from the temporary Series Allowlist to full Andromeda Library operation while preserving Channel State through Library Reconciliation. Operators should be able to see scanner state, unresolved Episode Assets, excluded Series, playout state, and ffmpeg health well enough to maintain the 24/7 channel.

## Acceptance criteria

- [x] Normal production operation can include the full Andromeda Library without the temporary Series Allowlist.
- [x] New Schedulable Series are appended after the active Rotation Cycle without reshuffling existing Series Rotation.
- [x] Removed or unschedulable Series are excluded from future selections.
- [x] New Episodes enter Chronological Episode Order without resetting the Series cursor unless the cursor points to missing media.
- [x] Diagnostics expose scanner state, unresolved Episode Assets, excluded Series, current Channel State, Playout Engine state, and ffmpeg health.
- [x] README and deployment docs no longer describe ErsatzTV as required for internal playout mode.

## Blocked by

- `.scratch/ersatztv-removal/issues/06-prove-playback-acceptance-in-current-web-ui.md`
- `.scratch/ersatztv-removal/issues/08-resolve-schedulable-series-from-anidb-metadata-cache.md`

## Comments

- 2026-06-07: Added the first Library Reconciliation tracer bullet (commit 80bf825). Internal schedule scans reconcile persisted Channel State by preserving existing Series Rotation order, appending newly Schedulable Series after the current Rotation Cycle, pruning Series that are no longer schedulable, preserving valid Episode Cursors, and exposing current Channel State on `/api/status`.
- 2026-06-07: Added the Episode Cursor identity tracer bullet (commit c8a07cd). Episode Cursors persist the current Episode Asset file path and Library Reconciliation re-anchors the numeric cursor to that path after new Episodes enter Chronological Episode Order, falling back to the previous index only when the media path is gone.
- 2026-06-07: Closed the issue. Added a regression test proving that a Series already in the persisted rotation is pruned from `series_rotation`, `episode_cursors`, and `media_assets` (and dropped from the schedule and Channel State diagnostics) when it is removed from the Library — covering the reconciliation side of "Removed or unschedulable Series are excluded from future selections" that the existing initial-scan exclusion test did not. Verified the remaining criteria were already implemented and tested across prior commits: full-library scanning with an empty allowlist (criterion 1), rotation append (criterion 2), cursor identity (criterion 4), and scanner/unresolved/excluded/Channel State/Playout/ffmpeg diagnostics on `/api/status` (criterion 5). Updated README to document internal mode as the full-library production path, note `ANDROMEDA_SERIES_ALLOWLIST` as an optional override, and state that internal mode does not require `ERSATZTV_BASE_URL` (criterion 6). No blockers for next iteration — all ErsatzTV-removal issues are now in `done/`.
