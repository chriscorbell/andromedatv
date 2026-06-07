import fs from "fs/promises";
import path from "path";
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";
import { runExclusiveTransaction } from "./sqlite-transaction";

const DEFAULT_PROVIDER_ID = "AniDB";

type JellyfinMetadataSeedOptions = {
    db: Database;
    jellyfinDbPath: string;
    now?: () => Date;
    providerId?: string;
};

export type JellyfinMetadataSeedResult = {
    skippedEpisodeCount: number;
    skippedSeriesCount: number;
    sourcePath: string;
    upsertedEpisodeCount: number;
    upsertedSeriesCount: number;
};

type JellyfinSeriesRow = {
    id: string;
    name: string | null;
    original_title: string | null;
    path: string | null;
    provider_value: string | null;
    sort_name: string | null;
};

type JellyfinEpisodeRow = {
    anidb_episode_value: string | null;
    anidb_series_value: string | null;
    index_number: number | null;
    name: string | null;
    overview: string | null;
    premiere_date: string | null;
};

function normalizeText(value: string | null | undefined): string | null {
    const normalized = value?.trim().replace(/\s+/g, " ");
    return normalized ? normalized : null;
}

function parsePositiveInteger(value: string | null | undefined): number | null {
    const normalized = value?.trim();
    if (!normalized || !/^\d+$/.test(normalized)) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAirDate(value: string | null | undefined): string | null {
    const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] || null;
}

function buildSynonyms(series: JellyfinSeriesRow, title: string): string {
    const values = [
        normalizeText(series.original_title),
        normalizeText(series.path ? path.basename(series.path) : null),
        title,
    ];
    const synonyms = values.filter((value, index): value is string => (
        Boolean(value) && values.findIndex((candidate) => candidate === value) === index
    ));
    return JSON.stringify(synonyms);
}

async function openJellyfinDb(jellyfinDbPath: string): Promise<Database> {
    try {
        await fs.access(jellyfinDbPath);
    } catch {
        throw new Error(`Jellyfin metadata source not found at ${jellyfinDbPath}`);
    }

    return await open({
        filename: jellyfinDbPath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY,
    });
}

async function loadJellyfinSeries(sourceDb: Database, providerId: string) {
    return await sourceDb.all<Array<JellyfinSeriesRow>>(
        "SELECT items.Id AS id, items.Name AS name, items.OriginalTitle AS original_title, " +
        "items.Path AS path, providers.ProviderValue AS provider_value, items.SortName AS sort_name " +
        "FROM BaseItems items " +
        "LEFT JOIN BaseItemProviders providers " +
        "ON providers.ItemId = items.Id AND providers.ProviderId = ? " +
        "WHERE items.Type LIKE '%TV.Series' " +
        "ORDER BY items.Name COLLATE NOCASE",
        providerId
    );
}

async function loadJellyfinEpisodes(sourceDb: Database, providerId: string) {
    return await sourceDb.all<Array<JellyfinEpisodeRow>>(
        "SELECT episodeProviders.ProviderValue AS anidb_episode_value, " +
        "seriesProviders.ProviderValue AS anidb_series_value, " +
        "episodes.IndexNumber AS index_number, episodes.Name AS name, " +
        "episodes.Overview AS overview, episodes.PremiereDate AS premiere_date " +
        "FROM BaseItems episodes " +
        "LEFT JOIN BaseItemProviders episodeProviders " +
        "ON episodeProviders.ItemId = episodes.Id AND episodeProviders.ProviderId = ? " +
        "LEFT JOIN BaseItems series ON series.Id = episodes.SeriesId " +
        "LEFT JOIN BaseItemProviders seriesProviders " +
        "ON seriesProviders.ItemId = series.Id AND seriesProviders.ProviderId = ? " +
        "WHERE episodes.Type LIKE '%TV.Episode' " +
        "ORDER BY series.Name COLLATE NOCASE, episodes.IndexNumber, episodes.Name COLLATE NOCASE",
        providerId,
        providerId
    );
}

export async function seedAnidbMetadataCacheFromJellyfin(
    options: JellyfinMetadataSeedOptions
): Promise<JellyfinMetadataSeedResult> {
    const timestamp = (options.now ? options.now() : new Date()).toISOString();
    const providerId = options.providerId || DEFAULT_PROVIDER_ID;
    const sourceDb = await openJellyfinDb(options.jellyfinDbPath);

    try {
        const seriesRows = await loadJellyfinSeries(sourceDb, providerId);
        const episodeRows = await loadJellyfinEpisodes(sourceDb, providerId);
        let skippedSeriesCount = 0;
        let skippedEpisodeCount = 0;
        let upsertedSeriesCount = 0;
        let upsertedEpisodeCount = 0;

        await runExclusiveTransaction(options.db, async () => {
            for (const series of seriesRows) {
                const anidbSeriesId = parsePositiveInteger(series.provider_value);
                const title = normalizeText(series.name);
                if (!anidbSeriesId || !title) {
                    skippedSeriesCount += 1;
                    continue;
                }

                await options.db.run(
                    "INSERT INTO anidb_series " +
                    "(anidb_series_id, title, sort_title, synonyms_json, last_success_at, last_attempt_at, last_error, next_retry_at, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?) " +
                    "ON CONFLICT(anidb_series_id) DO UPDATE SET " +
                    "title = excluded.title, " +
                    "sort_title = excluded.sort_title, " +
                    "synonyms_json = excluded.synonyms_json, " +
                    "last_success_at = excluded.last_success_at, " +
                    "last_attempt_at = excluded.last_attempt_at, " +
                    "last_error = NULL, " +
                    "next_retry_at = NULL, " +
                    "updated_at = excluded.updated_at",
                    anidbSeriesId,
                    title,
                    normalizeText(series.sort_name) || title,
                    buildSynonyms(series, title),
                    timestamp,
                    timestamp,
                    timestamp
                );
                upsertedSeriesCount += 1;
            }

            for (const episode of episodeRows) {
                const anidbEpisodeId = parsePositiveInteger(episode.anidb_episode_value);
                const anidbSeriesId = parsePositiveInteger(episode.anidb_series_value);
                const episodeNumber = episode.index_number?.toString();
                const title = normalizeText(episode.name);
                if (!anidbEpisodeId || !anidbSeriesId || !episodeNumber || !title) {
                    skippedEpisodeCount += 1;
                    continue;
                }

                await options.db.run(
                    "INSERT INTO anidb_episodes " +
                    "(anidb_episode_id, anidb_series_id, episode_number, title, summary, air_date, chronological_order, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
                    "ON CONFLICT(anidb_episode_id) DO UPDATE SET " +
                    "anidb_series_id = excluded.anidb_series_id, " +
                    "episode_number = excluded.episode_number, " +
                    "title = excluded.title, " +
                    "summary = excluded.summary, " +
                    "air_date = excluded.air_date, " +
                    "chronological_order = excluded.chronological_order, " +
                    "updated_at = excluded.updated_at",
                    anidbEpisodeId,
                    anidbSeriesId,
                    episodeNumber,
                    title,
                    normalizeText(episode.overview),
                    normalizeAirDate(episode.premiere_date),
                    episode.index_number,
                    timestamp
                );
                upsertedEpisodeCount += 1;
            }
        });

        return {
            skippedEpisodeCount,
            skippedSeriesCount,
            sourcePath: options.jellyfinDbPath,
            upsertedEpisodeCount,
            upsertedSeriesCount,
        };
    } finally {
        await sourceDb.close();
    }
}
