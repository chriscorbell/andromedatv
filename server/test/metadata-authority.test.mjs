import assert from "node:assert/strict";
import test from "node:test";

import {
    normalizeEpisodeNumber,
    normalizeMetadataLookupKey,
    resolveMetadataAuthority,
    resolveMetadataAuthoritySeriesTitle,
} from "../dist/lib/metadata-authority.js";

function emptyCache() {
    return {
        seriesById: new Map(),
        seriesByLookupKey: new Map(),
        episodesById: new Map(),
        episodesBySeriesAndNumber: new Map(),
    };
}

function cacheWithSeriesAndEpisodes() {
    const cache = emptyCache();
    const series = {
        anidbSeriesId: 1001,
        title: "Cached Series",
        sortTitle: "Cached Series",
    };
    const firstEpisode = {
        anidbEpisodeId: 5001,
        anidbSeriesId: 1001,
        episodeNumber: "1",
        title: "Cached Episode One",
        summary: "Cached summary",
        airDate: "2026-03-01",
        chronologicalOrder: 2,
    };
    const secondEpisode = {
        anidbEpisodeId: 5002,
        anidbSeriesId: 1001,
        episodeNumber: "2",
        title: "Cached Episode Two",
        summary: null,
        airDate: null,
        chronologicalOrder: 1,
    };
    cache.seriesById.set(series.anidbSeriesId, series);
    cache.seriesByLookupKey.set(normalizeMetadataLookupKey("Folder Series"), series);
    cache.episodesById.set(firstEpisode.anidbEpisodeId, firstEpisode);
    cache.episodesById.set(secondEpisode.anidbEpisodeId, secondEpisode);
    cache.episodesBySeriesAndNumber.set(
        series.anidbSeriesId,
        new Map([
            [normalizeEpisodeNumber(firstEpisode.episodeNumber), firstEpisode],
            [normalizeEpisodeNumber(secondEpisode.episodeNumber), secondEpisode],
        ])
    );
    return cache;
}

test("resolveMetadataAuthority gives Sidecar Override precedence over AniDB Metadata Cache", () => {
    const resolved = resolveMetadataAuthority({
        cache: cacheWithSeriesAndEpisodes(),
        episodeIndex: 0,
        fileName: "Folder Series - 01.mkv",
        filenameFallbackAllowed: false,
        folderTitle: "Folder Series",
        relativePath: "Folder Series - 01.mkv",
        sidecar: {
            series: {
                anidbSeriesId: 1001,
                title: "Sidecar Series",
            },
            episodesByPath: new Map([
                ["Folder Series - 01.mkv", {
                    path: "Folder Series - 01.mkv",
                    anidbEpisodeId: 5001,
                    title: "Sidecar Pilot",
                    chronologicalOrder: 5,
                }],
            ]),
        },
    });

    assert.deepEqual(resolved, {
        airDate: "2026-03-01",
        anidbEpisodeId: 5001,
        anidbSeriesId: 1001,
        chronologicalOrder: 5,
        episodeNumber: "1",
        metadataSource: "sidecar",
        seriesTitle: "Sidecar Series",
        summary: "Cached summary",
        title: "Sidecar Pilot",
    });
});

test("resolveMetadataAuthority uses AniDB Metadata Cache by default", () => {
    const resolved = resolveMetadataAuthority({
        cache: cacheWithSeriesAndEpisodes(),
        episodeIndex: 0,
        fileName: "Folder Series - 02.mkv",
        filenameFallbackAllowed: false,
        folderTitle: "Folder Series",
        relativePath: "Folder Series - 02.mkv",
        sidecar: null,
    });

    assert.deepEqual(resolved, {
        airDate: null,
        anidbEpisodeId: 5002,
        anidbSeriesId: 1001,
        chronologicalOrder: 1,
        episodeNumber: "2",
        metadataSource: "anidb",
        seriesTitle: "Cached Series",
        summary: null,
        title: "Cached Episode Two",
    });
});

test("resolveMetadataAuthority allows filename fallback only for temporary slices", () => {
    const denied = resolveMetadataAuthority({
        cache: emptyCache(),
        episodeIndex: 2,
        fileName: "Unresolved Series - S01E03.mkv",
        filenameFallbackAllowed: false,
        folderTitle: "Unresolved Series",
        relativePath: "Unresolved Series - S01E03.mkv",
        sidecar: null,
    });
    const allowed = resolveMetadataAuthority({
        cache: emptyCache(),
        episodeIndex: 2,
        fileName: "Unresolved Series - S01E03.mkv",
        filenameFallbackAllowed: true,
        folderTitle: "Unresolved Series",
        relativePath: "Unresolved Series - S01E03.mkv",
        sidecar: null,
    });

    assert.deepEqual(denied, {
        reason: "no trusted chronological episode order",
        seriesTitle: "Unresolved Series",
    });
    assert.deepEqual(allowed, {
        airDate: null,
        anidbEpisodeId: null,
        anidbSeriesId: null,
        chronologicalOrder: 3,
        episodeNumber: "3",
        metadataSource: "filename",
        seriesTitle: "Unresolved Series",
        summary: null,
        title: "Unresolved Series - S01E03",
    });
});

test("resolveMetadataAuthority reports Sidecar Override exclusion and invalid reasons", () => {
    const excluded = resolveMetadataAuthority({
        cache: emptyCache(),
        episodeIndex: 0,
        fileName: "opening.mkv",
        filenameFallbackAllowed: true,
        folderTitle: "Curated Series",
        relativePath: "opening.mkv",
        sidecar: {
            series: { title: "Sidecar Series" },
            episodesByPath: new Map([
                ["opening.mkv", {
                    path: "opening.mkv",
                    chronologicalOrder: 0,
                    exclude: true,
                }],
            ]),
        },
    });
    const invalid = resolveMetadataAuthority({
        cache: emptyCache(),
        episodeIndex: 0,
        fileName: "duplicate.mkv",
        filenameFallbackAllowed: true,
        folderTitle: "Curated Series",
        relativePath: "duplicate.mkv",
        sidecar: {
            episodesByPath: new Map([
                ["duplicate.mkv", {
                    path: "duplicate.mkv",
                    invalidReason: "duplicate sidecar chronological order",
                }],
            ]),
        },
    });

    assert.deepEqual(excluded, {
        reason: "excluded by sidecar override",
        seriesTitle: "Sidecar Series",
    });
    assert.deepEqual(invalid, {
        reason: "duplicate sidecar chronological order",
        seriesTitle: "Curated Series",
    });
});

test("resolveMetadataAuthoritySeriesTitle follows Sidecar, AniDB, folder order", () => {
    const cache = cacheWithSeriesAndEpisodes();

    assert.equal(resolveMetadataAuthoritySeriesTitle({
        cache,
        folderTitle: "Folder Series",
        sidecar: { series: { title: "Sidecar Series" }, episodesByPath: new Map() },
    }), "Sidecar Series");
    assert.equal(resolveMetadataAuthoritySeriesTitle({
        cache,
        folderTitle: "Folder Series",
        sidecar: null,
    }), "Cached Series");
    assert.equal(resolveMetadataAuthoritySeriesTitle({
        cache: emptyCache(),
        folderTitle: "Folder Series",
        sidecar: null,
    }), "Folder Series");
});
