import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

import { initDb } from "../dist/db.js";
import { loadInternalSchedulePayload } from "../dist/lib/internal-schedule.js";
import { seedAnidbMetadataCacheFromJellyfin } from "../dist/lib/jellyfin-metadata-seed.js";

async function createJellyfinFixture(dbPath) {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
    });

    await db.exec(
        "CREATE TABLE BaseItems (" +
        "Id TEXT PRIMARY KEY," +
        "DateLastRefreshed TEXT," +
        "DateLastSaved TEXT," +
        "IndexNumber INTEGER," +
        "Name TEXT," +
        "OriginalTitle TEXT," +
        "Overview TEXT," +
        "ParentIndexNumber INTEGER," +
        "Path TEXT," +
        "PremiereDate TEXT," +
        "SeriesId TEXT," +
        "SeriesName TEXT," +
        "SortName TEXT," +
        "Type TEXT NOT NULL" +
        ");" +
        "CREATE TABLE BaseItemProviders (" +
        "ItemId TEXT NOT NULL," +
        "ProviderId TEXT NOT NULL," +
        "ProviderValue TEXT NOT NULL," +
        "PRIMARY KEY (ItemId, ProviderId)" +
        ");"
    );

    await db.run(
        "INSERT INTO BaseItems " +
        "(Id, DateLastRefreshed, DateLastSaved, Name, OriginalTitle, Overview, Path, SortName, Type) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        "series-1",
        "2026-03-27 12:39:44.6651531",
        "2026-03-27 12:39:45.0000000",
        "Fixture Series",
        "Fixture Original",
        "Series summary from Jellyfin",
        "/media/ersatz/series/Fixture Series",
        "fixture series",
        "MediaBrowser.Controller.Entities.TV.Series"
    );
    await db.run(
        "INSERT INTO BaseItemProviders (ItemId, ProviderId, ProviderValue) VALUES (?, ?, ?)",
        "series-1",
        "AniDB",
        "1234"
    );

    for (const episode of [
        {
            id: "episode-1",
            indexNumber: 1,
            name: "Jellyfin Pilot",
            overview: "Episode one summary",
            path: "/media/ersatz/series/Fixture Series/Fixture Series - 01.mkv",
            premiereDate: "1999-04-08 00:00:00",
            providerValue: "9001",
        },
        {
            id: "episode-2",
            indexNumber: 2,
            name: "Jellyfin Second",
            overview: "Episode two summary",
            path: "/media/ersatz/series/Fixture Series/Fixture Series - 02.mkv",
            premiereDate: "1999-04-15 00:00:00",
            providerValue: "9002",
        },
    ]) {
        await db.run(
            "INSERT INTO BaseItems " +
            "(Id, DateLastRefreshed, DateLastSaved, IndexNumber, Name, Overview, ParentIndexNumber, Path, PremiereDate, SeriesId, SeriesName, Type) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            episode.id,
            "2026-03-27 12:40:00.0000000",
            "2026-03-27 12:40:01.0000000",
            episode.indexNumber,
            episode.name,
            episode.overview,
            1,
            episode.path,
            episode.premiereDate,
            "series-1",
            "Fixture Series",
            "MediaBrowser.Controller.Entities.TV.Episode"
        );
        await db.run(
            "INSERT INTO BaseItemProviders (ItemId, ProviderId, ProviderValue) VALUES (?, ?, ?)",
            episode.id,
            "AniDB",
            episode.providerValue
        );
    }

    await db.close();
}

test("Jellyfin metadata seed populates the AniDB cache for offline schedule scans", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "andromeda-jellyfin-seed-test-"));
    const jellyfinDbPath = path.join(tempDir, "jellyfin.db");
    const andromedaDbPath = path.join(tempDir, "andromeda.db");
    const seriesRoot = path.join(tempDir, "library", "series");
    const bumpsRoot = path.join(tempDir, "library", "bumps");
    const andromedaDb = await initDb(andromedaDbPath);

    try {
        await createJellyfinFixture(jellyfinDbPath);
        await fs.mkdir(path.join(seriesRoot, "Fixture Series"), { recursive: true });
        await fs.mkdir(bumpsRoot, { recursive: true });
        await fs.writeFile(path.join(seriesRoot, "Fixture Series", "Fixture Series - 01.mkv"), "fixture");
        await fs.writeFile(path.join(seriesRoot, "Fixture Series", "Fixture Series - 02.mkv"), "fixture");

        const result = await seedAnidbMetadataCacheFromJellyfin({
            db: andromedaDb,
            jellyfinDbPath,
            now: () => new Date("2026-04-01T00:00:00.000Z"),
        });

        assert.deepEqual(result, {
            skippedEpisodeCount: 0,
            skippedSeriesCount: 0,
            sourcePath: jellyfinDbPath,
            upsertedEpisodeCount: 2,
            upsertedSeriesCount: 1,
        });

        assert.deepEqual(
            await andromedaDb.all(
                "SELECT anidb_series_id, title, sort_title, synonyms_json, last_success_at, last_attempt_at, updated_at " +
                "FROM anidb_series"
            ),
            [
                {
                    anidb_series_id: 1234,
                    title: "Fixture Series",
                    sort_title: "fixture series",
                    synonyms_json: JSON.stringify(["Fixture Original", "Fixture Series"]),
                    last_success_at: "2026-04-01T00:00:00.000Z",
                    last_attempt_at: "2026-04-01T00:00:00.000Z",
                    updated_at: "2026-04-01T00:00:00.000Z",
                },
            ]
        );
        assert.deepEqual(
            await andromedaDb.all(
                "SELECT anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at " +
                "FROM anidb_episodes ORDER BY chronological_order"
            ),
            [
                {
                    anidb_episode_id: 9001,
                    anidb_series_id: 1234,
                    episode_number: "1",
                    title: "Jellyfin Pilot",
                    summary: "Episode one summary",
                    air_date: "1999-04-08",
                    chronological_order: 1,
                    updated_at: "2026-04-01T00:00:00.000Z",
                },
                {
                    anidb_episode_id: 9002,
                    anidb_series_id: 1234,
                    episode_number: "2",
                    title: "Jellyfin Second",
                    summary: "Episode two summary",
                    air_date: "1999-04-15",
                    chronological_order: 2,
                    updated_at: "2026-04-01T00:00:00.000Z",
                },
            ]
        );

        await fs.rm(jellyfinDbPath);

        const { payload, diagnostics } = await loadInternalSchedulePayload({
            db: andromedaDb,
            seriesRoot,
            bumpsRoot,
            now: () => new Date("2026-04-02T00:00:00.000Z"),
            probeMediaAsset: async () => ({
                durationSeconds: 1800,
                videoCodec: "h264",
                audioCodec: "aac",
            }),
            random: () => 0,
        });

        assert.deepEqual(
            payload.schedule.map((item) => item.episode).slice(0, 2),
            ["Jellyfin Pilot", "Jellyfin Second"]
        );
        assert.deepEqual(diagnostics.excludedSeries, []);
        assert.deepEqual(diagnostics.unresolvedEpisodeAssets, []);
    } finally {
        await andromedaDb.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
