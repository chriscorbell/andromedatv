# Metadata Contract

This contract defines the Sidecar Override file format and the AniDB Metadata Refresh behavior that future AniDB Metadata Cache implementation must follow.

## Sidecar Override Format

Sidecar Overrides are UTF-8 JSON files named `andromeda.sidecar.json`. A sidecar lives in a Series directory under the Conventional Library Layout and describes that Series plus any Episode Assets beneath that directory.

Episode paths are relative to the sidecar file's directory. Implementations must normalize path separators to `/` and reject absolute paths, `..` segments, and paths that resolve outside the Series directory.

Example:

```json
{
  "sidecarVersion": 1,
  "series": {
    "title": "Crest of the Stars",
    "sortTitle": "Crest of the Stars",
    "anidbSeriesId": 1,
    "synonyms": ["Seikai no Monshou"]
  },
  "episodes": [
    {
      "path": "Crest of the Stars - 01.mkv",
      "anidbEpisodeId": 1010,
      "episodeNumber": "1",
      "title": "Invasion",
      "summary": "A local curation note may replace the cached episode summary.",
      "chronologicalOrder": 1
    },
    {
      "path": "Specials/Crest of the Stars - Opening.mkv",
      "title": "Opening",
      "episodeNumber": "OP1",
      "chronologicalOrder": 0.5,
      "exclude": true
    }
  ]
}
```

## Allowed Override Fields

Only the fields listed here may override AniDB Metadata Cache values. Unknown fields are invalid and should produce a scanner diagnostic so typos do not silently change schedule behavior.

- `sidecarVersion`: required integer. Version `1` is the only accepted version for this contract.
- `series.title`: display title for the Series.
- `series.sortTitle`: stable display sorting hint. It does not change Series Rotation order after Channel State exists.
- `series.anidbSeriesId`: AniDB anime id for cache lookup and first-add refresh.
- `series.synonyms`: alternate local titles used only as matching hints and diagnostics.
- `episodes[].path`: required relative path to the Episode Asset being overridden.
- `episodes[].anidbEpisodeId`: AniDB episode id for cache lookup and diagnostics.
- `episodes[].episodeNumber`: local display episode number or label.
- `episodes[].title`: display title for the Episode.
- `episodes[].summary`: display summary for schedule payloads.
- `episodes[].airDate`: optional ISO `YYYY-MM-DD` display date.
- `episodes[].chronologicalOrder`: finite number used as the highest-authority Chronological Episode Order position.
- `episodes[].exclude`: when `true`, the Episode Asset remains diagnosable but is removed from schedulable Chronological Episode Order.

Absent fields do not erase lower-authority metadata. Empty strings are invalid for override fields because they would hide useful cached metadata without replacing it.

Chronological Episode Order is resolved in this order:

1. Episode Assets with sidecar `chronologicalOrder` sort by that value.
2. Episode Assets without sidecar `chronologicalOrder` sort by cached AniDB episode order when cached metadata exists.
3. Filename season/episode inference is only a fallback for diagnostics and for explicitly temporary slices that have not yet adopted the AniDB Metadata Cache.

Duplicate `episodes[].path` entries are invalid. Duplicate `chronologicalOrder` values inside the same Series are invalid for the affected Episode Assets; those assets must be reported as unresolved rather than guessed into the schedule.

## Metadata Refresh

Metadata Refresh fetches AniDB data into the AniDB Metadata Cache. Refresh is controlled so normal live playout, schedule generation, and server startup do not depend on AniDB availability.

Refresh is allowed only in these cases:

- `first-add`: a Library scan resolves a Series to an `anidbSeriesId`, usually from Sidecar Override or a future matching flow, and no successful AniDB Metadata Cache row exists for that AniDB Series id.
- `on-demand`: an operator explicitly requests refresh for one Series through an admin action or maintenance command.

Refresh must not run just because the server starts, a Library scan repeats, `/api/schedule` is requested, or a schedule item is selected for playout. Sidecar file edits are picked up by the next Library scan; they trigger AniDB refresh only when they introduce a new `anidbSeriesId` with no successful cache row or when the operator requests on-demand refresh.

Refresh is asynchronous from scheduling. If cached metadata already exists, the existing cache remains authoritative until a refresh succeeds and is committed. If no cached metadata exists and refresh is pending or failed, the affected Series is excluded from Series Rotation and surfaced in diagnostics.

## Rate Limits And Failure Behavior

AniDB's HTTP API documentation requires heavy local caching, warns that repeated same-day requests for the same dataset can get a client banned, and says clients should request no more than one page every two seconds: <https://wiki.anidb.net/HTTP_API_Definition#Flooding_and_Caching>.

AndromedaTV must therefore implement refresh with these limits:

- Use one global AniDB refresh queue per process.
- Send at most one AniDB HTTP request every three seconds.
- Deduplicate refresh jobs by `anidbSeriesId`.
- Do not request the same AniDB Series dataset more than once in a 24-hour window. A skipped on-demand request should report that cached data is already fresh enough rather than bypassing the limit.
- Store `last_success_at`, `last_attempt_at`, `last_error`, `next_retry_at`, and cache freshness diagnostics with the metadata cache.

Failures include network errors, timeouts, non-XML responses, XML `<error>` payloads, parse errors, and explicit banned or throttled responses. On failure:

- Keep any previous successful cache rows.
- Mark the refresh attempt failed with a durable diagnostic.
- Retry only through the queue after backoff; start with 15 minutes, then 1 hour, then 6 hours until an operator intervenes or the next allowed on-demand refresh is requested.
- Exclude Series with no usable cache and no complete sidecar override from future Series Rotation.
- Live playout must continue from the existing Channel State and currently schedulable assets.

Diagnostics should expose unresolved Episode Assets, excluded Series, refresh queue state, most recent refresh error, and the next allowed retry time.
