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

    await db.exec(
        "CREATE TABLE IF NOT EXISTS media_assets (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "file_path TEXT NOT NULL UNIQUE," +
        "role TEXT NOT NULL CHECK (role IN ('episode', 'bump'))," +
        "series_title TEXT," +
        "title TEXT NOT NULL," +
        "duration_seconds REAL," +
        "video_codec TEXT," +
        "audio_codec TEXT," +
        "sort_key TEXT NOT NULL," +
        "updated_at TEXT NOT NULL" +
        ");"
    );

    await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_media_assets_role_series_sort " +
        "ON media_assets(role, series_title, sort_key);"
    );

    await db.exec(
        "CREATE TABLE IF NOT EXISTS channel_state (" +
        "id INTEGER PRIMARY KEY CHECK (id = 1)," +
        "current_rotation_index INTEGER NOT NULL DEFAULT 0," +
        "bump_cursor INTEGER NOT NULL DEFAULT 0," +
        "created_at TEXT NOT NULL," +
        "updated_at TEXT NOT NULL" +
        ");"
    );

    await db.exec(
        "CREATE TABLE IF NOT EXISTS series_rotation (" +
        "channel_state_id INTEGER NOT NULL," +
        "position INTEGER NOT NULL," +
        "series_title TEXT NOT NULL," +
        "PRIMARY KEY (channel_state_id, position)," +
        "FOREIGN KEY (channel_state_id) REFERENCES channel_state(id) ON DELETE CASCADE" +
        ");"
    );

    await db.exec(
        "CREATE TABLE IF NOT EXISTS episode_cursors (" +
        "channel_state_id INTEGER NOT NULL," +
        "series_title TEXT NOT NULL," +
        "episode_index INTEGER NOT NULL DEFAULT 0," +
        "PRIMARY KEY (channel_state_id, series_title)," +
        "FOREIGN KEY (channel_state_id) REFERENCES channel_state(id) ON DELETE CASCADE" +
        ");"
    );

    return db;
}
