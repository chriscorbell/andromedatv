import assert from "node:assert/strict";
import test from "node:test";

import { parseSidecarOverride } from "../dist/lib/sidecar-override.js";

test("parseSidecarOverride parses valid Series and Episode overrides", () => {
    const result = parseSidecarOverride(JSON.stringify({
        sidecarVersion: 1,
        series: {
            title: " Sidecar Series ",
            sortTitle: " Sidecar Sort ",
            anidbSeriesId: 1001,
            synonyms: [" Alt Title ", "Second Title"],
        },
        episodes: [
            {
                path: "Season 1\\Episode 01.mkv",
                anidbEpisodeId: 5001,
                episodeNumber: " 01 ",
                title: " Pilot ",
                summary: " First episode ",
                airDate: "2026-01-01",
                chronologicalOrder: 1,
                exclude: false,
            },
        ],
    }), "/library/Curated/andromeda.sidecar.json");

    assert.deepEqual(result.diagnostics, []);
    assert.ok(result.sidecar);
    assert.deepEqual(result.sidecar.series, {
        title: "Sidecar Series",
        sortTitle: "Sidecar Sort",
        anidbSeriesId: 1001,
        synonyms: ["Alt Title", "Second Title"],
    });
    assert.deepEqual(Array.from(result.sidecar.episodesByPath.entries()), [
        ["Season 1/Episode 01.mkv", {
            path: "Season 1/Episode 01.mkv",
            anidbEpisodeId: 5001,
            episodeNumber: "01",
            title: "Pilot",
            summary: "First episode",
            airDate: "2026-01-01",
            chronologicalOrder: 1,
            exclude: false,
        }],
    ]);
});

test("parseSidecarOverride reports malformed JSON with the Sidecar path", () => {
    const result = parseSidecarOverride("{", "/library/Curated/andromeda.sidecar.json");

    assert.equal(result.sidecar, null);
    assert.equal(result.diagnostics.length, 1);
    assert.match(
        result.diagnostics[0],
        /^Invalid Sidecar Override \/library\/Curated\/andromeda\.sidecar\.json: /
    );
});

test("parseSidecarOverride rejects non-object roots and unsupported versions", () => {
    assert.deepEqual(
        parseSidecarOverride("[]", "/library/Curated/andromeda.sidecar.json"),
        {
            sidecar: null,
            diagnostics: [
                "Invalid Sidecar Override /library/Curated/andromeda.sidecar.json: expected a JSON object",
            ],
        }
    );

    const result = parseSidecarOverride(JSON.stringify({
        sidecarVersion: 2,
        futureField: true,
    }), "/library/Curated/andromeda.sidecar.json");

    assert.deepEqual(result, {
        sidecar: null,
        diagnostics: [
            "Unknown Sidecar Override field futureField",
            "Invalid Sidecar Override /library/Curated/andromeda.sidecar.json: sidecarVersion must be 1",
        ],
    });
});

test("parseSidecarOverride reports invalid containers", () => {
    const result = parseSidecarOverride(JSON.stringify({
        sidecarVersion: 1,
        series: "not-series",
        episodes: "not-episodes",
    }), "/library/Curated/andromeda.sidecar.json");

    assert.ok(result.sidecar);
    assert.equal(result.sidecar.episodesByPath.size, 0);
    assert.deepEqual(result.diagnostics, [
        "Invalid Sidecar Override field episodes: expected an array",
        "Invalid Sidecar Override field series: expected an object",
    ]);
});

