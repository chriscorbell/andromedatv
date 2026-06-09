import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import request from "supertest";

import { createApp } from "../dist/app.js";
import { ensureInitialAdmin } from "../dist/bootstrap.js";
import { initDb } from "../dist/db.js";

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitFor(predicate, { timeout = 2000, interval = 5, label = "condition" } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
        if (await predicate()) {
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error(`Timed out after ${timeout}ms waiting for ${label}`);
        }
        await wait(interval);
    }
}

async function createTestContext(overrides = {}) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-routes-test-"));
    const dbPath = path.join(tempDir, "andromeda.db");
    const db = await initDb(dbPath);
    const {
        loadSchedulePayload = async () => ({
            fetchedAt: new Date("2026-03-14T12:00:00.000Z").toISOString(),
            refreshAfterMs: 60_000,
            schedule: [],
        }),
        ...createAppOverrides
    } = overrides;
    const app = createApp({
        corsOrigin: "*",
        db,
        ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
        jwtSecret: "test-secret",
        serveStatic: false,
        statusApiMode: "admin",
        loadSchedulePayload,
        ...createAppOverrides,
    });

    return {
        app,
        db,
        async cleanup() {
            await db.close();
            await fs.rm(tempDir, { recursive: true, force: true });
        },
    };
}

async function createAdminAgent(context) {
    await ensureInitialAdmin({
        db: context.db,
        nickname: "AndromedaTV",
        password: "supersecret",
    });

    const agent = request.agent(context.app);
    const loginResponse = await agent
        .post("/api/chat/auth/login")
        .send({ nickname: "AndromedaTV", password: "supersecret" });

    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.body.isAdmin, true);
    assert.equal(loginResponse.body.token, undefined);

    return agent;
}

class FakePlayoutProcess extends EventEmitter {
    constructor(pid) {
        super();
        this.killed = false;
        this.pid = pid;
        this.stderr = new PassThrough();
    }

    kill(signal = "SIGTERM") {
        this.killed = true;
        this.emit("exit", null, signal);
        return true;
    }
}

function getHttpStatus(url) {
    return new Promise((resolve, reject) => {
        // agent: false forces a fresh socket per request so concurrent calls
        // can't crowd a reused keep-alive socket and trip a response parse error.
        const req = http.get(url, { agent: false }, (res) => {
            res.resume();
            res.on("end", () => {
                resolve(res.statusCode);
            });
            res.on("error", reject);
        });
        req.on("error", reject);
    });
}

test("register/login sets a session cookie and authorizes the message history route", async () => {
    const context = await createTestContext();

    try {
        const agent = request.agent(context.app);
        const registerResponse = await agent
            .post("/api/chat/auth/register")
            .send({ nickname: "TestUser", password: "hunter2" });

        assert.equal(registerResponse.status, 201);
        assert.equal(registerResponse.body.nickname, "testuser");
        assert.equal(registerResponse.body.isAdmin, false);
        assert.equal(registerResponse.body.token, undefined);
        assert.match(registerResponse.headers["set-cookie"]?.[0] ?? "", /andromeda_stream=/);

        const messagesResponse = await agent
            .get("/api/chat/messages");

        assert.equal(messagesResponse.status, 200);
        assert.deepEqual(messagesResponse.body.user, {
            nickname: "testuser",
            isAdmin: false,
        });
        assert.deepEqual(messagesResponse.body.messages, []);
    } finally {
        await context.cleanup();
    }
});

test("cookie-authenticated sessions can access protected chat routes without bearer headers", async () => {
    const context = await createTestContext();

    try {
        const agent = request.agent(context.app);

        const registerResponse = await agent
            .post("/api/chat/auth/register")
            .send({ nickname: "CookieUser", password: "hunter2" });

        assert.equal(registerResponse.status, 201);
        assert.equal(registerResponse.body.token, undefined);
        assert.match(registerResponse.headers["set-cookie"]?.[0] ?? "", /andromeda_stream=/);

        const messagesResponse = await agent
            .get("/api/chat/messages");

        assert.equal(messagesResponse.status, 200);
        assert.deepEqual(messagesResponse.body.user, {
            nickname: "cookieuser",
            isAdmin: false,
        });

        const postResponse = await agent
            .post("/api/chat/messages")
            .send({ body: "hello from cookies" });

        assert.equal(postResponse.status, 201);
        assert.equal(postResponse.body.message.nickname, "cookieuser");
    } finally {
        await context.cleanup();
    }
});

test("status endpoint requires admin authentication by default", async () => {
    const context = await createTestContext();

    try {
        const statusResponse = await request(context.app)
            .get("/api/status");

        assert.equal(statusResponse.status, 401);
        assert.equal(statusResponse.body.error, "Missing auth token");
    } finally {
        await context.cleanup();
    }
});

test("non-admin users are blocked from admin routes", async () => {
    const context = await createTestContext();

    try {
        const agent = request.agent(context.app);
        const registerResponse = await agent
            .post("/api/chat/auth/register")
            .send({ nickname: "ViewerOne", password: "hunter2" });

        assert.equal(registerResponse.body.token, undefined);

        const clearResponse = await agent
            .post("/api/chat/admin/clear");

        assert.equal(clearResponse.status, 403);
        assert.equal(clearResponse.body.error, "Admin access required");
    } finally {
        await context.cleanup();
    }
});

test("admin bootstrap and ban flow are enforced across existing auth sessions", async () => {
    const context = await createTestContext();

    try {
        const userAgent = request.agent(context.app);
        const adminAgent = await createAdminAgent(context);

        const userRegisterResponse = await userAgent
            .post("/api/chat/auth/register")
            .send({ nickname: "NoisyUser", password: "hunter2" });

        assert.equal(userRegisterResponse.status, 201);
        assert.equal(userRegisterResponse.body.token, undefined);

        const banResponse = await adminAgent
            .post("/api/chat/admin/users/noisyuser/ban");

        assert.equal(banResponse.status, 200);
        assert.deepEqual(banResponse.body, { ok: true });

        const bannedMessagesResponse = await userAgent
            .get("/api/chat/messages");

        assert.equal(bannedMessagesResponse.status, 403);
        assert.equal(bannedMessagesResponse.body.error, "this account has been banned");

        const bannedLoginResponse = await request(context.app)
            .post("/api/chat/auth/login")
            .send({ nickname: "NoisyUser", password: "hunter2" });

        assert.equal(bannedLoginResponse.status, 403);
        assert.equal(bannedLoginResponse.body.error, "this account has been banned");
    } finally {
        await context.cleanup();
    }
});

test("status endpoint summarizes recent schedule and chat activity", async () => {
    const context = await createTestContext();

    try {
        const adminAgent = await createAdminAgent(context);

        await request(context.app)
            .get("/api/schedule")
            .expect(200);

        await adminAgent
            .post("/api/chat/messages")
            .send({ body: "hello status panel" })
            .expect(201);

        const statusResponse = await adminAgent
            .get("/api/status");

        assert.equal(statusResponse.status, 200);
        assert.equal(statusResponse.body.schedule.state, "healthy");
        assert.equal(statusResponse.body.schedule.itemCount, 0);
        assert.equal(statusResponse.body.chat.lastMessageNickname, "andromedatv");
        assert.equal(statusResponse.body.server.nodeVersion, process.version);
        assert.equal(typeof statusResponse.body.server.uptimeMs, "number");
    } finally {
        await context.cleanup();
    }
});

