import assert from "node:assert/strict";
import test from "node:test";

import { createJellyfinSeriesYearProvider } from "../dist/lib/jellyfin.js";

function makeFetch(items, calls) {
    return async (url, init) => {
        calls.push({ url, init });
        return {
            ok: true,
            status: 200,
            json: async () => ({ Items: items }),
        };
    };
}

const SERIES = [
    { Name: "Cowboy Bebop", ProductionYear: 1998 },
    { Name: "Blue Seed", ProductionYear: 1994 },
];

test("enrichScheduleWithYears fills episode years by title and leaves others alone", async () => {
    const calls = [];
    const provider = createJellyfinSeriesYearProvider({
        baseUrl: new URL("http://jellyfin.local:8096"),
        apiKey: "secret",
        fetchImpl: makeFetch(SERIES, calls),
    });

    const result = await provider.enrichScheduleWithYears([
        { title: "Cowboy Bebop", episode: "S01E01 Asteroid Blues" },
        { title: "Akira", year: "1988" }, // movie keeps its own year
        { title: "Unknown Show", episode: "S01E01 Pilot" }, // no match -> no year
    ]);

    assert.equal(result[0].year, "1998");
    assert.equal(result[1].year, "1988");
    assert.equal(result[2].year, undefined);

    // Sent the API key via header, not the URL.
    assert.equal(calls[0].init.headers["X-Emby-Token"], "secret");
    assert.ok(calls[0].url.includes("IncludeItemTypes=Series"));
    assert.ok(!calls[0].url.includes("secret"));
});

test("series year map is cached across calls", async () => {
    const calls = [];
    const provider = createJellyfinSeriesYearProvider({
        baseUrl: new URL("http://jellyfin.local:8096"),
        apiKey: "secret",
        fetchImpl: makeFetch(SERIES, calls),
    });

    await provider.enrichScheduleWithYears([
        { title: "Blue Seed", episode: "S01E26 New Soul" },
    ]);
    await provider.enrichScheduleWithYears([
        { title: "Cowboy Bebop", episode: "S01E01 Asteroid Blues" },
    ]);

    assert.equal(calls.length, 1);
});

test("does not call Jellyfin when nothing needs a year", async () => {
    const calls = [];
    const provider = createJellyfinSeriesYearProvider({
        baseUrl: new URL("http://jellyfin.local:8096"),
        apiKey: "secret",
        fetchImpl: makeFetch(SERIES, calls),
    });

    const items = [{ title: "Akira", year: "1988" }];
    const result = await provider.enrichScheduleWithYears(items);

    assert.equal(calls.length, 0);
    assert.deepEqual(result, items);
});

test("falls back to the original schedule when Jellyfin fails", async () => {
    const provider = createJellyfinSeriesYearProvider({
        baseUrl: new URL("http://jellyfin.local:8096"),
        apiKey: "secret",
        fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
        logger: { info() {}, warn() {}, error() {} },
    });

    const items = [{ title: "Cowboy Bebop", episode: "S01E01 Asteroid Blues" }];
    const result = await provider.enrichScheduleWithYears(items);

    assert.equal(result[0].year, undefined);
});
