Status: ready-for-agent

## What to build

Scan allowlisted Episode Assets and filename-sorted Bump Assets from the Andromeda Library, collect duration facts, persist discovered Media Assets, create first Channel State, and serve an internal schedule preview through the existing `/api/schedule` compatibility route so the current schedule panel can display the internal Playout Queue.

## Acceptance criteria

- [x] An allowlisted subset of Series under the Andromeda Library can be scanned into Episode Assets.
- [x] Bump Assets under the configured bumps root are sorted deterministically by filename for Bump Rotation.
- [x] Media Asset duration and basic stream facts are collected or reported as scanner diagnostics when unavailable.
- [x] Discovered Media Assets and duration facts are persisted in SQLite.
- [x] First Channel State is created with Series Rotation, Episode Cursors, and Bump Cursor.
- [x] `/api/schedule` returns the existing normalized schedule payload shape using internal schedule prediction.
- [x] The existing schedule panel renders the internal schedule without frontend contract changes.

## Blocked by

- `.scratch/ersatztv-removal/issues/01-boot-internal-playout-mode-with-andromeda-library-diagnostics.md`
