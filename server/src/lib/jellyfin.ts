import type { ScheduleItem } from "./schedule";

type Logger = Pick<Console, "info" | "warn" | "error">;

type JellyfinItem = {
    Name?: string;
    ProductionYear?: number;
};

type JellyfinItemsResponse = {
    Items?: JellyfinItem[];
};

export type JellyfinSeriesYearProvider = {
    enrichScheduleWithYears: (items: ScheduleItem[]) => Promise<ScheduleItem[]>;
};

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function normalizeTitle(title: string): string {
    return title.trim().toLowerCase();
}

function buildItemsUrl(baseUrl: URL): URL {
    const url = new URL(baseUrl.toString());
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/Items`;
    url.searchParams.set("IncludeItemTypes", "Series");
    url.searchParams.set("Recursive", "true");
    url.searchParams.set("Fields", "ProductionYear");
    return url;
}

/**
 * Series release years live in Jellyfin, not the XMLTV feed (which only carries
 * `<date>` for movies). This provider fetches the Series -> ProductionYear map
 * once, caches it, and fills in the `year` for episode schedule items by title.
 */
export function createJellyfinSeriesYearProvider(config: {
    baseUrl: URL;
    apiKey: string;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    cacheTtlMs?: number;
}): JellyfinSeriesYearProvider {
    const {
        baseUrl,
        apiKey,
        logger = console,
        fetchImpl = fetch,
        cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    } = config;

    const itemsUrl = buildItemsUrl(baseUrl).toString();
    let cache: { expiresAt: number; map: Map<string, string> } | null = null;
    let inflight: Promise<Map<string, string>> | null = null;

    const fetchSeriesYearMap = async (): Promise<Map<string, string>> => {
        const response = await fetchImpl(itemsUrl, {
            headers: { "X-Emby-Token": apiKey },
        });

        if (!response.ok) {
            throw new Error(`Jellyfin request failed: ${response.status}`);
        }

        const data = (await response.json()) as JellyfinItemsResponse;
        const map = new Map<string, string>();
        for (const item of data.Items ?? []) {
            if (
                item.Name &&
                typeof item.ProductionYear === "number" &&
                item.ProductionYear > 0
            ) {
                map.set(normalizeTitle(item.Name), String(item.ProductionYear));
            }
        }
        return map;
    };

    const getSeriesYearMap = async (): Promise<Map<string, string>> => {
        if (cache && cache.expiresAt > Date.now()) {
            return cache.map;
        }
        if (inflight) {
            return inflight;
        }

        inflight = (async () => {
            const map = await fetchSeriesYearMap();
            cache = { expiresAt: Date.now() + cacheTtlMs, map };
            return map;
        })();

        try {
            return await inflight;
        } finally {
            inflight = null;
        }
    };

    const enrichScheduleWithYears = async (
        items: ScheduleItem[],
    ): Promise<ScheduleItem[]> => {
        // Only episodes (which have an `episode` line) are missing a year;
        // movies already carry one from the XMLTV `<date>`.
        if (!items.some((item) => item.episode && !item.year)) {
            return items;
        }

        try {
            const map = await getSeriesYearMap();
            return items.map((item) => {
                if (item.episode && !item.year) {
                    const year = map.get(normalizeTitle(item.title));
                    if (year) {
                        return { ...item, year };
                    }
                }
                return item;
            });
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
