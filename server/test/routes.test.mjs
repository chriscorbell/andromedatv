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

async function createTestContext() {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-routes-test-"));
    const dbPath = path.join(tempDir, "andromeda.db");
    const db = await initDb(dbPath);
    const app = createApp({
        corsOrigin: "*",
        db,
        ersatzBaseUrl: new URL("http://127.0.0.1:8409"),
        jwtSecret: "test-secret",
        serveStatic: false,
        loadSchedulePayload: async () => ({
            fetchedAt: new Date("2026-03-14T12:00:00.000Z").toISOString(),
            refreshAfterMs: 60_000,
            schedule: [],
        }),
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

test("register/login flow returns a token and authorizes the message history route", async () => {
    const context = await createTestContext();

    try {
        const registerResponse = await request(context.app)
            .post("/api/chat/auth/register")
            .send({ nickname: "TestUser", password: "hunter2" });

        assert.equal(registerResponse.status, 201);
        assert.equal(registerResponse.body.nickname, "testuser");
        assert.equal(registerResponse.body.isAdmin, false);
        assert.ok(registerResponse.body.token);
        assert.match(registerResponse.headers["set-cookie"]?.[0] ?? "", /andromeda_stream=/);

        const messagesResponse = await request(context.app)
            .get("/api/chat/messages")
            .set("Authorization", `Bearer ${registerResponse.body.token}`);

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

test("non-admin users are blocked from admin routes", async () => {
    const context = await createTestContext();

    try {
        const registerResponse = await request(context.app)
            .post("/api/chat/auth/register")
            .send({ nickname: "ViewerOne", password: "hunter2" });

        const clearResponse = await request(context.app)
            .post("/api/chat/admin/clear")
            .set("Authorization", `Bearer ${registerResponse.body.token}`);

        assert.equal(clearResponse.status, 403);
        assert.equal(clearResponse.body.error, "Admin access required");
    } finally {
        await context.cleanup();
    }
});

test("admin bootstrap and ban flow are enforced across existing auth tokens", async () => {
    const context = await createTestContext();

    try {
        await ensureInitialAdmin({
            db: context.db,
            nickname: "AndromedaTV",
            password: "supersecret",
        });

        const userRegisterResponse = await request(context.app)
            .post("/api/chat/auth/register")
            .send({ nickname: "NoisyUser", password: "hunter2" });

        const adminLoginResponse = await request(context.app)
            .post("/api/chat/auth/login")
            .send({ nickname: "AndromedaTV", password: "supersecret" });

        assert.equal(adminLoginResponse.status, 200);
        assert.equal(adminLoginResponse.body.isAdmin, true);

        const banResponse = await request(context.app)
            .post("/api/chat/admin/users/noisyuser/ban")
            .set("Authorization", `Bearer ${adminLoginResponse.body.token}`);

        assert.equal(banResponse.status, 200);
        assert.deepEqual(banResponse.body, { ok: true });

        const bannedMessagesResponse = await request(context.app)
            .get("/api/chat/messages")
            .set("Authorization", `Bearer ${userRegisterResponse.body.token}`);

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
        const registerResponse = await request(context.app)
            .post("/api/chat/auth/register")
            .send({ nickname: "StatusUser", password: "hunter2" });

        await request(context.app)
            .get("/api/schedule")
            .expect(200);

        await request(context.app)
            .post("/api/chat/messages")
            .set("Authorization", `Bearer ${registerResponse.body.token}`)
            .send({ body: "hello status panel" })
            .expect(201);

        const statusResponse = await request(context.app)
            .get("/api/status");

        assert.equal(statusResponse.status, 200);
        assert.equal(statusResponse.body.schedule.state, "healthy");
        assert.equal(statusResponse.body.schedule.itemCount, 0);
        assert.equal(statusResponse.body.chat.lastMessageNickname, "statususer");
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
        const registerResponse = await request(context.app)
            .post("/api/chat/auth/register")
            .send({ nickname: "RateLimitUser", password: "hunter2" });

        let now = originalDateNow();
        Date.now = () => now;

        for (let index = 0; index < 5; index += 1) {
            const response = await request(context.app)
                .post("/api/chat/messages")
                .set("Authorization", `Bearer ${registerResponse.body.token}`)
                .send({ body: `message ${index}` });

            assert.equal(response.status, 201);
            now += 100;
        }

        const limitedResponse = await request(context.app)
            .post("/api/chat/messages")
            .set("Authorization", `Bearer ${registerResponse.body.token}`)
            .send({ body: "message limited" });

        assert.equal(limitedResponse.status, 429);

        const limitedStatus = await request(context.app)
            .get("/api/status");
        assert.equal(limitedStatus.body.server.rateLimitedUsers, 1);

        now += 61_000;

        const prunedStatus = await request(context.app)
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

        const connectedStatus = await request(context.app)
            .get("/api/status");
        assert.equal(connectedStatus.body.chat.publicClients, 1);

        controller.abort();
        await wait(25);

        const disconnectedStatus = await request(context.app)
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
