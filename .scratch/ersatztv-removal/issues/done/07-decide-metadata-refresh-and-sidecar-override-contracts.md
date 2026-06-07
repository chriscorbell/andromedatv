Status: done

## What to build

Resolve the human-facing metadata decisions that must be settled before AniDB Metadata Cache implementation is AFK-ready. Define the Sidecar Override format, what fields it may override, how AniDB Metadata Refresh is triggered, and the rate-limit/error behavior expected when a Series is first added or refreshed on demand.

## Acceptance criteria

- [x] Sidecar Override file format is documented with at least one Series/Episode example.
- [x] The allowed override fields are documented, including how they affect Chronological Episode Order.
- [x] Metadata Refresh triggers are documented for first-add and on-demand refresh.
- [x] AniDB rate-limit and failure behavior is documented well enough for AFK implementation.
- [x] Any durable decisions are added to the appropriate domain docs or ADRs.

## Blocked by

- `.scratch/ersatztv-removal/issues/02-serve-schedule-preview-from-allowlisted-media-assets.md`
