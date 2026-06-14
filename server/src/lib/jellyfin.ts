import type { ScheduleItem } from "./schedule";

type Logger = Pick<Console, "info" | "warn" | "error">;

type JellyfinSeries = {
    Id?: string;
    Name?: string;
    ProductionYear?: number;
};

type JellyfinEpisode = {
    ParentIndexNumber?: number; // season number
    IndexNumber?: number; // episode number within the season
    PremiereDate?: string; // original air date, e.g. "1998-04-03T00:00:00Z"
    ProductionYear?: number;
};

type JellyfinItemsResponse<T> = {
    Items?: T[];
};

export type JellyfinYearProvider = {
    enrichScheduleWithYears: (items: ScheduleItem[]) => Promise<ScheduleItem[]>;
};

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function normalizeTitle(title: string): string {
    return title.trim().toLowerCase();
}

/**
 * schedule.ts formats the episode line as `S01E02 – Sub title`. Pull the
 * season/episode numbers back out so we can address the exact episode in
 * Jellyfin. Returns null when the line carries no S/E prefix (e.g. an
 * untitled-but-numbered programme, or a sub-title only).
 */
export function parseEpisodeRef(
    episode: string,
): { season: number; episode: number } | null {
    const match = episode.match(/^S(\d+)E(\d+)/i);
    if (!match) {
        return null;
    }
    return { season: Number(match[1]), episode: Number(match[2]) };
}

/** What we can show after the episode line: a full air date and/or a year. */
type Release = { airDate?: string; year?: string };

/**
 * Prefer the episode's original air date (formatted MM/DD/YYYY); fall back to
 * just a year when only the air year or a production year is known. The ISO
 * string is sliced rather than parsed with `new Date()` so a UTC-midnight air
 * date can't roll back a day (and a year) in negative timezones.
 */
function episodeRelease(episode: JellyfinEpisode): Release {
    const premiere = episode.PremiereDate;
    if (premiere) {
        const full = premiere.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (full) {
            const [, year, month, day] = full;
            // Drop the zero-padding so it reads "4/24/1998", not "04/24/1998".
            return { airDate: `${Number(month)}/${Number(day)}/${year}`, year };
        }
        const yearOnly = premiere.match(/^(\d{4})/);
        if (yearOnly) {
            return { year: yearOnly[1] };
        }
    }
    if (
        typeof episode.ProductionYear === "number" &&
        episode.ProductionYear > 0
    ) {
        return { year: String(episode.ProductionYear) };
    }
    return {};
}

function buildSeriesUrl(baseUrl: URL): URL {
    const url = new URL(baseUrl.toString());
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/Items`;
    url.searchParams.set("IncludeItemTypes", "Series");
    url.searchParams.set("Recursive", "true");
    url.searchParams.set("Fields", "ProductionYear");
    return url;
}

function buildSeasonEpisodesUrl(
    baseUrl: URL,
    seriesId: string,
    season: number,
): URL {
    const url = new URL(baseUrl.toString());
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/Shows/${seriesId}/Episodes`;
    url.searchParams.set("season", String(season));
    url.searchParams.set("Fields", "PremiereDate");
    return url;
}

/**
 * Episode air years live in Jellyfin, not the XMLTV feed (which only carries
 * `<date>` for movies). This provider resolves the series shown on the schedule
 * to their Jellyfin ids, then fetches only the specific seasons that appear,
 * reading each episode's `PremiereDate`. Both the series list and each fetched
 * season are cached, so a curated channel settles into ~zero Jellyfin traffic.
 * Unmatched episodes fall back to the series' production year.
 */
