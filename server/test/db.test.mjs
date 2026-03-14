import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import * as dbModule from "../dist/db.js";

test("initDb creates the expected schema and moderation columns", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-db-test-"));
    const dbPath = path.join(tempDir, "andromeda.db");
    const db = await dbModule.initDb(dbPath);

    try {
        const userColumns = await db.all("PRAGMA table_info(users)");
        const messageColumns = await db.all("PRAGMA table_info(messages)");

        assert.equal(userColumns.some((column) => column.name === "nickname"), true);
        assert.equal(userColumns.some((column) => column.name === "banned"), true);
        assert.equal(userColumns.some((column) => column.name === "is_admin"), true);
        assert.equal(messageColumns.some((column) => column.name === "body"), true);
    } finally {
        await db.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
