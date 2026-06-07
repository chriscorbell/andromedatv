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

        const scheduleResponse = await request(app)
            .get("/api/schedule");

        assert.equal(scheduleResponse.status, 200);
        assert.deepEqual(
            scheduleResponse.body.schedule.map((item) => item.title).slice(0, 3),
            ["Allowed Series", "01-first", "Allowed Series"]
        );
        assert.deepEqual(scheduleResponse.body.schedule[0], {
            episode: "episode-01",
            live: true,
            startAt: "2026-03-14T12:00:00.000Z",
            stopAt: "2026-03-14T12:30:00.000Z",
            time: "live",
            title: "Allowed Series",
        });
        assert.equal(scheduleResponse.body.schedule[1].startAt, "2026-03-14T12:30:00.000Z");
        assert.equal(scheduleResponse.body.schedule[1].stopAt, "2026-03-14T12:30:30.000Z");

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
                probeMediaAsset: async () => ({
                    durationSeconds: 1800,
                    videoCodec: "h264",
                    audioCodec: "aac",
                }),
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

        const segmentResponse = await request(app)
            .get("/iptv/session/1/segment-00001.ts");

        assert.equal(segmentResponse.status, 200);
        assert.equal(Buffer.from(segmentResponse.body).toString("utf8"), "segment-data");
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

        async function currentScheduleTitles() {
            const response = await request(app)
                .get("/api/schedule");

            assert.equal(response.status, 200);
            return response.body.schedule.map((item) => item.title);
        }

        async function completeCurrentAsset(expectedTitle) {
            const response = await request(app)
                .get("/iptv/session/1/hls.m3u8");

            assert.equal(response.status, 200);
            assert.equal(transcodeRequests.at(-1)?.title, expectedTitle);
            playoutProcesses.at(-1).emit("exit", 0, null);
            await wait(25);
        }

        assert.deepEqual(
            (await currentScheduleTitles()).slice(0, 4),
            ["Alpha Series", "01-first-bump", "Beta Series", "02-second-bump"]
        );
        assert.deepEqual(
            (await currentScheduleTitles()).slice(0, 2),
            ["Alpha Series", "01-first-bump"]
        );

        await completeCurrentAsset("episode-01");
        assert.deepEqual(
            (await currentScheduleTitles()).slice(0, 3),
            ["01-first-bump", "Beta Series", "02-second-bump"]
        );

        await completeCurrentAsset("01-first-bump");
        assert.deepEqual(
            (await currentScheduleTitles()).slice(0, 4),
            ["Beta Series", "02-second-bump", "Alpha Series", "01-first-bump"]
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
            (await currentScheduleTitles()).slice(0, 3),
            ["Alpha Series", "01-first-bump", "Beta Series"]
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
            (await currentScheduleTitles()).slice(0, 3),
            ["Beta Series", "02-second-bump", "Alpha Series"]
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
        await wait(25);

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
