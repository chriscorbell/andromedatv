import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";

export async function initDb(dbPath: string): Promise<Database> {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
    });

    await db.exec("PRAGMA journal_mode = WAL;");

    await db.exec(
        "CREATE TABLE IF NOT EXISTS users (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "nickname TEXT NOT NULL COLLATE NOCASE UNIQUE," +
        "password_hash TEXT NOT NULL," +
        "created_at TEXT NOT NULL," +
        "banned INTEGER NOT NULL DEFAULT 0," +
        "is_admin INTEGER NOT NULL DEFAULT 0" +
        ");"
    );

    await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_users_nickname_nocase ON users(nickname COLLATE NOCASE);"
    );

    const userColumns = await db.all<
        Array<{ name: string }>
    >("PRAGMA table_info(users)");
    const hasBannedColumn = userColumns.some((column) => column.name === "banned");
    if (!hasBannedColumn) {
        await db.exec(
            "ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0"
        );
    }

    const hasIsAdminColumn = userColumns.some((column) => column.name === "is_admin");
    if (!hasIsAdminColumn) {
        await db.exec(
            "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"
        );
    }

    await db.exec(
        "CREATE TABLE IF NOT EXISTS messages (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "nickname TEXT NOT NULL," +
        "body TEXT NOT NULL," +
        "created_at TEXT NOT NULL" +
        ");"
    );

    return db;
}
