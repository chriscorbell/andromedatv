# Local metadata cache

AndromedaTV will store AniDB Series and Episode metadata in SQLite and use that AniDB Metadata Cache during normal Library scans and schedule generation. It will fetch AniDB metadata only when a Series is first added or when an operator requests a Metadata Refresh, and the initial metadata database may be seeded ahead of first run from the current Jellyfin library data under `/docker/data/jellyfin/config`; that migration does not need to be built into the app runtime.