test("schedule endpoint serves an internal preview from allowlisted media assets", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        await fs.mkdir(path.join(seriesRoot, "Allowed Series"), { recursive: true });
        await fs.mkdir(path.join(seriesRoot, "Skipped Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Allowed Series", "episode-01.mp4"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Skipped Series", "episode-01.mp4"), "fixture");
        await fs.writeFile(path.join(bumpsRoot, "02-later.mp4"), "fixture");
        await fs.writeFile(path.join(bumpsRoot, "01-first.mp4"), "fixture");

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesAllowlist: ["Allowed Series"],
                seriesRoot,
                probeMediaAsset: async (filePath) => ({
                    durationSeconds: filePath.includes("episode") ? 1800 : 30,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
        });

        await app.locals.refreshInventory();

        const scheduleResponse = await request(app)
            .get("/api/schedule");

        assert.equal(scheduleResponse.status, 200);
        assert.deepEqual(
            scheduleResponse.body.schedule.map((item) => item.title).slice(0, 3),
            ["Allowed Series", "Allowed Series", "Allowed Series"]
        );
        assert.deepEqual(scheduleResponse.body.schedule[0], {
            episode: "episode-01",
            live: true,
            startAt: "2026-03-14T12:00:00.000Z",
            stopAt: "2026-03-14T12:30:00.000Z",
            time: "live",
            title: "Allowed Series",
        });
        assert.equal(
            scheduleResponse.body.schedule.some((item) => item.title === "01-first"),
            false
        );
        assert.equal(scheduleResponse.body.schedule[1].startAt, "2026-03-14T12:30:30.000Z");
        assert.equal(scheduleResponse.body.schedule[1].stopAt, "2026-03-14T13:00:30.000Z");

        const persistedAssets = await context.db.all(
            "SELECT role, series_title, title, duration_seconds, video_codec, audio_codec FROM media_assets ORDER BY role, title"
        );
        assert.deepEqual(persistedAssets, [
            {
                role: "bump",
                series_title: null,
                title: "01-first",
                duration_seconds: 30,
                video_codec: "h264",
                audio_codec: "aac",
            },
            {
                role: "bump",
                series_title: null,
                title: "02-later",
                duration_seconds: 30,
                video_codec: "h264",
                audio_codec: "aac",
            },
            {
                role: "episode",
                series_title: "Allowed Series",
                title: "episode-01",
                duration_seconds: 1800,
                video_codec: "h264",
                audio_codec: "aac",
            },
        ]);

        assert.deepEqual(
            await context.db.all("SELECT current_rotation_index, bump_cursor FROM channel_state"),
            [{ current_rotation_index: 0, bump_cursor: 0 }]
        );
        assert.deepEqual(
            await context.db.all("SELECT position, series_title FROM series_rotation"),
            [{ position: 0, series_title: "Allowed Series" }]
        );
        assert.deepEqual(
            await context.db.all("SELECT series_title, episode_index FROM episode_cursors"),
            [{ series_title: "Allowed Series", episode_index: 0 }]
        );

        const statusResponse = await request(app)
            .get("/api/status");

        assert.equal(statusResponse.status, 200);
        assert.equal(statusResponse.body.internalSchedule.configured, true);
        assert.equal(statusResponse.body.internalSchedule.scannedEpisodeAssets, 1);
        assert.equal(statusResponse.body.internalSchedule.scannedBumpAssets, 2);
        assert.deepEqual(statusResponse.body.internalSchedule.scannerDiagnostics, []);
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal schedule route caches repeated loads until explicitly bypassed", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));
    let probeCount = 0;

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        await fs.mkdir(path.join(seriesRoot, "Cached Route Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Cached Route Series", "episode-01.mp4"), "fixture");

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesAllowlist: ["Cached Route Series"],
                seriesRoot,
                probeMediaAsset: async () => {
                    probeCount += 1;
                    return {
                        durationSeconds: 1800,
                        videoCodec: "h264",
                        audioCodec: "aac",
                    };
                },
                random: () => 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
        });

        await app.locals.refreshInventory();
        assert.equal(probeCount, 1);

        // Requests project from persisted state without re-probing.
        await request(app)
            .get("/api/schedule")
            .expect(200);
        assert.equal(probeCount, 1);

        await request(app)
            .get("/api/schedule")
            .expect(200);
        assert.equal(probeCount, 1);

        // A manual bypass rescans, but an unchanged file reuses its persisted probe facts.
        await request(app)
            .get("/api/schedule")
            .set("Cache-Control", "no-cache")
            .expect(200);
        assert.equal(probeCount, 1);

        // Modifying the file changes its size/mtime, invalidating the cached facts.
        await fs.writeFile(
            path.join(seriesRoot, "Cached Route Series", "episode-01.mp4"),
            "fixture-with-modified-contents"
        );
        await request(app)
            .get("/api/schedule")
            .set("Cache-Control", "no-cache")
            .expect(200);
        assert.equal(probeCount, 2);
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal schedule route projects without scanning until inventory is refreshed", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));
    let probeCount = 0;

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        await fs.mkdir(path.join(seriesRoot, "Projected Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Projected Series", "episode-01.mp4"), "fixture");

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesAllowlist: ["Projected Series"],
                seriesRoot,
                probeMediaAsset: async () => {
                    probeCount += 1;
                    return {
                        durationSeconds: 1800,
                        videoCodec: "h264",
                        audioCodec: "aac",
                    };
                },
                random: () => 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
        });

        // Cold DB: the request path projects an empty schedule without probing,
        // so the client falls back to its built-in lineup.
        const coldResponse = await request(app)
            .get("/api/schedule")
            .expect(200);
        assert.deepEqual(coldResponse.body.schedule, []);
        assert.equal(probeCount, 0);

        // Background inventory refresh populates the library...
        await app.locals.refreshInventory();
        assert.equal(probeCount, 1);

        // ...and the next request now projects live data, still without probing.
        const warmResponse = await request(app)
            .get("/api/schedule")
            .expect(200);
        assert.equal(warmResponse.body.schedule[0]?.title, "Projected Series");
        assert.equal(probeCount, 1);
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal schedule anchors the live item to the actual playout start time", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        await fs.mkdir(path.join(seriesRoot, "Anchor Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Anchor Series", "episode-01.mp4"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Anchor Series", "episode-02.mp4"), "fixture");

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesAllowlist: ["Anchor Series"],
                seriesRoot,
                probeMediaAsset: async () => ({
                    durationSeconds: 600,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
        });

        await app.locals.refreshInventory();

        // The current episode began 9 minutes ago (10-minute runtime), so it is
        // live with one minute remaining.
        const currentEpisode = await context.db.get(
            "SELECT id, file_path FROM media_assets WHERE role = 'episode' ORDER BY chronological_order LIMIT 1"
        );
        await context.db.run(
            "INSERT INTO playout_history " +
            "(media_asset_id, media_file_path, media_title, media_role, started_at, start_offset_seconds, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            currentEpisode.id,
            currentEpisode.file_path,
            "episode-01",
            "episode",
            "2026-03-14T11:51:00.000Z",
            0,
            "2026-03-14T11:51:00.000Z"
        );

        const response = await request(app)
            .get("/api/schedule")
            .expect(200);

        // The live item is anchored to its real start, not "now".
        assert.equal(response.body.schedule[0].live, true);
        assert.equal(response.body.schedule[0].startAt, "2026-03-14T11:51:00.000Z");
        assert.equal(response.body.schedule[0].stopAt, "2026-03-14T12:01:00.000Z");
        // The next item chains from the real boundary...
        assert.equal(response.body.schedule[1].startAt, "2026-03-14T12:01:00.000Z");
        // ...and refreshAfterMs reflects the real remaining time (~1 min), so the
        // cache and client re-poll align with the actual transition.
        assert.equal(response.body.refreshAfterMs, 61_000);
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal schedule resolves schedulable series from the AniDB metadata cache", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        await fs.mkdir(path.join(seriesRoot, "Cached Series"), { recursive: true });
        await fs.mkdir(path.join(seriesRoot, "Unresolved Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Cached Series", "Cached Series - 01.mkv"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Cached Series", "Cached Series - 02.mkv"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Unresolved Series", "Unresolved Series - 01.mkv"), "fixture");

        await context.db.run(
            "INSERT INTO anidb_series " +
            "(anidb_series_id, title, sort_title, synonyms_json, last_success_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?)",
            1001,
            "Cached Series",
            "Cached Series",
            JSON.stringify(["Cached Series TV"]),
            "2026-03-13T12:00:00.000Z",
            "2026-03-13T12:00:00.000Z"
        );
        await context.db.run(
            "INSERT INTO anidb_episodes " +
            "(anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            5002,
            1001,
            "2",
            "Cached Episode Two",
            "The cached second episode is first chronologically.",
            "2026-03-02",
            1,
            "2026-03-13T12:00:00.000Z"
        );
        await context.db.run(
            "INSERT INTO anidb_episodes " +
            "(anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            5001,
            1001,
            "1",
            "Cached Episode One",
            "The cached first episode follows second.",
            "2026-03-01",
            2,
            "2026-03-13T12:00:00.000Z"
        );

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesRoot,
                probeMediaAsset: async () => ({
                    durationSeconds: 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
        });

        await app.locals.refreshInventory();

        const scheduleResponse = await request(app)
            .get("/api/schedule");

        assert.equal(scheduleResponse.status, 200);
        assert.deepEqual(
            scheduleResponse.body.schedule.map((item) => item.episode).slice(0, 2),
            ["Cached Episode Two", "Cached Episode One"]
        );
        assert.equal(
            scheduleResponse.body.schedule.some((item) => item.title === "Unresolved Series"),
            false
        );

        const persistedAssets = await context.db.all(
            "SELECT series_title, title, anidb_series_id, anidb_episode_id, chronological_order, metadata_source " +
            "FROM media_assets WHERE role = 'episode' ORDER BY chronological_order"
        );
        assert.deepEqual(persistedAssets, [
            {
                series_title: "Cached Series",
                title: "Cached Episode Two",
                anidb_series_id: 1001,
                anidb_episode_id: 5002,
                chronological_order: 1,
                metadata_source: "anidb",
            },
            {
                series_title: "Cached Series",
                title: "Cached Episode One",
                anidb_series_id: 1001,
                anidb_episode_id: 5001,
                chronological_order: 2,
                metadata_source: "anidb",
            },
        ]);

        const statusResponse = await request(app)
            .get("/api/status");

        assert.equal(statusResponse.status, 200);
        assert.deepEqual(
            statusResponse.body.internalSchedule.unresolvedEpisodeAssets.map((asset) => asset.seriesTitle),
            ["Unresolved Series"]
        );
        assert.deepEqual(statusResponse.body.internalSchedule.excludedSeries, [
            {
                reason: "no trusted chronological episode order",
                seriesTitle: "Unresolved Series",
            },
        ]);
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal schedule reconciles newly schedulable series without reshuffling channel state", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));

    async function seedCachedSeries(anidbSeriesId, seriesTitle, episodes) {
        const timestamp = "2026-03-13T12:00:00.000Z";
        await context.db.run(
            "INSERT INTO anidb_series " +
            "(anidb_series_id, title, sort_title, synonyms_json, last_success_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?)",
            anidbSeriesId,
            seriesTitle,
            seriesTitle,
            "[]",
            timestamp,
            timestamp
        );

        for (const episode of episodes) {
            await context.db.run(
                "INSERT INTO anidb_episodes " +
                "(anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                episode.anidbEpisodeId,
                anidbSeriesId,
                episode.episodeNumber,
                episode.title,
                null,
                null,
                episode.chronologicalOrder,
                timestamp
            );
        }
    }

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        await fs.mkdir(path.join(seriesRoot, "Alpha Series"), { recursive: true });
        await fs.mkdir(path.join(seriesRoot, "Beta Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Alpha Series", "Alpha Series - 01.mkv"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Alpha Series", "Alpha Series - 02.mkv"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Beta Series", "Beta Series - 01.mkv"), "fixture");

        await seedCachedSeries(3001, "Alpha Series", [
            {
                anidbEpisodeId: 9001,
                chronologicalOrder: 1,
                episodeNumber: "1",
                title: "Alpha Episode One",
            },
            {
                anidbEpisodeId: 9002,
                chronologicalOrder: 2,
                episodeNumber: "2",
                title: "Alpha Episode Two",
            },
        ]);
        await seedCachedSeries(3002, "Beta Series", [
            {
                anidbEpisodeId: 9101,
                chronologicalOrder: 1,
                episodeNumber: "1",
                title: "Beta Episode One",
            },
        ]);

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesRoot,
                probeMediaAsset: async () => ({
                    durationSeconds: 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => 0.999,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
        });

        await app.locals.refreshInventory();

        await request(app)
            .get("/api/schedule")
            .expect(200);

        assert.deepEqual(
            await context.db.all("SELECT position, series_title FROM series_rotation ORDER BY position"),
            [
                { position: 0, series_title: "Alpha Series" },
                { position: 1, series_title: "Beta Series" },
            ]
        );
        assert.deepEqual(
            await context.db.all("SELECT series_title, episode_index FROM episode_cursors ORDER BY series_title"),
            [
                { series_title: "Alpha Series", episode_index: 1 },
                { series_title: "Beta Series", episode_index: 0 },
            ]
        );

        await context.db.run(
            "UPDATE channel_state SET current_rotation_index = ?, current_media_role = ? WHERE id = 1",
            1,
            "episode"
        );

        await fs.mkdir(path.join(seriesRoot, "Gamma Series"), { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Gamma Series", "Gamma Series - 01.mkv"), "fixture");
        await seedCachedSeries(3003, "Gamma Series", [
            {
                anidbEpisodeId: 9201,
                chronologicalOrder: 1,
                episodeNumber: "1",
                title: "Gamma Episode One",
            },
        ]);

        const reconciledScheduleResponse = await request(app)
            .get("/api/schedule")
            .set("Cache-Control", "no-cache");

        assert.equal(reconciledScheduleResponse.status, 200);
        assert.deepEqual(
            reconciledScheduleResponse.body.schedule.map((item) => item.title).slice(0, 4),
            ["Beta Series", "Gamma Series", "Alpha Series", "Beta Series"]
        );
        assert.deepEqual(
            await context.db.all("SELECT position, series_title FROM series_rotation ORDER BY position"),
            [
                { position: 0, series_title: "Alpha Series" },
                { position: 1, series_title: "Beta Series" },
                { position: 2, series_title: "Gamma Series" },
            ]
        );
        assert.deepEqual(
            await context.db.all("SELECT series_title, episode_index FROM episode_cursors ORDER BY series_title"),
            [
                { series_title: "Alpha Series", episode_index: 1 },
                { series_title: "Beta Series", episode_index: 0 },
                { series_title: "Gamma Series", episode_index: 0 },
            ]
        );
        assert.deepEqual(
            await context.db.get("SELECT current_rotation_index, current_media_role FROM channel_state WHERE id = 1"),
            { current_rotation_index: 1, current_media_role: "episode" }
        );

        const statusResponse = await request(app)
            .get("/api/status");

        assert.equal(statusResponse.status, 200);
        assert.deepEqual(statusResponse.body.internalSchedule.channelState, {
            bumpCursor: 0,
            currentMediaRole: "episode",
            currentRotationIndex: 1,
            episodeCursors: [
                { episodeIndex: 1, seriesTitle: "Alpha Series" },
                { episodeIndex: 0, seriesTitle: "Beta Series" },
                { episodeIndex: 0, seriesTitle: "Gamma Series" },
            ],
            seriesRotation: ["Alpha Series", "Beta Series", "Gamma Series"],
        });
        assert.deepEqual(statusResponse.body.internalSchedule.seriesAllowlist, []);
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal schedule keeps an existing episode cursor on the same media after new episode insertion", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));

    async function seedCachedSeries() {
        const timestamp = "2026-03-13T12:00:00.000Z";
        await context.db.run(
            "INSERT INTO anidb_series " +
            "(anidb_series_id, title, sort_title, synonyms_json, last_success_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?)",
            3101,
            "Alpha Series",
            "Alpha Series",
            "[]",
            timestamp,
            timestamp
        );

        for (const episode of [
            {
                anidbEpisodeId: 9301,
                chronologicalOrder: 1,
                episodeNumber: "1",
                title: "Alpha Episode One",
            },
            {
                anidbEpisodeId: 9303,
                chronologicalOrder: 3,
                episodeNumber: "3",
                title: "Alpha Episode Three",
            },
        ]) {
            await context.db.run(
                "INSERT INTO anidb_episodes " +
                "(anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                episode.anidbEpisodeId,
                3101,
                episode.episodeNumber,
                episode.title,
                null,
                null,
                episode.chronologicalOrder,
                timestamp
            );
        }
    }

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        const alphaRoot = path.join(seriesRoot, "Alpha Series");
        await fs.mkdir(alphaRoot, { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(alphaRoot, "Alpha Series - 01.mkv"), "fixture");
        await fs.writeFile(path.join(alphaRoot, "Alpha Series - 03.mkv"), "fixture");
        await seedCachedSeries();

        const randomValues = [0.999];
        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesRoot,
                probeMediaAsset: async () => ({
                    durationSeconds: 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => randomValues.shift() ?? 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
        });

        await app.locals.refreshInventory();

        const initialScheduleResponse = await request(app)
            .get("/api/schedule");

        assert.equal(initialScheduleResponse.status, 200);
        assert.equal(initialScheduleResponse.body.schedule[0].episode, "Alpha Episode Three");
        assert.deepEqual(
            await context.db.all("SELECT series_title, episode_index FROM episode_cursors ORDER BY series_title"),
            [{ series_title: "Alpha Series", episode_index: 1 }]
        );

        await fs.writeFile(path.join(alphaRoot, "Alpha Series - 02.mkv"), "fixture");
        await context.db.run(
            "INSERT INTO anidb_episodes " +
            "(anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            9302,
            3101,
            "2",
            "Alpha Episode Two",
            null,
            null,
            2,
            "2026-03-14T12:05:00.000Z"
        );

        const reconciledScheduleResponse = await request(app)
            .get("/api/schedule")
            .set("Cache-Control", "no-cache");

        assert.equal(reconciledScheduleResponse.status, 200);
        assert.equal(reconciledScheduleResponse.body.schedule[0].episode, "Alpha Episode Three");
        assert.deepEqual(
            reconciledScheduleResponse.body.schedule.map((item) => item.episode).slice(0, 3),
            ["Alpha Episode Three", "Alpha Episode One", "Alpha Episode Two"]
        );
        assert.deepEqual(
            await context.db.all("SELECT series_title, episode_index FROM episode_cursors ORDER BY series_title"),
            [{ series_title: "Alpha Series", episode_index: 2 }]
        );
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal schedule prunes a removed series from the persisted rotation and cursors", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));

    async function seedCachedSeries(anidbSeriesId, seriesTitle, episodes) {
        const timestamp = "2026-03-13T12:00:00.000Z";
        await context.db.run(
            "INSERT INTO anidb_series " +
            "(anidb_series_id, title, sort_title, synonyms_json, last_success_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?)",
            anidbSeriesId,
            seriesTitle,
            seriesTitle,
            "[]",
            timestamp,
            timestamp
        );

        for (const episode of episodes) {
            await context.db.run(
                "INSERT INTO anidb_episodes " +
                "(anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                episode.anidbEpisodeId,
                anidbSeriesId,
                episode.episodeNumber,
                episode.title,
                null,
                null,
                episode.chronologicalOrder,
                timestamp
            );
        }
    }

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        const betaRoot = path.join(seriesRoot, "Beta Series");
        await fs.mkdir(path.join(seriesRoot, "Alpha Series"), { recursive: true });
        await fs.mkdir(betaRoot, { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Alpha Series", "Alpha Series - 01.mkv"), "fixture");
        await fs.writeFile(path.join(betaRoot, "Beta Series - 01.mkv"), "fixture");

        await seedCachedSeries(4001, "Alpha Series", [
            {
                anidbEpisodeId: 9401,
                chronologicalOrder: 1,
                episodeNumber: "1",
                title: "Alpha Episode One",
            },
        ]);
        await seedCachedSeries(4002, "Beta Series", [
            {
                anidbEpisodeId: 9501,
                chronologicalOrder: 1,
                episodeNumber: "1",
                title: "Beta Episode One",
            },
        ]);

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesRoot,
                probeMediaAsset: async () => ({
                    durationSeconds: 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => 0.999,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
        });

        await app.locals.refreshInventory();

        await request(app).get("/api/schedule").expect(200);

        assert.deepEqual(
            await context.db.all("SELECT series_title FROM series_rotation ORDER BY position"),
            [{ series_title: "Alpha Series" }, { series_title: "Beta Series" }]
        );
        assert.deepEqual(
            await context.db.all("SELECT series_title FROM episode_cursors ORDER BY series_title"),
            [{ series_title: "Alpha Series" }, { series_title: "Beta Series" }]
        );

        await fs.rm(betaRoot, { recursive: true, force: true });

        const reconciledScheduleResponse = await request(app)
            .get("/api/schedule")
            .set("Cache-Control", "no-cache");

        assert.equal(reconciledScheduleResponse.status, 200);
        assert.equal(
            reconciledScheduleResponse.body.schedule.some((item) => item.title === "Beta Series"),
            false
        );
        assert.deepEqual(
            await context.db.all("SELECT position, series_title FROM series_rotation ORDER BY position"),
            [{ position: 0, series_title: "Alpha Series" }]
        );
        assert.deepEqual(
            await context.db.all("SELECT series_title FROM episode_cursors ORDER BY series_title"),
            [{ series_title: "Alpha Series" }]
        );
        assert.deepEqual(
            await context.db.all(
                "SELECT series_title FROM media_assets WHERE role = 'episode' ORDER BY series_title"
            ),
            [{ series_title: "Alpha Series" }]
        );

        const statusResponse = await request(app).get("/api/status");

        assert.equal(statusResponse.status, 200);
        assert.deepEqual(
            statusResponse.body.internalSchedule.channelState.seriesRotation,
            ["Alpha Series"]
        );
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("sidecar overrides take precedence over cached AniDB metadata", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        const seriesPath = path.join(seriesRoot, "Curated Folder");
        await fs.mkdir(seriesPath, { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesPath, "episode-01.mkv"), "fixture");
        await fs.writeFile(path.join(seriesPath, "episode-02.mkv"), "fixture");
        await fs.writeFile(path.join(seriesPath, "episode-03.mkv"), "fixture");
        await fs.writeFile(
            path.join(seriesPath, "andromeda.sidecar.json"),
            JSON.stringify({
                sidecarVersion: 1,
                series: {
                    title: "Sidecar Series",
                    anidbSeriesId: 2002,
                },
                episodes: [
                    {
                        path: "episode-01.mkv",
                        anidbEpisodeId: 7001,
                        title: "Sidecar Pilot",
                        chronologicalOrder: 2,
                    },
                    {
                        path: "episode-02.mkv",
                        anidbEpisodeId: 7002,
                        chronologicalOrder: 1,
                    },
                    {
                        path: "episode-03.mkv",
                        title: "Opening Without Cache",
                        chronologicalOrder: 0,
                        exclude: true,
                    },
                ],
            })
        );

        await context.db.run(
            "INSERT INTO anidb_series " +
            "(anidb_series_id, title, sort_title, synonyms_json, last_success_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?)",
            2002,
            "Cached Series Title",
            "Cached Series Title",
            "[]",
            "2026-03-13T12:00:00.000Z",
            "2026-03-13T12:00:00.000Z"
        );
        await context.db.run(
            "INSERT INTO anidb_episodes " +
            "(anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            7001,
            2002,
            "1",
            "Cached Pilot",
            null,
            null,
            1,
            "2026-03-13T12:00:00.000Z"
        );
        await context.db.run(
            "INSERT INTO anidb_episodes " +
            "(anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            7002,
            2002,
            "2",
            "Cached Second",
            null,
            null,
            2,
            "2026-03-13T12:00:00.000Z"
        );

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesRoot,
                probeMediaAsset: async () => ({
                    durationSeconds: 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
        });

        await app.locals.refreshInventory();

        const scheduleResponse = await request(app)
            .get("/api/schedule");

        assert.equal(scheduleResponse.status, 200);
        assert.deepEqual(
            scheduleResponse.body.schedule.map((item) => ({
                episode: item.episode,
                title: item.title,
            })).slice(0, 2),
            [
                { episode: "Cached Second", title: "Sidecar Series" },
                { episode: "Sidecar Pilot", title: "Sidecar Series" },
            ]
        );

        const persistedAssets = await context.db.all(
            "SELECT series_title, title, anidb_series_id, anidb_episode_id, chronological_order, metadata_source " +
            "FROM media_assets WHERE role = 'episode' ORDER BY chronological_order"
        );
        assert.deepEqual(persistedAssets, [
            {
                series_title: "Sidecar Series",
                title: "Cached Second",
                anidb_series_id: 2002,
                anidb_episode_id: 7002,
                chronological_order: 1,
                metadata_source: "sidecar",
            },
            {
                series_title: "Sidecar Series",
                title: "Sidecar Pilot",
                anidb_series_id: 2002,
                anidb_episode_id: 7001,
                chronological_order: 2,
                metadata_source: "sidecar",
            },
        ]);

        const statusResponse = await request(app)
            .get("/api/status");

        assert.equal(statusResponse.status, 200);
        assert.deepEqual(statusResponse.body.internalSchedule.excludedSeries, []);
        assert.deepEqual(
            statusResponse.body.internalSchedule.unresolvedEpisodeAssets,
            [
                {
                    filePath: path.join(seriesPath, "episode-03.mkv"),
                    reason: "excluded by sidecar override",
                    seriesTitle: "Sidecar Series",
                },
            ]
        );
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal IPTV route serves generated live HLS output", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));
    const hlsOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-hls-test-"));

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        const episodePath = path.join(seriesRoot, "Allowed Series", "episode-01.mp4");
        await fs.mkdir(path.dirname(episodePath), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(episodePath, "fixture");
        let mediaProbeCount = 0;

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:1"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalPlayout: {
                bumpsRoot,
                hlsOutputRoot,
                seriesAllowlist: ["Allowed Series"],
                seriesRoot,
                probeMediaAsset: async () => {
                    mediaProbeCount += 1;
                    return {
                        durationSeconds: 1800,
                        videoCodec: "h264",
                        audioCodec: "aac",
                    };
                },
                random: () => 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
                transcodeLiveHls: async ({ mediaAsset, outputRoot }) => {
                    assert.equal(mediaAsset.filePath, episodePath);
                    await fs.mkdir(outputRoot, { recursive: true });
                    await fs.writeFile(
                        path.join(outputRoot, "hls.m3u8"),
                        "#EXTM3U\n#EXT-X-TARGETDURATION:4\nsegment-00001.ts\n"
                    );
                    await fs.writeFile(path.join(outputRoot, "segment-00001.ts"), "segment-data");
                    return { playlistPath: path.join(outputRoot, "hls.m3u8") };
                },
            },
        });

        const playlistResponse = await request(app)
            .get("/iptv/session/1/hls.m3u8");

        assert.equal(playlistResponse.status, 200);
        assert.match(playlistResponse.headers["content-type"], /mpegurl|application\/vnd\.apple\.mpegurl/);
        assert.match(playlistResponse.text, /segment-00001\.ts/);
        assert.equal(mediaProbeCount, 1);

        const segmentResponse = await request(app)
            .get("/iptv/session/1/segment-00001.ts");

        assert.equal(segmentResponse.status, 200);
        assert.equal(Buffer.from(segmentResponse.body).toString("utf8"), "segment-data");
        assert.equal(mediaProbeCount, 1);
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await fs.rm(hlsOutputRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal playout status reports transcode acceleration mode and hardware use", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));
    const hlsOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-hls-test-"));

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        const episodePath = path.join(seriesRoot, "Allowed Series", "episode-01.mp4");
        await fs.mkdir(path.dirname(episodePath), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(episodePath, "fixture");

        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:1"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalPlayout: {
                bumpsRoot,
                hlsOutputRoot,
                seriesAllowlist: ["Allowed Series"],
                seriesRoot,
                transcodeAcceleration: {
                    devicePath: "/dev/dri/renderD128",
                    hardwareAvailable: true,
                    mode: "preferred",
                },
                probeMediaAsset: async () => ({
                    durationSeconds: 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
                transcodeLiveHls: async ({ outputRoot }) => {
                    await fs.mkdir(outputRoot, { recursive: true });
                    const playlistPath = path.join(outputRoot, "hls.m3u8");
                    await fs.writeFile(
                        playlistPath,
                        "#EXTM3U\n#EXT-X-TARGETDURATION:4\nsegment-00001.ts\n"
                    );
                    await fs.writeFile(path.join(outputRoot, "segment-00001.ts"), "segment-data");
                    return { playlistPath, usesHardwareAcceleration: true };
                },
            },
        });

        await request(app)
            .get("/iptv/session/1/hls.m3u8")
            .expect(200);

        const statusResponse = await request(app)
            .get("/api/status")
            .expect(200);

        assert.equal(statusResponse.body.internalPlayout.transcodeAccelerationMode, "preferred");
        assert.equal(statusResponse.body.internalPlayout.hardwareAccelerationAvailable, true);
        assert.equal(statusResponse.body.internalPlayout.hardwareAccelerationActive, true);
        assert.equal(statusResponse.body.internalPlayout.hardwareDevicePath, "/dev/dri/renderD128");
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await fs.rm(hlsOutputRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal schedule and IPTV routes can initialize channel state concurrently", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));
    const hlsOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-hls-test-"));
    let server = null;

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        await fs.mkdir(path.join(seriesRoot, "Acceptance Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Acceptance Series", "episode-01.mp4"), "fixture");
        await fs.writeFile(path.join(bumpsRoot, "01-bump.mp4"), "fixture");

        const internalOptions = {
            bumpsRoot,
            seriesAllowlist: ["Acceptance Series"],
            seriesRoot,
            probeMediaAsset: async (filePath) => {
                await wait(5);
                return {
                    durationSeconds: filePath.includes("bump") ? 30 : 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                };
            },
            random: () => 0,
            now: () => new Date("2026-03-14T12:00:00.000Z"),
        };
        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:1"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: internalOptions,
            internalPlayout: {
                ...internalOptions,
                hlsOutputRoot,
                transcodeLiveHls: async ({ outputRoot }) => {
                    await fs.mkdir(outputRoot, { recursive: true });
                    const playlistPath = path.join(outputRoot, "hls.m3u8");
                    await fs.writeFile(
                        playlistPath,
                        "#EXTM3U\n#EXT-X-TARGETDURATION:4\nsegment-00001.ts\n"
                    );
                    await fs.writeFile(path.join(outputRoot, "segment-00001.ts"), "segment-data");
                    return { playlistPath };
                },
            },
        });

        server = http.createServer(app);
        await new Promise((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        assert.ok(address && typeof address === "object");
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const statuses = await Promise.all([
            getHttpStatus(`${baseUrl}/api/schedule`),
            getHttpStatus(`${baseUrl}/iptv/session/1/hls.m3u8`),
            getHttpStatus(`${baseUrl}/api/schedule`),
            getHttpStatus(`${baseUrl}/iptv/session/1/hls.m3u8`),
        ]);

        assert.deepEqual(
            statuses,
            [200, 200, 200, 200]
        );
        assert.deepEqual(
            await context.db.all("SELECT id, current_rotation_index, bump_cursor FROM channel_state"),
            [{ id: 1, current_rotation_index: 0, bump_cursor: 0 }]
        );
        assert.deepEqual(
            await context.db.all("SELECT position, series_title FROM series_rotation"),
            [{ position: 0, series_title: "Acceptance Series" }]
        );
    } finally {
        if (server) {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
        }
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await fs.rm(hlsOutputRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal playout resumes deterministically from persisted playout state after restart", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));
    const hlsOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-hls-test-"));

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        await fs.mkdir(path.join(seriesRoot, "Alpha Series"), { recursive: true });
        await fs.mkdir(path.join(seriesRoot, "Beta Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Alpha Series", "episode-01.mp4"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Beta Series", "episode-01.mp4"), "fixture");
        await fs.writeFile(path.join(bumpsRoot, "01-first-bump.mp4"), "fixture");

        const probeMediaAsset = async (filePath) => ({
            durationSeconds: filePath.includes("bump") ? 30 : 1800,
            videoCodec: "h264",
            audioCodec: "aac",
        });

        const initialRequests = [];
        const initialApp = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:1"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalPlayout: {
                bumpsRoot,
                hlsOutputRoot,
                seriesAllowlist: ["Alpha Series", "Beta Series"],
                seriesRoot,
                probeMediaAsset,
                random: () => 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
                transcodeLiveHls: async ({ mediaAsset, outputRoot, startOffsetSeconds }) => {
                    initialRequests.push({ mediaAsset, startOffsetSeconds });
                    await fs.mkdir(outputRoot, { recursive: true });
                    const playlistPath = path.join(outputRoot, "hls.m3u8");
                    await fs.writeFile(
                        playlistPath,
                        "#EXTM3U\n#EXT-X-TARGETDURATION:4\nsegment-00001.ts\n"
                    );
                    await fs.writeFile(path.join(outputRoot, "segment-00001.ts"), "segment-data");
                    return { playlistPath };
                },
            },
        });

        await request(initialApp)
            .get("/iptv/session/1/hls.m3u8")
            .expect(200);

        assert.equal(initialRequests.length, 1);
        assert.equal(initialRequests[0].mediaAsset.title, "episode-01");
        assert.equal(initialRequests[0].startOffsetSeconds, 0);

        const initialStatus = await request(initialApp)
            .get("/api/status")
            .expect(200);
        assert.equal(initialStatus.body.internalPlayout.resumeMode, "boundary");
        assert.equal(initialStatus.body.internalPlayout.resumeOffsetSeconds, 0);

        const persistedRotation = await context.db.all(
            "SELECT position, series_title FROM series_rotation ORDER BY position"
        );
        const persistedCursors = await context.db.all(
            "SELECT series_title, episode_index FROM episode_cursors ORDER BY series_title"
        );

        const restartRequests = [];
        const restartApp = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:1"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalPlayout: {
                bumpsRoot,
                hlsOutputRoot,
                seriesAllowlist: ["Alpha Series", "Beta Series"],
                seriesRoot,
                probeMediaAsset,
                random: () => {
                    throw new Error("restart must not reshuffle channel state");
                },
                now: () => new Date("2026-03-14T12:05:00.000Z"),
                transcodeLiveHls: async ({ mediaAsset, outputRoot, startOffsetSeconds }) => {
                    restartRequests.push({ mediaAsset, startOffsetSeconds });
                    await fs.mkdir(outputRoot, { recursive: true });
                    const playlistPath = path.join(outputRoot, "hls.m3u8");
                    await fs.writeFile(
                        playlistPath,
                        "#EXTM3U\n#EXT-X-TARGETDURATION:4\nsegment-00001.ts\n"
                    );
                    await fs.writeFile(path.join(outputRoot, "segment-00001.ts"), "segment-data");
                    return { playlistPath };
                },
            },
        });

        await request(restartApp)
            .get("/iptv/session/1/hls.m3u8")
            .expect(200);

        assert.equal(restartRequests.length, 1);
        assert.equal(restartRequests[0].mediaAsset.title, "episode-01");
        assert.equal(restartRequests[0].startOffsetSeconds, 300);
        assert.deepEqual(
            await context.db.all("SELECT position, series_title FROM series_rotation ORDER BY position"),
            persistedRotation
        );
        assert.deepEqual(
            await context.db.all("SELECT series_title, episode_index FROM episode_cursors ORDER BY series_title"),
            persistedCursors
        );

        const restartStatus = await request(restartApp)
            .get("/api/status")
            .expect(200);
        assert.equal(restartStatus.body.internalPlayout.resumeMode, "wall-clock");
        assert.equal(restartStatus.body.internalPlayout.resumeOffsetSeconds, 300);
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await fs.rm(hlsOutputRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("internal playout advances schedule only after confirmed media completion", async () => {
    const context = await createTestContext();
    const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-library-test-"));
    const hlsOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-hls-test-"));

    try {
        const seriesRoot = path.join(libraryRoot, "series");
        const bumpsRoot = path.join(libraryRoot, "bumps");
        await fs.mkdir(path.join(seriesRoot, "Alpha Series"), { recursive: true });
        await fs.mkdir(path.join(seriesRoot, "Beta Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Alpha Series", "episode-01.mp4"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Alpha Series", "episode-02.mp4"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Beta Series", "episode-01.mp4"), "fixture");
        await fs.writeFile(path.join(bumpsRoot, "01-first-bump.mp4"), "fixture");
        await fs.writeFile(path.join(bumpsRoot, "02-second-bump.mp4"), "fixture");

        const transcodeRequests = [];
        const playoutProcesses = [];
        const randomValues = [0.999, 0, 0];
        const app = createApp({
            corsOrigin: "*",
            db: context.db,
            ersatzBaseUrl: new URL("http://127.0.0.1:1"),
            jwtSecret: "test-secret",
            serveStatic: false,
            statusApiMode: "public",
            internalSchedule: {
                bumpsRoot,
                seriesAllowlist: ["Alpha Series", "Beta Series"],
                seriesRoot,
                probeMediaAsset: async (filePath) => ({
                    durationSeconds: filePath.includes("bump") ? 30 : 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => randomValues.shift() ?? 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
            },
            internalPlayout: {
                bumpsRoot,
                hlsOutputRoot,
                seriesAllowlist: ["Alpha Series", "Beta Series"],
                seriesRoot,
                probeMediaAsset: async (filePath) => ({
                    durationSeconds: filePath.includes("bump") ? 30 : 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
                random: () => randomValues.shift() ?? 0,
                now: () => new Date("2026-03-14T12:00:00.000Z"),
                transcodeLiveHls: async ({ mediaAsset, outputRoot }) => {
                    const process = new FakePlayoutProcess(10_000 + playoutProcesses.length);
                    transcodeRequests.push(mediaAsset);
                    playoutProcesses.push(process);
                    await fs.mkdir(outputRoot, { recursive: true });
                    const playlistPath = path.join(outputRoot, "hls.m3u8");
                    await fs.writeFile(
                        playlistPath,
                        "#EXTM3U\n#EXT-X-TARGETDURATION:4\nsegment-00001.ts\n"
                    );
                    await fs.writeFile(path.join(outputRoot, "segment-00001.ts"), "segment-data");
                    return { playlistPath, process };
                },
            },
        });

        async function currentSchedulePayload({ bypassCache = false } = {}) {
            const scheduleRequest = request(app)
                .get("/api/schedule");
            if (bypassCache) {
                scheduleRequest.set("Cache-Control", "no-cache");
            }

            const response = await scheduleRequest;

            assert.equal(response.status, 200);
            return response.body;
        }

        async function currentScheduleTitles(options) {
            const payload = await currentSchedulePayload(options);
            return payload.schedule.map((item) => item.title);
        }

        async function channelStateSnapshot() {
            const rows = await context.db.all(
                "SELECT current_rotation_index, bump_cursor, current_media_role FROM channel_state"
            );
            return JSON.stringify(rows);
        }

        async function completeCurrentAsset(
            expectedTitle,
            { requestNextPlaylistTitle = null, requestNextScheduleTitle = null } = {}
        ) {
            // Polling the playlist is idempotent while an asset is active, so this
            // waits for the previous asset's completion to advance the schedule
            // rather than racing it with a fixed sleep.
            await waitFor(
                async () => {
                    const response = await request(app)
                        .get("/iptv/session/1/hls.m3u8");

                    assert.equal(response.status, 200);
                    return transcodeRequests.at(-1)?.title === expectedTitle;
                },
                { label: `transcode of ${expectedTitle}` }
            );

            // Completion advances the schedule asynchronously via the process exit
            // handler; wait for the persisted channel state to settle before the
            // caller asserts on the post-advancement schedule.
            const before = await channelStateSnapshot();
            playoutProcesses.at(-1).emit("exit", 0, null);
            const nextPlaylistResponsePromise = requestNextPlaylistTitle
                ? request(app)
                    .get("/iptv/session/1/hls.m3u8")
                    .then((response) => response)
                : null;
            const nextScheduleResponsePromise = requestNextScheduleTitle
                ? request(app)
                    .get("/api/schedule")
                    .set("Cache-Control", "no-cache")
                    .then((response) => response)
                : null;
            await waitFor(
                async () => (await channelStateSnapshot()) !== before,
                { label: `schedule to advance past ${expectedTitle}` }
            );
            if (nextPlaylistResponsePromise) {
                const nextPlaylistResponse = await nextPlaylistResponsePromise;
                assert.equal(nextPlaylistResponse.status, 200);
                assert.equal(transcodeRequests.at(-1)?.title, requestNextPlaylistTitle);
            }
            if (nextScheduleResponsePromise) {
                const nextScheduleResponse = await nextScheduleResponsePromise;
                assert.equal(nextScheduleResponse.status, 200);
                assert.equal(
                    nextScheduleResponse.body.schedule[0]?.title,
                    requestNextScheduleTitle
                );
            }
        }

        await app.locals.refreshInventory();

        assert.deepEqual(
            (await currentScheduleTitles()).slice(0, 4),
            ["Alpha Series", "Beta Series", "Alpha Series", "Beta Series"]
        );
        assert.deepEqual(
            (await currentScheduleTitles()).slice(0, 2),
            ["Alpha Series", "Beta Series"]
        );

        await completeCurrentAsset("episode-01", {
            requestNextPlaylistTitle: "01-first-bump",
            requestNextScheduleTitle: "Beta Series",
        });
        const bumpHiddenSchedule = await currentSchedulePayload({ bypassCache: true });
        assert.equal(bumpHiddenSchedule.schedule[0]?.title, "Beta Series");
        assert.equal(bumpHiddenSchedule.schedule[0]?.live, false);
        assert.equal(bumpHiddenSchedule.schedule[0]?.startAt, "2026-03-14T12:00:30.000Z");
        assert.equal(bumpHiddenSchedule.refreshAfterMs, 31000);
        assert.deepEqual(
            bumpHiddenSchedule.schedule.map((item) => item.title).slice(0, 3),
            ["Beta Series", "Alpha Series", "Beta Series"]
        );

        await completeCurrentAsset("01-first-bump");
        assert.deepEqual(
            (await currentScheduleTitles({ bypassCache: true })).slice(0, 4),
            ["Beta Series", "Alpha Series", "Beta Series", "Alpha Series"]
        );
        assert.deepEqual(
            await context.db.all(
                "SELECT current_rotation_index, bump_cursor, current_media_role FROM channel_state"
            ),
            [{ current_rotation_index: 1, bump_cursor: 1, current_media_role: "episode" }]
        );
        assert.deepEqual(
            await context.db.all(
                "SELECT series_title, episode_index FROM episode_cursors ORDER BY series_title"
            ),
            [
                { series_title: "Alpha Series", episode_index: 1 },
                { series_title: "Beta Series", episode_index: 0 },
            ]
        );

        await completeCurrentAsset("episode-01");
        await completeCurrentAsset("02-second-bump");
        assert.deepEqual(
            (await currentScheduleTitles({ bypassCache: true })).slice(0, 3),
            ["Alpha Series", "Beta Series", "Alpha Series"]
        );
        assert.deepEqual(
            await context.db.all(
                "SELECT current_rotation_index, bump_cursor, current_media_role FROM channel_state"
            ),
            [{ current_rotation_index: 0, bump_cursor: 0, current_media_role: "episode" }]
        );

        await completeCurrentAsset("episode-02");
        await completeCurrentAsset("01-first-bump");
        assert.deepEqual(
            (await currentScheduleTitles({ bypassCache: true })).slice(0, 3),
            ["Beta Series", "Alpha Series", "Beta Series"]
        );
        assert.deepEqual(
            await context.db.all(
                "SELECT series_title, episode_index FROM episode_cursors ORDER BY series_title"
            ),
            [
                { series_title: "Alpha Series", episode_index: 0 },
                { series_title: "Beta Series", episode_index: 0 },
            ]
        );
    } finally {
        await fs.rm(libraryRoot, { recursive: true, force: true });
        await fs.rm(hlsOutputRoot, { recursive: true, force: true });
        await context.cleanup();
    }
});

test("status diagnostics prune expired rate limits after the cooldown window", async () => {
    const context = await createTestContext();
    const originalDateNow = Date.now;

    try {
        const adminAgent = await createAdminAgent(context);

        let now = originalDateNow();
        Date.now = () => now;

        for (let index = 0; index < 5; index += 1) {
            const response = await adminAgent
                .post("/api/chat/messages")
                .send({ body: `message ${index}` });

            assert.equal(response.status, 201);
            now += 100;
        }

        const limitedResponse = await adminAgent
            .post("/api/chat/messages")
            .send({ body: "message limited" });

        assert.equal(limitedResponse.status, 429);

        const limitedStatus = await adminAgent
            .get("/api/status");
        assert.equal(limitedStatus.body.server.rateLimitedUsers, 1);

        now += 61_000;

        const prunedStatus = await adminAgent
            .get("/api/status");
        assert.equal(prunedStatus.body.server.rateLimitedUsers, 0);
    } finally {
        Date.now = originalDateNow;
        await context.cleanup();
    }
});

test("status diagnostics remove disconnected public stream clients", async () => {
    const context = await createTestContext();
    const server = http.createServer(context.app);

    try {
        const adminAgent = await createAdminAgent(context);

        await new Promise((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });

        const address = server.address();
        assert.ok(address && typeof address === "object");
        const controller = new AbortController();
        const response = await fetch(
            `http://127.0.0.1:${address.port}/api/chat/messages/public/stream`,
            { signal: controller.signal }
        );

        assert.equal(response.status, 200);

        const connectedStatus = await adminAgent
            .get("/api/status");
        assert.equal(connectedStatus.body.chat.publicClients, 1);

        controller.abort();
        await waitFor(
            async () => {
                const status = await adminAgent.get("/api/status");
                return status.body.chat.publicClients === 0;
            },
            { label: "public stream client to disconnect" }
        );

        const disconnectedStatus = await adminAgent
            .get("/api/status");
        assert.equal(disconnectedStatus.body.chat.publicClients, 0);
        assert.equal(disconnectedStatus.body.server.publicChatClients, 0);
        assert.ok(disconnectedStatus.body.chat.lastPublicDisconnectAt);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        await context.cleanup();
    }
});

test("playlist rewriting prefers the configured public origin over forwarded headers", async () => {
    const upstream = http.createServer((req, res) => {
        if (req.url !== "/iptv/session/1/hls.m3u8") {
            res.statusCode = 404;
            res.end("missing");
            return;
        }

        res.setHeader("content-type", "application/vnd.apple.mpegurl");
        res.end("#EXTM3U\nhttps://upstream.invalid/iptv/session/1/hls.m3u8\n");
    });

    await new Promise((resolve) => {
        upstream.listen(0, "127.0.0.1", resolve);
    });

    const address = upstream.address();
    assert.ok(address && typeof address === "object");

    const context = await createTestContext({
        ersatzBaseUrl: new URL(`http://127.0.0.1:${address.port}`),
        publicAppOrigin: "https://stream.example.com",
    });

    try {
        const playlistResponse = await request(context.app)
            .get("/iptv/session/1/hls.m3u8")
            .set("x-forwarded-host", "attacker.invalid")
            .set("x-forwarded-proto", "https");

        assert.equal(playlistResponse.status, 200);
        assert.match(
            playlistResponse.text,
            /https:\/\/stream\.example\.com\/iptv\/session\/1\/hls\.m3u8/
        );
        assert.doesNotMatch(playlistResponse.text, /attacker\.invalid/);
    } finally {
        await new Promise((resolve, reject) => {
            upstream.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        await context.cleanup();
    }
});
