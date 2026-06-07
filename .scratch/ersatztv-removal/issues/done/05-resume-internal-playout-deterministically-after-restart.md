Status: done

## What to build

Persist enough Channel State and playout history for internal playout to recover predictably after a server restart. Implement Boundary Resume as the safe fallback, and add the first Wall-clock Resume behavior where known durations and safe seeking make it reliable.

## Acceptance criteria

- [x] Restarting the server does not reshuffle Series Rotation or choose new random Episode Cursors.
- [x] The Playout Engine can resume from a known Media Asset boundary when Wall-clock Resume is unavailable.
- [x] Wall-clock Resume is used where elapsed real time, known durations, and safe seeking support it.
- [x] Resume behavior is reported in diagnostics, including whether Boundary Resume or Wall-clock Resume was used.
- [x] Tests cover restart recovery without relying on external ErsatzTV services.

## Blocked by

- `.scratch/ersatztv-removal/issues/04-advance-episode-to-bump-to-episode-on-playout-completion.md`
