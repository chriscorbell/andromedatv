import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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
