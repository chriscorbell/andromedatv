# Metadata refresh and sidecar override contracts

AndromedaTV will treat `docs/metadata-contract.md` as the implementation contract for Sidecar Override files and AniDB Metadata Refresh. Sidecars are versioned `andromeda.sidecar.json` files in Series directories; they may override only documented Series and Episode fields, and sidecar `chronologicalOrder` is the highest authority for Chronological Episode Order.

AniDB Metadata Refresh will be cache-first and operator-controlled. The app may fetch AniDB data only on first-add of a resolved AniDB Series id or through an explicit on-demand operator request. Refresh work must run through a conservative queued rate limiter, keep previous successful cache rows on failure, exclude unresolved Series from future selections, and never interrupt Live HLS Output or existing Channel State.
