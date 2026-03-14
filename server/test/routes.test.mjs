import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import request from "supertest";

import { createApp } from "../dist/app.js";
import { ensureInitialAdmin } from "../dist/bootstrap.js";
import { initDb } from "../dist/db.js";

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
