Status: done

## What to build

Provide an offline migration path for seeding AndromedaTV's AniDB Metadata Cache from the existing Jellyfin data before the first production run. The result should populate AndromedaTV metadata tables while keeping Jellyfin out of normal app startup and runtime behavior.

## Acceptance criteria

- [x] The migration source under `/docker/data/jellyfin/config` is documented or scripted.
- [x] Seeded data lands in AndromedaTV's SQLite metadata tables as AniDB Metadata Cache contents.
- [x] The migration is not required or invoked during normal app startup.
- [x] AndromedaTV can run after seeding with no Jellyfin runtime access.
- [x] Failure or missing-source behavior is documented clearly for operators.

## Blocked by

- `.scratch/ersatztv-removal/issues/08-resolve-schedulable-series-from-anidb-metadata-cache.md`
