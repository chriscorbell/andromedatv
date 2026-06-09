import assert from "node:assert/strict";
import test from "node:test";

import {
    advancePlayoutQueue,
    getCurrentPlayoutQueueItem,
    previewPlayoutQueue,
} from "../dist/lib/playout-queue.js";

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function asset(id, role, title, durationSeconds, seriesTitle = null) {
    return {
        id,
        role,
        filePath: `/media/${id}-${title}.mp4`,
        seriesTitle,
        title,
        durationSeconds,
    };
}

function baseSnapshot(overrides = {}) {
    return {
        seriesRotation: ["Alpha Series", "Beta Series"],
        episodeAssets: [
            asset(101, "episode", "Alpha Episode One", 1800, "Alpha Series"),
            asset(102, "episode", "Alpha Episode Two", 1800, "Alpha Series"),
            asset(201, "episode", "Beta Episode One", 1200, "Beta Series"),
        ],
        bumpAssets: [
            asset(301, "bump", "First Bump", 30),
            asset(302, "bump", "Second Bump", 40),
        ],
        state: {
            currentRotationIndex: 0,
            bumpCursor: 0,
            currentMediaRole: "episode",
            episodeCursors: [
                { seriesTitle: "Alpha Series", episodeIndex: 0 },
                { seriesTitle: "Beta Series", episodeIndex: 0 },
            ],
        },
        ...overrides,
    };
}

test("previewPlayoutQueue returns first-class Episode and Bump Asset steps", () => {
    const steps = previewPlayoutQueue(baseSnapshot(), {
        maxSteps: 5,
        startAt: new Date("2026-03-14T12:00:00.000Z"),
    });

    assert.deepEqual(
        steps.map((step) => ({
            title: step.asset.title,
            role: step.asset.role,
            startAt: step.startAt.toISOString(),
            stopAt: step.stopAt.toISOString(),
        })),
        [
            {
                title: "Alpha Episode One",
                role: "episode",
                startAt: "2026-03-14T12:00:00.000Z",
                stopAt: "2026-03-14T12:30:00.000Z",
            },
            {
                title: "First Bump",
                role: "bump",
                startAt: "2026-03-14T12:30:00.000Z",
                stopAt: "2026-03-14T12:30:30.000Z",
            },
            {
                title: "Beta Episode One",
                role: "episode",
                startAt: "2026-03-14T12:30:30.000Z",
                stopAt: "2026-03-14T12:50:30.000Z",
            },
            {
                title: "Second Bump",
                role: "bump",
                startAt: "2026-03-14T12:50:30.000Z",
                stopAt: "2026-03-14T12:51:10.000Z",
            },
            {
                title: "Alpha Episode Two",
                role: "episode",
                startAt: "2026-03-14T12:51:10.000Z",
                stopAt: "2026-03-14T13:21:10.000Z",
            },
        ]
    );
});

test("advancePlayoutQueue moves from Episode Asset to Bump Asset without advancing Series", () => {
    const snapshot = baseSnapshot();
    const result = advancePlayoutQueue(snapshot, 101);

    assert.equal(result.advanced, true);
    assert.deepEqual(result.state, {
        currentRotationIndex: 0,
        bumpCursor: 0,
        currentMediaRole: "bump",
        episodeCursors: [
            { seriesTitle: "Alpha Series", episodeIndex: 0 },
            { seriesTitle: "Beta Series", episodeIndex: 0 },
        ],
    });
    assert.deepEqual(snapshot.state.currentMediaRole, "episode");
});

test("advancePlayoutQueue moves from Bump Asset to the next Series and Bump Cursor", () => {
    const snapshot = baseSnapshot({
        state: {
            currentRotationIndex: 0,
            bumpCursor: 0,
            currentMediaRole: "bump",
            episodeCursors: [
                { seriesTitle: "Alpha Series", episodeIndex: 0 },
                { seriesTitle: "Beta Series", episodeIndex: 0 },
            ],
        },
    });
    const result = advancePlayoutQueue(snapshot, 301);

    assert.equal(result.advanced, true);
    assert.deepEqual(result.state, {
        currentRotationIndex: 1,
        bumpCursor: 1,
        currentMediaRole: "episode",
        episodeCursors: [
            { seriesTitle: "Alpha Series", episodeIndex: 1 },
            { seriesTitle: "Beta Series", episodeIndex: 0 },
        ],
    });
});

test("advancePlayoutQueue ignores stale Playout Completion by Media Asset Identity", () => {
    const snapshot = baseSnapshot();
    const originalState = clone(snapshot.state);
    const result = advancePlayoutQueue(snapshot, 999);

    assert.equal(result.advanced, false);
    assert.deepEqual(result.state, originalState);
    assert.deepEqual(snapshot.state, originalState);
});

test("advancePlayoutQueue advances directly to the next Episode Asset when no Bump Assets exist", () => {
    const result = advancePlayoutQueue(baseSnapshot({ bumpAssets: [] }), 101);

    assert.equal(result.advanced, true);
    assert.deepEqual(result.state, {
        currentRotationIndex: 1,
        bumpCursor: 0,
        currentMediaRole: "episode",
        episodeCursors: [
            { seriesTitle: "Alpha Series", episodeIndex: 1 },
            { seriesTitle: "Beta Series", episodeIndex: 0 },
        ],
    });
});

test("getCurrentPlayoutQueueItem returns null for an empty Playout Queue", () => {
    const current = getCurrentPlayoutQueueItem(baseSnapshot({
        seriesRotation: [],
        episodeAssets: [],
        bumpAssets: [],
    }));

    assert.equal(current, null);
});