export function createJellyfinYearProvider(config: {
    baseUrl: URL;
    apiKey: string;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    cacheTtlMs?: number;
}): JellyfinYearProvider {
    const {
        baseUrl,
        apiKey,
        logger = console,
        fetchImpl = fetch,
        cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    } = config;

    type SeriesEntry = { id: string; year?: string };
    let seriesCache: { expiresAt: number; map: Map<string, SeriesEntry> } | null =
        null;
    let seriesInflight: Promise<Map<string, SeriesEntry>> | null = null;

    // Episode releases keyed by `${seriesId}|${season}` -> episode -> release,
    // so the second scheduled episode of a season reuses the first one's fetch.
    const seasonCache = new Map<
        string,
        { expiresAt: number; releases: Map<number, Release> }
    >();
    const seasonInflight = new Map<string, Promise<Map<number, Release>>>();

    const fetchJson = async (url: string): Promise<unknown> => {
        const response = await fetchImpl(url, {
            headers: { "X-Emby-Token": apiKey },
        });
        if (!response.ok) {
            throw new Error(`Jellyfin request failed: ${response.status}`);
        }
        return response.json();
    };

    const getSeriesMap = async (): Promise<Map<string, SeriesEntry>> => {
        if (seriesCache && seriesCache.expiresAt > Date.now()) {
            return seriesCache.map;
        }
        if (seriesInflight) {
            return seriesInflight;
        }

        seriesInflight = (async () => {
            const data = (await fetchJson(
                buildSeriesUrl(baseUrl).toString(),
            )) as JellyfinItemsResponse<JellyfinSeries>;
            const map = new Map<string, SeriesEntry>();
            for (const item of data.Items ?? []) {
                if (item.Id && item.Name) {
                    const year =
                        typeof item.ProductionYear === "number" &&
                        item.ProductionYear > 0
                            ? String(item.ProductionYear)
                            : undefined;
                    map.set(normalizeTitle(item.Name), { id: item.Id, year });
                }
            }
            seriesCache = { expiresAt: Date.now() + cacheTtlMs, map };
            return map;
        })();

        try {
            return await seriesInflight;
        } finally {
            seriesInflight = null;
        }
    };

    const getSeasonReleases = async (
        seriesId: string,
        season: number,
    ): Promise<Map<number, Release>> => {
        const key = `${seriesId}|${season}`;
        const cached = seasonCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.releases;
        }
        const existing = seasonInflight.get(key);
        if (existing) {
            return existing;
        }

        const promise = (async () => {
            const data = (await fetchJson(
                buildSeasonEpisodesUrl(baseUrl, seriesId, season).toString(),
            )) as JellyfinItemsResponse<JellyfinEpisode>;
            const releases = new Map<number, Release>();
            for (const episode of data.Items ?? []) {
                if (typeof episode.IndexNumber === "number") {
                    const release = episodeRelease(episode);
                    if (release.airDate || release.year) {
                        releases.set(episode.IndexNumber, release);
                    }
                }
            }
            seasonCache.set(key, {
                expiresAt: Date.now() + cacheTtlMs,
                releases,
            });
            return releases;
        })();
        seasonInflight.set(key, promise);

        try {
            return await promise;
        } finally {
            seasonInflight.delete(key);
        }
    };

    const resolveRelease = async (
        item: ScheduleItem,
        series: SeriesEntry,
    ): Promise<Release> => {
        const ref = item.episode ? parseEpisodeRef(item.episode) : null;
        if (ref) {
            try {
                const releases = await getSeasonReleases(series.id, ref.season);
                const release = releases.get(ref.episode);
                if (release && (release.airDate || release.year)) {
                    return release;
                }
            } catch (error) {
                logger.warn(
                    `Failed to fetch episodes for ${item.title} S${ref.season}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
        // No per-episode air date available — fall back to the series year.
        return series.year ? { year: series.year } : {};
    };

    const enrichScheduleWithYears = async (
        items: ScheduleItem[],
    ): Promise<ScheduleItem[]> => {
        // Only episodes (which have an `episode` line) need a lookup; movies
        // already carry a year from the XMLTV `<date>`.
        if (!items.some((item) => item.episode && !item.year)) {
            return items;
        }

        try {
            const seriesMap = await getSeriesMap();

            return await Promise.all(
                items.map(async (item) => {
                    if (!item.episode || item.year) {
                        return item;
                    }
                    const series = seriesMap.get(normalizeTitle(item.title));
                    if (!series) {
                        return item;
                    }
                    const release = await resolveRelease(item, series);
                    if (release.airDate) {
                        return { ...item, airDate: release.airDate };
                    }
                    if (release.year) {
                        return { ...item, year: release.year };
                    }
                    return item;
                }),
            );
        } catch (error) {
            logger.warn(
                `Failed to enrich schedule with Jellyfin years: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return items;
        }
    };

    return { enrichScheduleWithYears };
}
