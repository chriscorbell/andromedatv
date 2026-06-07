import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";

async function addColumnIfMissing(
    db: Database,
    tableName: string,
    columnName: string,
    definition: string
) {
    const columns = await db.all<Array<{ name: string }>>(
        `PRAGMA table_info(${tableName})`
    );
    const hasColumn = columns.some((column) => column.name === columnName);
    if (!hasColumn) {
        await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
    }
}

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

    await addColumnIfMissing(
        db,
        "users",
        "banned",
        "banned INTEGER NOT NULL DEFAULT 0"
    );
    await addColumnIfMissing(
        db,
        "users",
        "is_admin",
        "is_admin INTEGER NOT NULL DEFAULT 0"
    );

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

    await addColumnIfMissing(
        db,
        "media_assets",
        "anidb_series_id",
        "anidb_series_id INTEGER"
    );
    await addColumnIfMissing(
        db,
        "media_assets",
        "anidb_episode_id",
        "anidb_episode_id INTEGER"
    );
    await addColumnIfMissing(
        db,
        "media_assets",
        "episode_number",
        "episode_number TEXT"
    );
    await addColumnIfMissing(
        db,
        "media_assets",
        "summary",
        "summary TEXT"
    );
    await addColumnIfMissing(
        db,
        "media_assets",
        "air_date",
        "air_date TEXT"
    );
    await addColumnIfMissing(
        db,
        "media_assets",
        "chronological_order",
        "chronological_order REAL"
    );
    await addColumnIfMissing(
        db,
        "media_assets",
        "metadata_source",
        "metadata_source TEXT"
    );

    await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_media_assets_role_series_chronological " +
        "ON media_assets(role, series_title, chronological_order);"
    );

    await db.exec(
        "CREATE TABLE IF NOT EXISTS anidb_series (" +
        "anidb_series_id INTEGER PRIMARY KEY," +
        "title TEXT NOT NULL," +
        "sort_title TEXT," +
        "synonyms_json TEXT NOT NULL DEFAULT '[]'," +
        "last_success_at TEXT," +
        "last_attempt_at TEXT," +
        "last_error TEXT," +
        "next_retry_at TEXT," +
        "updated_at TEXT NOT NULL" +
        ");"
    );

    await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_anidb_series_title " +
        "ON anidb_series(title COLLATE NOCASE);"
    );

    await db.exec(
        "CREATE TABLE IF NOT EXISTS anidb_episodes (" +
        "anidb_episode_id INTEGER PRIMARY KEY," +
        "anidb_series_id INTEGER NOT NULL," +
        "episode_number TEXT NOT NULL," +
        "title TEXT NOT NULL," +
        "summary TEXT," +
        "air_date TEXT," +
        "chronological_order REAL NOT NULL," +
        "updated_at TEXT NOT NULL," +
        "FOREIGN KEY (anidb_series_id) REFERENCES anidb_series(anidb_series_id) ON DELETE CASCADE" +
        ");"
    );

    await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_anidb_episodes_series_order " +
        "ON anidb_episodes(anidb_series_id, chronological_order);"
    );

    await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_anidb_episodes_series_number " +
        "ON anidb_episodes(anidb_series_id, episode_number COLLATE NOCASE);"
    );

    await db.exec(
        "CREATE TABLE IF NOT EXISTS channel_state (" +
        "id INTEGER PRIMARY KEY CHECK (id = 1)," +
        "current_rotation_index INTEGER NOT NULL DEFAULT 0," +
        "bump_cursor INTEGER NOT NULL DEFAULT 0," +
        "current_media_role TEXT NOT NULL DEFAULT 'episode' CHECK (current_media_role IN ('episode', 'bump'))," +
        "created_at TEXT NOT NULL," +
        "updated_at TEXT NOT NULL" +
        ");"
    );

    await addColumnIfMissing(
        db,
        "channel_state",
        "current_media_role",
        "current_media_role TEXT NOT NULL DEFAULT 'episode'"
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

    await db.exec(
        "CREATE TABLE IF NOT EXISTS playout_history (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "media_asset_id INTEGER NOT NULL," +
        "media_file_path TEXT NOT NULL," +
        "media_title TEXT NOT NULL," +
        "media_role TEXT NOT NULL CHECK (media_role IN ('episode', 'bump'))," +
        "started_at TEXT NOT NULL," +
        "start_offset_seconds REAL NOT NULL DEFAULT 0," +
        "completed_at TEXT," +
        "completion_reason TEXT," +
        "created_at TEXT NOT NULL" +
        ");"
    );

    await db.exec(
        "CREATE INDEX IF NOT EXISTS idx_playout_history_active " +
        "ON playout_history(completed_at, started_at);"
    );

    return db;
}
