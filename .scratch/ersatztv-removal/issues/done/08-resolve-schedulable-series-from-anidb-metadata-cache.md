Status: ready-for-agent

## What to build

Add the AniDB Metadata Cache and use it, together with Sidecar Overrides, to resolve Schedulable Series and trusted Chronological Episode Order. Unresolved Episode Assets should be diagnosable, and unresolved or unschedulable Series should be excluded from Series Rotation without interrupting live playout.

## Acceptance criteria

- [x] SQLite stores AniDB Series and Episode metadata used by Library scans and schedule generation.
- [x] Sidecar Overrides take precedence over cached AniDB metadata.
- [x] A Series can become schedulable from cached AniDB metadata without live AniDB availability.
- [x] Metadata Refresh runs only for first-add or explicit on-demand refresh behavior defined by the contract issue.
- [x] Unresolved Episode Assets and excluded Series are visible in diagnostics.
- [x] Live playout continues when AniDB is unavailable.

## Blocked by

- `.scratch/ersatztv-removal/issues/07-decide-metadata-refresh-and-sidecar-override-contracts.md`
