import assert from "node:assert/strict";
import test from "node:test";

import { reconcileLibrary } from "../dist/lib/library-reconciliation.js";

function baseInput(overrides = {}) {
    return {
        previousState: {
            currentRotationIndex: 1,
            bumpCursor: 0,
            currentMediaRole: "episode",
        },
        existingSeriesRotation: ["Alpha Series", "Beta Series"],
        existingEpisodeCursors: [
            {
                seriesTitle: "Alpha Series",
                episodeIndex: 1,
                mediaFilePath: "/library/alpha-02.mkv",
            },
            {
                seriesTitle: "Beta Series",
                episodeIndex: 0,
                mediaFilePath: "/library/beta-01.mkv",
            },
        ],
        schedulableSeries: ["Alpha Series", "Beta Series"],
        episodeTargets: [
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-01.mkv" },
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-02.mkv" },
            { seriesTitle: "Beta Series", filePath: "/library/beta-01.mkv" },
        ],
        bumpCount: 2,
        random: () => 0,
        ...overrides,
    };
}

test("reconcileLibrary preserves Series Rotation and appends new Schedulable Series", () => {
    const result = reconcileLibrary(baseInput({
        schedulableSeries: ["Alpha Series", "Beta Series", "Gamma Series"],
        episodeTargets: [
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-01.mkv" },
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-02.mkv" },
            { seriesTitle: "Beta Series", filePath: "/library/beta-01.mkv" },
            { seriesTitle: "Gamma Series", filePath: "/library/gamma-01.mkv" },
        ],
        random: () => 0.999,
    }));

    assert.deepEqual(result.seriesRotation, [
        "Alpha Series",
        "Beta Series",
        "Gamma Series",
    ]);
    assert.equal(result.currentRotationIndex, 1);
    assert.deepEqual(result.episodeCursors, [
        {
            seriesTitle: "Alpha Series",
            episodeIndex: 1,
            mediaFilePath: "/library/alpha-02.mkv",
        },
        {
            seriesTitle: "Beta Series",
            episodeIndex: 0,
            mediaFilePath: "/library/beta-01.mkv",
        },
        {
            seriesTitle: "Gamma Series",
            episodeIndex: 0,
            mediaFilePath: "/library/gamma-01.mkv",
        },
    ]);
});

test("reconcileLibrary keeps an Episode Cursor on the same Media Asset after insertion", () => {
    const result = reconcileLibrary(baseInput({
        existingSeriesRotation: ["Alpha Series"],
        existingEpisodeCursors: [
            {
                seriesTitle: "Alpha Series",
                episodeIndex: 1,
                mediaFilePath: "/library/alpha-03.mkv",
            },
        ],
        schedulableSeries: ["Alpha Series"],
        episodeTargets: [
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-01.mkv" },
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-02.mkv" },
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-03.mkv" },
        ],
    }));

    assert.deepEqual(result.episodeCursors, [
        {
            seriesTitle: "Alpha Series",
            episodeIndex: 2,
            mediaFilePath: "/library/alpha-03.mkv",
        },
    ]);
});

test("reconcileLibrary prunes unschedulable Series and normalizes current rotation index", () => {
    const result = reconcileLibrary(baseInput({
        schedulableSeries: ["Alpha Series"],
        episodeTargets: [
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-01.mkv" },
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-02.mkv" },
        ],
    }));

    assert.deepEqual(result.seriesRotation, ["Alpha Series"]);
    assert.equal(result.currentRotationIndex, 0);
    assert.deepEqual(result.episodeCursors, [
        {
            seriesTitle: "Alpha Series",
            episodeIndex: 1,
            mediaFilePath: "/library/alpha-02.mkv",
        },
    ]);
});

test("reconcileLibrary randomizes new Episode Cursors and clamps Bump Cursor", () => {
    const result = reconcileLibrary(baseInput({
        previousState: {
            currentRotationIndex: 0,
            bumpCursor: 4,
            currentMediaRole: "bump",
        },
        existingSeriesRotation: [],
        existingEpisodeCursors: [],
        schedulableSeries: ["Alpha Series"],
        episodeTargets: [
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-01.mkv" },
            { seriesTitle: "Alpha Series", filePath: "/library/alpha-02.mkv" },
        ],
        bumpCount: 2,
        random: () => 0.999,
    }));

    assert.deepEqual(result, {
        currentRotationIndex: 0,
        bumpCursor: 0,
        currentMediaRole: "bump",
        seriesRotation: ["Alpha Series"],
        episodeCursors: [
            {
                seriesTitle: "Alpha Series",
                episodeIndex: 1,
                mediaFilePath: "/library/alpha-02.mkv",
            },
        ],
    });
});

test("reconcileLibrary returns empty Channel State when no Series are schedulable", () => {
    const result = reconcileLibrary(baseInput({
        schedulableSeries: [],
        episodeTargets: [],
        bumpCount: 0,
    }));

    assert.deepEqual(result, {
        currentRotationIndex: 0,
        bumpCursor: 0,
        currentMediaRole: "episode",
        seriesRotation: [],
        episodeCursors: [],
    });
});
