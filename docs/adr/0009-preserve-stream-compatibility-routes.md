# Preserve stream compatibility routes

AndromedaTV will keep `/api/schedule` and `/iptv/session/1/hls.m3u8` as Compatibility Routes while replacing the ErsatzTV-backed implementation. The routes should move from proxying external XMLTV and HLS to serving AndromedaTV's own schedule and Live HLS Output, keeping the frontend and deployment surface stable during the migration.
