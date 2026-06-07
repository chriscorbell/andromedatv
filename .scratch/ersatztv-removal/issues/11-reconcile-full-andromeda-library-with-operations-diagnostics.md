Status: ready-for-agent

## What to build

Move from the temporary Series Allowlist to full Andromeda Library operation while preserving Channel State through Library Reconciliation. Operators should be able to see scanner state, unresolved Episode Assets, excluded Series, playout state, and ffmpeg health well enough to maintain the 24/7 channel.

## Acceptance criteria

- [ ] Normal production operation can include the full Andromeda Library without the temporary Series Allowlist.
- [ ] New Schedulable Series are appended after the active Rotation Cycle without reshuffling existing Series Rotation.
- [ ] Removed or unschedulable Series are excluded from future selections.
- [x] New Episodes enter Chronological Episode Order without resetting the Series cursor unless the cursor points to missing media.
- [ ] Diagnostics expose scanner state, unresolved Episode Assets, excluded Series, current Channel State, Playout Engine state, and ffmpeg health.
- [ ] README and deployment docs no longer describe ErsatzTV as required for internal playout mode.

## Blocked by

- `.scratch/ersatztv-removal/issues/06-prove-playback-acceptance-in-current-web-ui.md`
- `.scratch/ersatztv-removal/issues/08-resolve-schedulable-series-from-anidb-metadata-cache.md`

## Comments

- 2026-06-07: Added the first Library Reconciliation tracer bullet. Internal schedule scans now reconcile persisted Channel State by preserving existing Series Rotation order, appending newly Schedulable Series after the current Rotation Cycle, pruning Series that are no longer schedulable, preserving valid Episode Cursors, and exposing current Channel State on `/api/status`. Remaining work: prove new Episode insertion behavior more explicitly, finish full Andromeda Library production configuration/docs cleanup, and expand operations diagnostics beyond the schedule Channel State slice.
- 2026-06-07: Added the Episode Cursor identity tracer bullet. Episode Cursors now persist the current Episode Asset file path and Library Reconciliation re-anchors the numeric cursor to that path after new Episodes enter Chronological Episode Order, falling back to the previous index only when the media path is gone. Remaining work: finish full Andromeda Library production configuration/docs cleanup and expand operations diagnostics beyond the schedule Channel State slice.
