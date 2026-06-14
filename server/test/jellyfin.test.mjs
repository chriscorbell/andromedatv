import assert from "node:assert/strict";
import test from "node:test";

import { createJellyfinYearProvider } from "../dist/lib/jellyfin.js";

const SERIES = [
    { Id: "conan", Name: "Detective Conan", ProductionYear: 1996 },
    { Id: "bebop", Name: "Cowboy Bebop", ProductionYear: 1998 },
];

// Keyed by `${seriesId}|${season}`.
const EPISODES = {
    "conan|5": [
        { IndexNumber: 10, PremiereDate: "2001-06-18T00:00:00.000Z" },
        { IndexNumber: 11, ProductionYear: 2001 }, // no PremiereDate -> ProductionYear
    ],
    "bebop|1": [{ IndexNumber: 1, PremiereDate: "1998-04-03T00:00:00.000Z" }],
};

function ok(body) {
    return { ok: true, status: 200, json: async () => body };
}

// Routes the series list and per-season episode endpoints, recording calls.
function makeRouter(calls, { failSeries = false, failSeason = false } = {}) {
    return async (url, init) => {
        calls.push({ url, init });

        if (url.includes("IncludeItemTypes=Series")) {
            if (failSeries) {
                return { ok: false, status: 500, json: async () => ({}) };
            }
            return ok({ Items: SERIES });
        }

        const match = url.match(/\/Shows\/([^/]+)\/Episodes/);
        if (match) {
            if (failSeason) {
                return { ok: false, status: 500, json: async () => ({}) };
            }
            const seriesId = match[1];
            const season = new URL(url).searchParams.get("season");
            return ok({ Items: EPISODES[`${seriesId}|${season}`] ?? [] });
        }

        return { ok: false, status: 404, json: async () => ({}) };
    };
}

function makeProvider(fetchImpl) {
    return createJellyfinYearProvider({
        baseUrl: new URL("http://jellyfin.local:8096"),
        apiKey: "secret",
        fetchImpl,
        logger: { info() {}, warn() {}, error() {} },
    });
}

test("uses the episode's full PremiereDate, not the series year", async () => {
    const calls = [];
    const provider = makeProvider(makeRouter(calls));

    const result = await provider.enrichScheduleWithYears([
        { title: "Detective Conan", episode: "S05E10 – Some Case" },
        { title: "Akira", year: "1988" }, // movie keeps its own year
        { title: "Unknown Show", episode: "S01E01 – Pilot" }, // no match -> nothing
    ]);

    // Full air date 6/18/2001, despite the series premiering in 1996.
    assert.equal(result[0].airDate, "6/18/2001");
    assert.equal(result[0].year, undefined);
    assert.equal(result[1].year, "1988");
    assert.equal(result[2].airDate, undefined);
    assert.equal(result[2].year, undefined);

    // Resolved series first, then fetched only the scheduled season.
    assert.equal(calls[0].init.headers["X-Emby-Token"], "secret");
    assert.ok(calls[0].url.includes("IncludeItemTypes=Series"));
    assert.ok(calls.some((c) => /\/Shows\/conan\/Episodes/.test(c.url)));
    assert.ok(calls.some((c) => new URL(c.url).searchParams.get("season") === "5"));
    assert.ok(!calls.some((c) => c.url.includes("secret")));
});

test("falls back to a year (no air date) when the episode has no PremiereDate", async () => {
    const provider = makeProvider(makeRouter([]));

    const result = await provider.enrichScheduleWithYears([
        { title: "Detective Conan", episode: "S05E11 – Another Case" },
    ]);

    assert.equal(result[0].airDate, undefined);
    assert.equal(result[0].year, "2001");
});

test("falls back to the series year when the episode is not found", async () => {
    const provider = makeProvider(makeRouter([]));

    const result = await provider.enrichScheduleWithYears([
        { title: "Cowboy Bebop", episode: "S01E99 – Missing" },
    ]);

    assert.equal(result[0].airDate, undefined);
    assert.equal(result[0].year, "1998");
});

test("caches the series list and each season across calls", async () => {
    const calls = [];
    const provider = makeProvider(makeRouter(calls));

    // Two episodes of the same season in one batch share a single season fetch.
    await provider.enrichScheduleWithYears([
        { title: "Detective Conan", episode: "S05E10 – Some Case" },
        { title: "Detective Conan", episode: "S05E11 – Another Case" },
    ]);
    // A later batch reuses both caches.
    await provider.enrichScheduleWithYears([
        { title: "Detective Conan", episode: "S05E10 – Some Case" },
    ]);

    // 1 series call + 1 season call, total.
    assert.equal(calls.length, 2);
});

test("does not call Jellyfin when nothing needs a year", async () => {
    const calls = [];
    const provider = makeProvider(makeRouter(calls));

    const items = [{ title: "Akira", year: "1988" }];
    const result = await provider.enrichScheduleWithYears(items);

    assert.equal(calls.length, 0);
    assert.deepEqual(result, items);
});

test("returns the schedule unchanged when the series lookup fails", async () => {
    const provider = makeProvider(makeRouter([], { failSeries: true }));

    const items = [{ title: "Cowboy Bebop", episode: "S01E01 – Asteroid Blues" }];
    const result = await provider.enrichScheduleWithYears(items);

    assert.equal(result[0].year, undefined);
});

test("falls back to the series year when the season fetch fails", async () => {
    const provider = makeProvider(makeRouter([], { failSeason: true }));

    const result = await provider.enrichScheduleWithYears([
        { title: "Cowboy Bebop", episode: "S01E01 – Asteroid Blues" },
    ]);

    assert.equal(result[0].airDate, undefined);
    assert.equal(result[0].year, "1998");
});