test("parseSidecarOverride reports unknown and invalid fields", () => {
    const result = parseSidecarOverride(JSON.stringify({
        sidecarVersion: 1,
        unexpected: true,
        series: {
            title: "Curated Series",
            aliases: ["Unknown"],
            anidbSeriesId: "1001",
            synonyms: ["Alt", "", 22],
        },
        episodes: [
            {
                path: "episode.mkv",
                unexpected: true,
                anidbEpisodeId: 1.5,
                episodeNumber: "",
                chronologicalOrder: "1",
                exclude: "yes",
            },
        ],
    }), "/library/Curated/andromeda.sidecar.json");

    assert.ok(result.sidecar);
    assert.deepEqual(result.sidecar.episodesByPath.get("episode.mkv"), {
        path: "episode.mkv",
    });
    for (const diagnostic of [
        "Unknown Sidecar Override field unexpected",
        "Unknown Sidecar Override field episodes[].unexpected",
        "Invalid Sidecar Override field episodes[].exclude: expected a boolean",
        "Invalid Sidecar Override field episodes[].anidbEpisodeId: expected an integer",
        "Invalid Sidecar Override field episodes[].episodeNumber: expected a non-empty string",
        "Invalid Sidecar Override field episodes[].chronologicalOrder: expected a finite number",
        "Unknown Sidecar Override field series.aliases",
        "Invalid Sidecar Override field series.synonyms[1]: expected a non-empty string",
        "Invalid Sidecar Override field series.synonyms[2]: expected a non-empty string",
        "Invalid Sidecar Override field series.anidbSeriesId: expected an integer",
    ]) {
        assert.ok(result.diagnostics.includes(diagnostic), diagnostic);
    }
});

test("parseSidecarOverride rejects paths outside the Series directory", () => {
    const result = parseSidecarOverride(JSON.stringify({
        sidecarVersion: 1,
        episodes: [
            { path: "../episode.mkv" },
            { path: "/episode.mkv" },
            { path: "C:\\episode.mkv" },
            { path: "." },
        ],
    }), "/library/Curated/andromeda.sidecar.json");

    assert.ok(result.sidecar);
    assert.equal(result.sidecar.episodesByPath.size, 0);
    assert.deepEqual(result.diagnostics, [
        "Invalid Sidecar Override episode path ../episode.mkv: path must stay inside the Series directory",
        "Invalid Sidecar Override episode path /episode.mkv: path must stay inside the Series directory",
        "Invalid Sidecar Override episode path C:\\episode.mkv: path must stay inside the Series directory",
        "Invalid Sidecar Override episode path .: path must stay inside the Series directory",
    ]);
});

test("parseSidecarOverride marks duplicate Episode paths invalid", () => {
    const result = parseSidecarOverride(JSON.stringify({
        sidecarVersion: 1,
        episodes: [
            { path: "episode.mkv", chronologicalOrder: 1 },
            { path: "episode.mkv", chronologicalOrder: 2 },
        ],
    }), "/library/Curated/andromeda.sidecar.json");

    assert.ok(result.sidecar);
    assert.deepEqual(result.diagnostics, [
        "Duplicate Sidecar Override episode path episode.mkv",
    ]);
    assert.deepEqual(result.sidecar.episodesByPath.get("episode.mkv"), {
        path: "episode.mkv",
        chronologicalOrder: 2,
        invalidReason: "duplicate sidecar episode path",
    });
});

test("parseSidecarOverride marks duplicate chronological orders invalid", () => {
    const result = parseSidecarOverride(JSON.stringify({
        sidecarVersion: 1,
        episodes: [
            { path: "one.mkv", chronologicalOrder: 1 },
            { path: "two.mkv", chronologicalOrder: 1 },
        ],
    }), "/library/Curated/andromeda.sidecar.json");

    assert.ok(result.sidecar);
    assert.deepEqual(result.diagnostics, [
        "Duplicate Sidecar Override chronologicalOrder for one.mkv, two.mkv",
    ]);
    assert.equal(
        result.sidecar.episodesByPath.get("one.mkv").invalidReason,
        "duplicate sidecar chronological order"
    );
    assert.equal(
        result.sidecar.episodesByPath.get("two.mkv").invalidReason,
        "duplicate sidecar chronological order"
    );
});
