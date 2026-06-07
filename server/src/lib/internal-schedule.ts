import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import type { Database } from "sqlite";
import { computeScheduleRefreshDelay, SchedulePayload } from "./schedule";
import { runExclusiveTransaction } from "./sqlite-transaction";

const execFileAsync = promisify(execFile);

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
    ".avi",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".webm",
]);

export type MediaProbeFacts = {
    durationSeconds: number;
    videoCodec?: string | null;
    audioCodec?: string | null;
};

export type MediaProbe = (filePath: string) => Promise<MediaProbeFacts>;

export type InternalScheduleOptions = {
    db: Database;
    seriesRoot: string;
    bumpsRoot: string;
    seriesAllowlist?: string[];
    now?: () => Date;
    random?: () => number;
    probeMediaAsset?: MediaProbe;
};

export type InternalScheduleDiagnostics = {
    configured: boolean;
    seriesRoot: string | null;
    bumpsRoot: string | null;
    seriesAllowlist: string[];
    lastScanAt: string | null;
    lastError: string | null;
    scannedEpisodeAssets: number;
    scannedBumpAssets: number;
    scannerDiagnostics: string[];
    unresolvedEpisodeAssets: UnresolvedEpisodeAssetDiagnostic[];
    excludedSeries: ExcludedSeriesDiagnostic[];
    channelState: InternalChannelStateDiagnostic | null;
};

type MediaRole = "episode" | "bump";
type MetadataSource = "anidb" | "filename" | "sidecar";

type InternalChannelStateDiagnostic = {
    currentRotationIndex: number;
    bumpCursor: number;
    currentMediaRole: MediaRole;
    seriesRotation: string[];
    episodeCursors: Array<{
        seriesTitle: string;
        episodeIndex: number;
    }>;
};

type UnresolvedEpisodeAssetDiagnostic = {
    filePath: string;
    reason: string;
    seriesTitle: string;
};

type ExcludedSeriesDiagnostic = {
    reason: string;
    seriesTitle: string;
};

type ScannedAsset = {
    role: MediaRole;
    filePath: string;
    title: string;
    seriesTitle: string | null;
    sortKey: string;
    durationSeconds: number;
    videoCodec?: string | null;
    audioCodec?: string | null;
    anidbSeriesId?: number | null;
    anidbEpisodeId?: number | null;
    episodeNumber?: string | null;
    summary?: string | null;
    airDate?: string | null;
    chronologicalOrder?: number | null;
    metadataSource?: MetadataSource | null;
};

type MediaAssetRow = {
    id: number;
    role: MediaRole;
    file_path: string;
    series_title: string | null;
    title: string;
    duration_seconds: number | null;
    summary: string | null;
};

type ChannelStateRow = {
    id: number;
    current_rotation_index: number;
    bump_cursor: number;
    current_media_role: MediaRole;
};

type EpisodeCursorRow = {
    series_title: string;
    episode_index: number;
};

type SeriesRotationRow = {
    series_title: string;
};

type PositionedSeriesRotationRow = SeriesRotationRow & {
    position: number;
};

type PlayoutCursor = {
    bumpCursor: number;
    currentMediaRole: MediaRole;
    episodeCursorsBySeries: Map<string, number>;
    rotationIndex: number;
};

type AnidbSeriesRow = {
    anidb_series_id: number;
    title: string;
    sort_title: string | null;
    synonyms_json: string;
};

type AnidbEpisodeRow = {
    anidb_episode_id: number;
    anidb_series_id: number;
    episode_number: string;
    title: string;
    summary: string | null;
    air_date: string | null;
    chronological_order: number;
};

type MetadataCache = {
    seriesById: Map<number, AnidbSeriesRow>;
    seriesByLookupKey: Map<string, AnidbSeriesRow>;
    episodesById: Map<number, AnidbEpisodeRow>;
    episodesBySeriesAndNumber: Map<number, Map<string, AnidbEpisodeRow>>;
};

type SidecarSeriesOverride = {
    title?: string;
    sortTitle?: string;
    anidbSeriesId?: number;
    synonyms?: string[];
};

type SidecarEpisodeOverride = {
    path: string;
    anidbEpisodeId?: number;
    episodeNumber?: string;
    title?: string;
    summary?: string;
    airDate?: string;
    chronologicalOrder?: number;
    exclude?: boolean;
    invalidReason?: string;
};

type SidecarOverride = {
    series?: SidecarSeriesOverride;
    episodesByPath: Map<string, SidecarEpisodeOverride>;
};

type EpisodeFileEntry = {
    filePath: string;
    fileName: string;
    relativePath: string;
};

type ResolvedEpisodeAsset = {
    anidbEpisodeId?: number | null;
    anidbSeriesId?: number | null;
    airDate?: string | null;
    chronologicalOrder: number;
    episodeNumber?: string | null;
    metadataSource: MetadataSource;
    seriesTitle: string;
    summary?: string | null;
    title: string;
};

type UnresolvedEpisodeAsset = {
    reason: string;
    seriesTitle: string;
};

type SchedulableSeriesRow = {
    episode_count: number;
    series_title: string;
};

export type InternalMediaAsset = {
    id: number;
    role: MediaRole;
    filePath: string;
    seriesTitle: string | null;
    title: string;
    durationSeconds: number;
};

type FfprobeJson = {
    format?: {
        duration?: string;
    };
    streams?: Array<{
        codec_name?: string;
        codec_type?: string;
    }>;
};

const channelStateInitializationLocks = new WeakMap<Database, Promise<void>>();
const SIDECAR_FILE_NAME = "andromeda.sidecar.json";
const SIDECAR_ROOT_FIELDS = new Set(["sidecarVersion", "series", "episodes"]);
const SIDECAR_SERIES_FIELDS = new Set(["title", "sortTitle", "anidbSeriesId", "synonyms"]);
const SIDECAR_EPISODE_FIELDS = new Set([
    "path",
    "anidbEpisodeId",
    "episodeNumber",
    "title",
    "summary",
    "airDate",
    "chronologicalOrder",
    "exclude",
]);

function naturalCompare(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getUnknownFields(value: Record<string, unknown>, allowedFields: Set<string>) {
    return Object.keys(value).filter((field) => !allowedFields.has(field));
}

function normalizeMetadataLookupKey(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeEpisodeNumber(value: string): string {
    const normalized = value.trim().toLocaleLowerCase();
    return normalized.replace(/^0+(?=\d)/, "");
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function optionalNonEmptyString(
    value: unknown,
    fieldName: string,
    diagnostics: string[]
): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        diagnostics.push(`Invalid Sidecar Override field ${fieldName}: expected a non-empty string`);
        return undefined;
    }
    return value.trim();
}

function optionalInteger(
    value: unknown,
    fieldName: string,
    diagnostics: string[]
): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Number.isInteger(value)) {
        diagnostics.push(`Invalid Sidecar Override field ${fieldName}: expected an integer`);
        return undefined;
    }
    return value as number;
}

function optionalFiniteNumber(
    value: unknown,
    fieldName: string,
    diagnostics: string[]
): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!isFiniteNumber(value)) {
        diagnostics.push(`Invalid Sidecar Override field ${fieldName}: expected a finite number`);
        return undefined;
    }
    return value;
}

function parseSidecarEpisodePath(value: unknown, diagnostics: string[]): string | null {
    const rawPath = optionalNonEmptyString(value, "episodes[].path", diagnostics);
    if (!rawPath) {
        return null;
    }

    const slashPath = rawPath.replace(/\\/g, "/");
    if (
        path.posix.isAbsolute(slashPath) ||
        path.win32.isAbsolute(rawPath) ||
        slashPath.split("/").includes("..")
    ) {
        diagnostics.push(`Invalid Sidecar Override episode path ${rawPath}: path must stay inside the Series directory`);
        return null;
    }

    const normalized = path.posix.normalize(slashPath);
    if (normalized === "." || normalized.startsWith("../")) {
        diagnostics.push(`Invalid Sidecar Override episode path ${rawPath}: path must stay inside the Series directory`);
        return null;
    }
    return normalized;
}

function parseEpisodeNumberFromFileName(fileName: string): string | null {
    const title = getMediaTitle(fileName);
    const seasonEpisodeMatch = title.match(/\bS\d+\s*E(\d+)\b/i);
    if (seasonEpisodeMatch?.[1]) {
        return normalizeEpisodeNumber(seasonEpisodeMatch[1]);
    }

    const numberMatches = [...title.matchAll(/(?:^|[^\d])(\d{1,4})(?=[^\d]|$)/g)];
    const lastMatch = numberMatches.at(-1);
    if (!lastMatch?.[1]) {
        return null;
    }
    return normalizeEpisodeNumber(lastMatch[1]);
}

function toSidecarRelativePath(seriesPath: string, filePath: string): string {
    return path.relative(seriesPath, filePath).split(path.sep).join("/");
}

function getMediaTitle(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
}

function isSupportedMediaFile(fileName: string): boolean {
    return SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
}

function clampRandomIndex(random: () => number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    const value = random();
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}

function shuffleSeries(seriesTitles: string[], random: () => number): string[] {
    const shuffled = seriesTitles.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = clampRandomIndex(random, index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

export async function probeMediaAssetWithFfprobe(filePath: string): Promise<MediaProbeFacts> {
    const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name",
        "-of",
        "json",
        filePath,
    ]);
    const parsed = JSON.parse(stdout) as FfprobeJson;
    const durationSeconds = Number(parsed.format?.duration);

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error("ffprobe did not report a usable duration");
    }

    return {
        durationSeconds,
        videoCodec: parsed.streams?.find((stream) => stream.codec_type === "video")?.codec_name || null,
        audioCodec: parsed.streams?.find((stream) => stream.codec_type === "audio")?.codec_name || null,
    };
}

async function listDirectoryEntries(root: string, diagnostics: string[]) {
    try {
        return await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
        diagnostics.push(
            `Unable to read ${root}: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}

async function listEpisodeFileEntries(
    seriesPath: string,
    diagnostics: string[]
): Promise<EpisodeFileEntry[]> {
    const entries: EpisodeFileEntry[] = [];

    async function walk(directoryPath: string) {
        const directoryEntries = (await listDirectoryEntries(directoryPath, diagnostics))
            .sort((left, right) => naturalCompare(left.name, right.name));

        for (const entry of directoryEntries) {
            const filePath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                await walk(filePath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            entries.push({
                fileName: entry.name,
                filePath,
                relativePath: toSidecarRelativePath(seriesPath, filePath),
            });
        }
    }

    await walk(seriesPath);
    return entries.sort((left, right) => naturalCompare(left.relativePath, right.relativePath));
}

function parseSynonyms(
    value: string,
    seriesTitle: string,
    diagnostics: string[]
): string[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            diagnostics.push(`Ignoring AniDB synonyms for ${seriesTitle}: synonyms_json is not an array`);
            return [];
        }
        return parsed
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((item) => item.trim());
    } catch (error) {
        diagnostics.push(
            `Ignoring AniDB synonyms for ${seriesTitle}: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }
}

function addSeriesLookupKey(
    seriesByLookupKey: Map<string, AnidbSeriesRow>,
    value: string | null | undefined,
    series: AnidbSeriesRow
) {
    if (!value) {
        return;
    }
    const key = normalizeMetadataLookupKey(value);
    if (!key || seriesByLookupKey.has(key)) {
        return;
    }
    seriesByLookupKey.set(key, series);
}

async function loadMetadataCache(
    db: Database,
    diagnostics: string[]
): Promise<MetadataCache> {
    const seriesRows = await db.all<Array<AnidbSeriesRow>>(
        "SELECT anidb_series_id, title, sort_title, synonyms_json FROM anidb_series " +
        "WHERE last_success_at IS NOT NULL " +
        "ORDER BY title COLLATE NOCASE"
    );
    const episodeRows = await db.all<Array<AnidbEpisodeRow>>(
        "SELECT episodes.anidb_episode_id, episodes.anidb_series_id, episodes.episode_number, " +
        "episodes.title, episodes.summary, episodes.air_date, episodes.chronological_order " +
        "FROM anidb_episodes episodes " +
        "INNER JOIN anidb_series series ON series.anidb_series_id = episodes.anidb_series_id " +
        "WHERE series.last_success_at IS NOT NULL " +
        "ORDER BY episodes.anidb_series_id, episodes.chronological_order"
    );

    const seriesById = new Map<number, AnidbSeriesRow>();
    const seriesByLookupKey = new Map<string, AnidbSeriesRow>();
    const episodesById = new Map<number, AnidbEpisodeRow>();
    const episodesBySeriesAndNumber = new Map<number, Map<string, AnidbEpisodeRow>>();

    for (const series of seriesRows) {
        seriesById.set(series.anidb_series_id, series);
        addSeriesLookupKey(seriesByLookupKey, series.title, series);
        addSeriesLookupKey(seriesByLookupKey, series.sort_title, series);
        for (const synonym of parseSynonyms(series.synonyms_json, series.title, diagnostics)) {
            addSeriesLookupKey(seriesByLookupKey, synonym, series);
        }
    }

    for (const episode of episodeRows) {
        episodesById.set(episode.anidb_episode_id, episode);
        const numberKey = normalizeEpisodeNumber(episode.episode_number);
        const episodeMap =
            episodesBySeriesAndNumber.get(episode.anidb_series_id) || new Map<string, AnidbEpisodeRow>();
        if (!episodeMap.has(numberKey)) {
            episodeMap.set(numberKey, episode);
        }
        episodesBySeriesAndNumber.set(episode.anidb_series_id, episodeMap);
    }

    return {
        episodesById,
        episodesBySeriesAndNumber,
        seriesById,
        seriesByLookupKey,
    };
}

function parseSidecarSeries(
    value: unknown,
    diagnostics: string[]
): SidecarSeriesOverride | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        diagnostics.push("Invalid Sidecar Override field series: expected an object");
        return undefined;
    }

    for (const field of getUnknownFields(value, SIDECAR_SERIES_FIELDS)) {
        diagnostics.push(`Unknown Sidecar Override field series.${field}`);
    }

    const synonymsValue = value.synonyms;
    let synonyms: string[] | undefined;
    if (synonymsValue !== undefined) {
        if (!Array.isArray(synonymsValue)) {
            diagnostics.push("Invalid Sidecar Override field series.synonyms: expected an array");
        } else {
            synonyms = synonymsValue
                .map((synonym, index) => optionalNonEmptyString(
                    synonym,
                    `series.synonyms[${index}]`,
                    diagnostics
                ))
                .filter((synonym): synonym is string => Boolean(synonym));
        }
    }

    const title = optionalNonEmptyString(value.title, "series.title", diagnostics);
    const sortTitle = optionalNonEmptyString(value.sortTitle, "series.sortTitle", diagnostics);
    const anidbSeriesId = optionalInteger(
        value.anidbSeriesId,
        "series.anidbSeriesId",
        diagnostics
    );

    return {
        ...(title ? { title } : {}),
        ...(sortTitle ? { sortTitle } : {}),
        ...(anidbSeriesId !== undefined ? { anidbSeriesId } : {}),
        ...(synonyms ? { synonyms } : {}),
    };
}

function parseSidecarEpisode(
    value: unknown,
    diagnostics: string[]
): SidecarEpisodeOverride | null {
    if (!isRecord(value)) {
        diagnostics.push("Invalid Sidecar Override episode entry: expected an object");
        return null;
    }

    for (const field of getUnknownFields(value, SIDECAR_EPISODE_FIELDS)) {
        diagnostics.push(`Unknown Sidecar Override field episodes[].${field}`);
    }

    const episodePath = parseSidecarEpisodePath(value.path, diagnostics);
    if (!episodePath) {
        return null;
    }

    const exclude = value.exclude === undefined
        ? undefined
        : value.exclude === true
            ? true
            : value.exclude === false
                ? false
                : undefined;
    if (value.exclude !== undefined && exclude === undefined) {
        diagnostics.push("Invalid Sidecar Override field episodes[].exclude: expected a boolean");
    }

    const anidbEpisodeId = optionalInteger(
        value.anidbEpisodeId,
        "episodes[].anidbEpisodeId",
        diagnostics
    );
    const episodeNumber = optionalNonEmptyString(
        value.episodeNumber,
        "episodes[].episodeNumber",
        diagnostics
    );
    const title = optionalNonEmptyString(value.title, "episodes[].title", diagnostics);
    const summary = optionalNonEmptyString(value.summary, "episodes[].summary", diagnostics);
    const airDate = optionalNonEmptyString(value.airDate, "episodes[].airDate", diagnostics);
    const chronologicalOrder = optionalFiniteNumber(
        value.chronologicalOrder,
        "episodes[].chronologicalOrder",
        diagnostics
    );

    return {
        path: episodePath,
        ...(anidbEpisodeId !== undefined ? { anidbEpisodeId } : {}),
        ...(episodeNumber ? { episodeNumber } : {}),
        ...(title ? { title } : {}),
        ...(summary ? { summary } : {}),
        ...(airDate ? { airDate } : {}),
        ...(chronologicalOrder !== undefined ? { chronologicalOrder } : {}),
        ...(exclude !== undefined ? { exclude } : {}),
    };
}

async function readSidecarOverride(
    seriesPath: string,
    diagnostics: string[]
): Promise<SidecarOverride | null> {
    const sidecarPath = path.join(seriesPath, SIDECAR_FILE_NAME);
    let rawSidecar: string;
    try {
        rawSidecar = await fs.readFile(sidecarPath, "utf8");
    } catch (error) {
        if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code?: unknown }).code === "ENOENT"
        ) {
            return null;
        }
        diagnostics.push(
            `Unable to read Sidecar Override ${sidecarPath}: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawSidecar);
    } catch (error) {
        diagnostics.push(
            `Invalid Sidecar Override ${sidecarPath}: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }

    if (!isRecord(parsed)) {
        diagnostics.push(`Invalid Sidecar Override ${sidecarPath}: expected a JSON object`);
        return null;
    }

    for (const field of getUnknownFields(parsed, SIDECAR_ROOT_FIELDS)) {
        diagnostics.push(`Unknown Sidecar Override field ${field}`);
    }

    if (parsed.sidecarVersion !== 1) {
        diagnostics.push(`Invalid Sidecar Override ${sidecarPath}: sidecarVersion must be 1`);
        return null;
    }

    const episodesByPath = new Map<string, SidecarEpisodeOverride>();
    const chronologyPathsByValue = new Map<number, string[]>();
    if (parsed.episodes !== undefined) {
        if (!Array.isArray(parsed.episodes)) {
            diagnostics.push("Invalid Sidecar Override field episodes: expected an array");
        } else {
            for (const episodeValue of parsed.episodes) {
                const episode = parseSidecarEpisode(episodeValue, diagnostics);
                if (!episode) {
                    continue;
                }
                if (episodesByPath.has(episode.path)) {
                    diagnostics.push(`Duplicate Sidecar Override episode path ${episode.path}`);
                    episodesByPath.set(episode.path, {
                        ...episode,
                        invalidReason: "duplicate sidecar episode path",
                    });
                    continue;
                }
                episodesByPath.set(episode.path, episode);
                if (episode.chronologicalOrder !== undefined) {
                    const paths = chronologyPathsByValue.get(episode.chronologicalOrder) || [];
                    paths.push(episode.path);
                    chronologyPathsByValue.set(episode.chronologicalOrder, paths);
                }
            }
        }
    }

    for (const paths of chronologyPathsByValue.values()) {
        if (paths.length < 2) {
            continue;
        }
        diagnostics.push(`Duplicate Sidecar Override chronologicalOrder for ${paths.join(", ")}`);
        for (const episodePath of paths) {
            const episode = episodesByPath.get(episodePath);
            if (episode) {
                episodesByPath.set(episodePath, {
                    ...episode,
                    invalidReason: "duplicate sidecar chronological order",
                });
            }
        }
    }

    return {
        episodesByPath,
        series: parseSidecarSeries(parsed.series, diagnostics),
    };
}

function resolveSeriesMetadata(
    folderTitle: string,
    sidecar: SidecarOverride | null,
    cache: MetadataCache
) {
    const sidecarSeriesId = sidecar?.series?.anidbSeriesId;
    if (sidecarSeriesId !== undefined) {
        return cache.seriesById.get(sidecarSeriesId) || null;
    }
    return cache.seriesByLookupKey.get(normalizeMetadataLookupKey(folderTitle)) || null;
}

function findCachedEpisode(
    cache: MetadataCache,
    cachedSeries: AnidbSeriesRow | null,
    sidecarEpisode: SidecarEpisodeOverride | undefined,
    parsedEpisodeNumber: string | null
): AnidbEpisodeRow | null {
    if (sidecarEpisode?.anidbEpisodeId !== undefined) {
        return cache.episodesById.get(sidecarEpisode.anidbEpisodeId) || null;
    }

    if (!cachedSeries) {
        return null;
    }

    const episodeNumber = sidecarEpisode?.episodeNumber || parsedEpisodeNumber;
    if (!episodeNumber) {
        return null;
    }

    const episodeMap = cache.episodesBySeriesAndNumber.get(cachedSeries.anidb_series_id);
    return episodeMap?.get(normalizeEpisodeNumber(episodeNumber)) || null;
}

function getResolvedSeriesTitle(
    folderTitle: string,
    sidecar: SidecarOverride | null,
    cachedSeries: AnidbSeriesRow | null
): string {
    return sidecar?.series?.title || cachedSeries?.title || folderTitle;
}

function resolveEpisodeAsset(
    folderTitle: string,
    fileName: string,
    relativePath: string,
    episodeIndex: number,
    sidecar: SidecarOverride | null,
    cachedSeries: AnidbSeriesRow | null,
    cache: MetadataCache,
    allowFilenameFallback: boolean
): ResolvedEpisodeAsset | UnresolvedEpisodeAsset {
    const sidecarEpisode = sidecar?.episodesByPath.get(relativePath);
    const parsedEpisodeNumber = sidecarEpisode?.episodeNumber || parseEpisodeNumberFromFileName(fileName);
    const cachedEpisode = findCachedEpisode(
        cache,
        cachedSeries,
        sidecarEpisode,
        parsedEpisodeNumber
    );
    const seriesTitle = getResolvedSeriesTitle(folderTitle, sidecar, cachedSeries);

    if (sidecarEpisode?.exclude) {
        return {
            reason: "excluded by sidecar override",
            seriesTitle,
        };
    }

    if (sidecarEpisode?.invalidReason) {
        return {
            reason: sidecarEpisode.invalidReason,
            seriesTitle,
        };
    }

    const chronologicalOrder =
        sidecarEpisode?.chronologicalOrder ??
        cachedEpisode?.chronological_order ??
        (allowFilenameFallback ? episodeIndex + 1 : undefined);

    if (!isFiniteNumber(chronologicalOrder)) {
        return {
            reason: "no trusted chronological episode order",
            seriesTitle,
        };
    }

    const metadataSource: MetadataSource = sidecarEpisode
        ? "sidecar"
        : cachedEpisode || cachedSeries
            ? "anidb"
            : "filename";

    return {
        airDate: sidecarEpisode?.airDate ?? cachedEpisode?.air_date ?? null,
        anidbEpisodeId: sidecarEpisode?.anidbEpisodeId ?? cachedEpisode?.anidb_episode_id ?? null,
        anidbSeriesId: sidecar?.series?.anidbSeriesId ?? cachedSeries?.anidb_series_id ?? null,
        chronologicalOrder,
        episodeNumber: sidecarEpisode?.episodeNumber ?? cachedEpisode?.episode_number ?? parsedEpisodeNumber ?? null,
        metadataSource,
        seriesTitle,
        summary: sidecarEpisode?.summary ?? cachedEpisode?.summary ?? null,
        title: sidecarEpisode?.title ?? cachedEpisode?.title ?? getMediaTitle(fileName),
    };
}

async function scanMediaFile(
    filePath: string,
    asset: Omit<ScannedAsset, "durationSeconds" | "videoCodec" | "audioCodec">,
    probeMediaAsset: MediaProbe,
    diagnostics: string[]
): Promise<ScannedAsset | null> {
    try {
        const facts = await probeMediaAsset(filePath);
        if (!Number.isFinite(facts.durationSeconds) || facts.durationSeconds <= 0) {
            diagnostics.push(`Skipping ${filePath}: missing usable duration`);
            return null;
        }

        return {
            ...asset,
            audioCodec: facts.audioCodec || null,
            durationSeconds: facts.durationSeconds,
            videoCodec: facts.videoCodec || null,
        };
    } catch (error) {
        diagnostics.push(
            `Skipping ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }
}

export async function scanInternalLibrary(options: InternalScheduleOptions) {
    const diagnostics: string[] = [];
    const unresolvedEpisodeAssets: UnresolvedEpisodeAssetDiagnostic[] = [];
    const excludedSeriesByTitle = new Map<string, ExcludedSeriesDiagnostic>();
    const probeMediaAsset = options.probeMediaAsset || probeMediaAssetWithFfprobe;
    const allowlist = new Set(
        (options.seriesAllowlist || [])
            .map((seriesTitle) => seriesTitle.trim())
            .filter(Boolean)
    );
    const allowFilenameFallback = allowlist.size > 0;
    const metadataCache = await loadMetadataCache(options.db, diagnostics);
    const assets: ScannedAsset[] = [];

    const seriesEntries = (await listDirectoryEntries(options.seriesRoot, diagnostics))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => naturalCompare(left.name, right.name));

    for (const seriesEntry of seriesEntries) {
        const seriesTitle = seriesEntry.name;
        if (allowlist.size > 0 && !allowlist.has(seriesTitle)) {
            continue;
        }

        const seriesPath = path.join(options.seriesRoot, seriesTitle);
        const sidecar = await readSidecarOverride(seriesPath, diagnostics);
        const cachedSeries = resolveSeriesMetadata(seriesTitle, sidecar, metadataCache);
        const episodeEntries = await listEpisodeFileEntries(seriesPath, diagnostics);
        let schedulableEpisodeCount = 0;
        let playableEpisodeCount = 0;
        let lastUnresolvedReason = "no trusted chronological episode order";

        for (const [episodeIndex, episodeEntry] of episodeEntries.entries()) {
            if (episodeEntry.fileName === SIDECAR_FILE_NAME) {
                continue;
            }
            if (!isSupportedMediaFile(episodeEntry.fileName)) {
                if (episodeEntry.fileName !== SIDECAR_FILE_NAME) {
                    diagnostics.push(`Skipping unsupported Episode Asset ${episodeEntry.filePath}`);
                }
                continue;
            }

            let facts: MediaProbeFacts;
            try {
                facts = await probeMediaAsset(episodeEntry.filePath);
            } catch (error) {
                diagnostics.push(
                    `Skipping ${episodeEntry.filePath}: ${error instanceof Error ? error.message : String(error)}`
                );
                continue;
            }

            if (!Number.isFinite(facts.durationSeconds) || facts.durationSeconds <= 0) {
                diagnostics.push(`Skipping ${episodeEntry.filePath}: missing usable duration`);
                continue;
            }

            playableEpisodeCount += 1;
            const resolved = resolveEpisodeAsset(
                seriesTitle,
                episodeEntry.fileName,
                episodeEntry.relativePath,
                episodeIndex,
                sidecar,
                cachedSeries,
                metadataCache,
                allowFilenameFallback
            );
            if ("reason" in resolved) {
                lastUnresolvedReason = resolved.reason;
                unresolvedEpisodeAssets.push({
                    filePath: episodeEntry.filePath,
                    reason: resolved.reason,
                    seriesTitle: resolved.seriesTitle,
                });
                continue;
            }

            schedulableEpisodeCount += 1;
            assets.push({
                airDate: resolved.airDate,
                anidbEpisodeId: resolved.anidbEpisodeId,
                anidbSeriesId: resolved.anidbSeriesId,
                audioCodec: facts.audioCodec || null,
                chronologicalOrder: resolved.chronologicalOrder,
                durationSeconds: facts.durationSeconds,
                episodeNumber: resolved.episodeNumber,
                filePath: episodeEntry.filePath,
                metadataSource: resolved.metadataSource,
                role: "episode",
                seriesTitle: resolved.seriesTitle,
                sortKey: episodeEntry.relativePath,
                summary: resolved.summary,
                title: resolved.title,
                videoCodec: facts.videoCodec || null,
            });
        }

        if (playableEpisodeCount > 0 && schedulableEpisodeCount === 0) {
            const resolvedSeriesTitle = getResolvedSeriesTitle(seriesTitle, sidecar, cachedSeries);
            excludedSeriesByTitle.set(resolvedSeriesTitle, {
                reason: lastUnresolvedReason,
                seriesTitle: resolvedSeriesTitle,
            });
        }
    }

    const bumpEntries = (await listDirectoryEntries(options.bumpsRoot, diagnostics))
        .filter((entry) => entry.isFile())
        .sort((left, right) => naturalCompare(left.name, right.name));

    for (const bumpEntry of bumpEntries) {
        const filePath = path.join(options.bumpsRoot, bumpEntry.name);
        if (!isSupportedMediaFile(bumpEntry.name)) {
            diagnostics.push(`Skipping unsupported Bump Asset ${filePath}`);
            continue;
        }

        const asset = await scanMediaFile(
            filePath,
            {
                filePath,
                role: "bump",
                seriesTitle: null,
                sortKey: bumpEntry.name,
                title: getMediaTitle(bumpEntry.name),
            },
            probeMediaAsset,
            diagnostics
        );
        if (asset) {
            assets.push(asset);
        }
    }

    return {
        assets,
        diagnostics,
        excludedSeries: [...excludedSeriesByTitle.values()]
            .sort((left, right) => naturalCompare(left.seriesTitle, right.seriesTitle)),
        unresolvedEpisodeAssets,
    };
}

function isPathWithinRoot(filePath: string, root: string): boolean {
    const relativePath = path.relative(root, filePath);
    return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function pruneStaleMediaAssets(
    db: Database,
    assets: ScannedAsset[],
    seriesRoot: string,
    bumpsRoot: string
) {
    const scannedPaths = new Set(assets.map((asset) => asset.filePath));
    const existingRows = await db.all<Array<{ file_path: string }>>(
        "SELECT file_path FROM media_assets"
    );

    for (const row of existingRows) {
        const isManagedPath =
            isPathWithinRoot(row.file_path, seriesRoot) ||
            isPathWithinRoot(row.file_path, bumpsRoot);
        if (isManagedPath && !scannedPaths.has(row.file_path)) {
            await db.run("DELETE FROM media_assets WHERE file_path = ?", row.file_path);
        }
    }
}

async function persistMediaAssets(
    db: Database,
    assets: ScannedAsset[],
    now: Date,
    seriesRoot: string,
    bumpsRoot: string
) {
    const updatedAt = now.toISOString();
    return runExclusiveTransaction(db, async () => {
        for (const asset of assets) {
            await db.run(
                "INSERT INTO media_assets " +
                "(file_path, role, series_title, title, duration_seconds, video_codec, audio_codec, sort_key, " +
                "anidb_series_id, anidb_episode_id, episode_number, summary, air_date, chronological_order, metadata_source, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
                "ON CONFLICT(file_path) DO UPDATE SET " +
                "role = excluded.role, " +
                "series_title = excluded.series_title, " +
                "title = excluded.title, " +
                "duration_seconds = excluded.duration_seconds, " +
                "video_codec = excluded.video_codec, " +
                "audio_codec = excluded.audio_codec, " +
                "sort_key = excluded.sort_key, " +
                "anidb_series_id = excluded.anidb_series_id, " +
                "anidb_episode_id = excluded.anidb_episode_id, " +
                "episode_number = excluded.episode_number, " +
                "summary = excluded.summary, " +
                "air_date = excluded.air_date, " +
                "chronological_order = excluded.chronological_order, " +
                "metadata_source = excluded.metadata_source, " +
                "updated_at = excluded.updated_at",
                asset.filePath,
                asset.role,
                asset.seriesTitle,
                asset.title,
                asset.durationSeconds,
                asset.videoCodec || null,
                asset.audioCodec || null,
                asset.sortKey,
                asset.anidbSeriesId || null,
                asset.anidbEpisodeId || null,
                asset.episodeNumber || null,
                asset.summary || null,
                asset.airDate || null,
                asset.chronologicalOrder ?? null,
                asset.metadataSource || null,
                updatedAt
            );
        }
        await pruneStaleMediaAssets(db, assets, seriesRoot, bumpsRoot);
    });
}

async function ensureChannelState(
    db: Database,
    random: () => number,
    now: Date
): Promise<ChannelStateRow> {
    return withChannelStateInitializationLock(db, async () => {
        return ensureChannelStateUnlocked(db, random, now);
    });
}

async function withChannelStateInitializationLock<T>(
    db: Database,
    action: () => Promise<T>
): Promise<T> {
    const previousLock = channelStateInitializationLocks.get(db) || Promise.resolve();
    let releaseLock = () => {};
    const currentLock = previousLock
        .catch(() => undefined)
        .then(() => new Promise<void>((resolve) => {
            releaseLock = resolve;
        }));

    channelStateInitializationLocks.set(db, currentLock);
    await previousLock.catch(() => undefined);

    try {
        return await action();
    } finally {
        releaseLock();
        if (channelStateInitializationLocks.get(db) === currentLock) {
            channelStateInitializationLocks.delete(db);
        }
    }
}

async function ensureChannelStateUnlocked(
    db: Database,
    random: () => number,
    now: Date
): Promise<ChannelStateRow> {
    const existingState = await db.get<ChannelStateRow>(
        "SELECT id, current_rotation_index, bump_cursor, current_media_role FROM channel_state WHERE id = 1"
    );
    if (existingState) {
        return reconcileChannelState(db, existingState, random, now);
    }

    const timestamp = now.toISOString();

    await db.run(
        "INSERT INTO channel_state (id, current_rotation_index, bump_cursor, current_media_role, created_at, updated_at) " +
        "VALUES (1, 0, 0, 'episode', ?, ?)",
        timestamp,
        timestamp
    );

    return reconcileChannelState(db, {
        id: 1,
        current_rotation_index: 0,
        bump_cursor: 0,
        current_media_role: "episode",
    }, random, now);
}

async function loadSchedulableSeriesRows(db: Database): Promise<SchedulableSeriesRow[]> {
    return db.all<Array<SchedulableSeriesRow>>(
        "SELECT series_title, COUNT(*) AS episode_count FROM media_assets " +
        "WHERE role = 'episode' AND series_title IS NOT NULL AND duration_seconds IS NOT NULL " +
        "AND chronological_order IS NOT NULL " +
        "GROUP BY series_title " +
        "ORDER BY series_title COLLATE NOCASE"
    );
}

async function loadPositionedRotationRows(db: Database): Promise<PositionedSeriesRotationRow[]> {
    return db.all<Array<PositionedSeriesRotationRow>>(
        "SELECT position, series_title FROM series_rotation " +
        "WHERE channel_state_id = 1 ORDER BY position"
    );
}

function buildReconciledRotation(
    existingRotationRows: PositionedSeriesRotationRow[],
    schedulableSeriesRows: SchedulableSeriesRow[],
    random: () => number
): string[] {
    const schedulableTitles = new Set(
        schedulableSeriesRows.map((row) => row.series_title)
    );
    const preservedRotation = existingRotationRows
        .map((row) => row.series_title)
        .filter((seriesTitle) => schedulableTitles.has(seriesTitle));
    const preservedTitles = new Set(preservedRotation);
    const newSeriesTitles = schedulableSeriesRows
        .map((row) => row.series_title)
        .filter((seriesTitle) => !preservedTitles.has(seriesTitle));

    return preservedRotation.concat(shuffleSeries(newSeriesTitles, random));
}

function reconcileCurrentRotationIndex(
    state: ChannelStateRow,
    existingRotationRows: PositionedSeriesRotationRow[],
    reconciledRotation: string[]
): number {
    if (reconciledRotation.length === 0) {
        return 0;
    }

    const existingRotation = existingRotationRows.map((row) => row.series_title);
    const currentSeriesTitle = existingRotation[normalizeIndex(
        state.current_rotation_index,
        existingRotation.length
    )];
    if (currentSeriesTitle) {
        const reconciledCurrentIndex = reconciledRotation.indexOf(currentSeriesTitle);
        if (reconciledCurrentIndex >= 0) {
            return reconciledCurrentIndex;
        }
    }

    return normalizeIndex(state.current_rotation_index, reconciledRotation.length);
}

async function reconcileChannelState(
    db: Database,
    state: ChannelStateRow,
    random: () => number,
    now: Date
): Promise<ChannelStateRow> {
    return runExclusiveTransaction(db, async () => {
        const schedulableSeriesRows = await loadSchedulableSeriesRows(db);
        const episodeCountsBySeries = new Map(
            schedulableSeriesRows.map((row) => [row.series_title, row.episode_count])
        );
        const existingRotationRows = await loadPositionedRotationRows(db);
        const existingCursorRows = await loadCursorRows(db);
        const existingCursorsBySeries = new Map(
            existingCursorRows.map((row) => [row.series_title, row.episode_index])
        );
        const reconciledRotation = buildReconciledRotation(
            existingRotationRows,
            schedulableSeriesRows,
            random
        );
        const currentRotationIndex = reconcileCurrentRotationIndex(
            state,
            existingRotationRows,
            reconciledRotation
        );
        const bumpCount = await db.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM media_assets " +
            "WHERE role = 'bump' AND duration_seconds IS NOT NULL"
        );
        const bumpCursor = normalizeIndex(state.bump_cursor, bumpCount?.count || 0);
        const timestamp = now.toISOString();

        await db.run("DELETE FROM series_rotation WHERE channel_state_id = 1");
        for (let index = 0; index < reconciledRotation.length; index += 1) {
            await db.run(
                "INSERT INTO series_rotation (channel_state_id, position, series_title) VALUES (1, ?, ?)",
                index,
                reconciledRotation[index]
            );
        }

        await db.run("DELETE FROM episode_cursors WHERE channel_state_id = 1");
        for (const seriesTitle of reconciledRotation) {
            const existingEpisodeIndex = existingCursorsBySeries.get(seriesTitle);
            const episodeCount = episodeCountsBySeries.get(seriesTitle) || 0;
            const episodeIndex = existingEpisodeIndex === undefined
                ? clampRandomIndex(random, episodeCount)
                : normalizeIndex(existingEpisodeIndex, episodeCount);

            await db.run(
                "INSERT INTO episode_cursors (channel_state_id, series_title, episode_index) VALUES (1, ?, ?)",
                seriesTitle,
                episodeIndex
            );
        }

        await db.run(
            "UPDATE channel_state SET " +
            "current_rotation_index = ?, " +
            "bump_cursor = ?, " +
            "current_media_role = ?, " +
            "updated_at = ? " +
            "WHERE id = 1",
            currentRotationIndex,
            bumpCursor,
            state.current_media_role,
            timestamp
        );

        return {
            ...state,
            bump_cursor: bumpCursor,
            current_rotation_index: currentRotationIndex,
        };
    });
}

async function loadScheduleAssets(db: Database) {
    const episodes = await db.all<Array<MediaAssetRow>>(
        "SELECT id, role, file_path, series_title, title, duration_seconds, summary FROM media_assets " +
        "WHERE role = 'episode' AND series_title IS NOT NULL AND duration_seconds IS NOT NULL " +
        "AND chronological_order IS NOT NULL " +
        "ORDER BY series_title COLLATE NOCASE, chronological_order, sort_key COLLATE NOCASE, title COLLATE NOCASE"
    );
    const bumps = await db.all<Array<MediaAssetRow>>(
        "SELECT id, role, file_path, series_title, title, duration_seconds, summary FROM media_assets " +
        "WHERE role = 'bump' AND duration_seconds IS NOT NULL " +
        "ORDER BY sort_key COLLATE NOCASE, title COLLATE NOCASE"
    );
    return { episodes, bumps };
}

function toInternalMediaAsset(row: MediaAssetRow): InternalMediaAsset | null {
    if (!row.duration_seconds || row.duration_seconds <= 0) {
        return null;
    }

    return {
        id: row.id,
        durationSeconds: row.duration_seconds,
        filePath: row.file_path,
        role: row.role,
        seriesTitle: row.series_title,
        title: row.title,
    };
}

function buildChannelStateDiagnostic(
    state: ChannelStateRow,
    rotationRows: SeriesRotationRow[],
    cursorRows: EpisodeCursorRow[]
): InternalChannelStateDiagnostic {
    return {
        bumpCursor: state.bump_cursor,
        currentMediaRole: state.current_media_role,
        currentRotationIndex: state.current_rotation_index,
        episodeCursors: cursorRows.map((row) => ({
            episodeIndex: row.episode_index,
            seriesTitle: row.series_title,
        })),
        seriesRotation: rotationRows.map((row) => row.series_title),
    };
}

function buildDiagnostics(
    options: InternalScheduleOptions,
    scan: Awaited<ReturnType<typeof scanInternalLibrary>>,
    now: Date,
    state: ChannelStateRow | null = null,
    rotationRows: SeriesRotationRow[] = [],
    cursorRows: EpisodeCursorRow[] = []
): InternalScheduleDiagnostics {
    return {
        configured: true,
        bumpsRoot: options.bumpsRoot,
        channelState: state
            ? buildChannelStateDiagnostic(state, rotationRows, cursorRows)
            : null,
        lastError: null,
        lastScanAt: now.toISOString(),
        scannedBumpAssets: scan.assets.filter((asset) => asset.role === "bump").length,
        scannedEpisodeAssets: scan.assets.filter((asset) => asset.role === "episode").length,
        seriesAllowlist: options.seriesAllowlist || [],
        seriesRoot: options.seriesRoot,
        scannerDiagnostics: scan.diagnostics,
        unresolvedEpisodeAssets: scan.unresolvedEpisodeAssets,
        excludedSeries: scan.excludedSeries,
    };
}

function normalizeIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return ((index % length) + length) % length;
}

function groupEpisodesBySeries(episodes: MediaAssetRow[]) {
    const episodesBySeries = new Map<string, MediaAssetRow[]>();
    for (const episode of episodes) {
        if (!episode.series_title) {
            continue;
        }
        const list = episodesBySeries.get(episode.series_title) || [];
        list.push(episode);
        episodesBySeries.set(episode.series_title, list);
    }
    return episodesBySeries;
}

function createPlayoutCursor(
    state: ChannelStateRow,
    cursorRows: EpisodeCursorRow[]
): PlayoutCursor {
    return {
        bumpCursor: state.bump_cursor,
        currentMediaRole: state.current_media_role === "bump" ? "bump" : "episode",
        episodeCursorsBySeries: new Map(
            cursorRows.map((row) => [row.series_title, row.episode_index])
        ),
        rotationIndex: state.current_rotation_index,
    };
}

function resolveCurrentEpisode(
    cursor: PlayoutCursor,
    rotationRows: SeriesRotationRow[],
    episodesBySeries: Map<string, MediaAssetRow[]>
): MediaAssetRow | null {
    const rotationRow = rotationRows[normalizeIndex(cursor.rotationIndex, rotationRows.length)];
    const seriesTitle = rotationRow?.series_title;
    if (!seriesTitle) {
        return null;
    }

    const seriesEpisodes = episodesBySeries.get(seriesTitle) || [];
    if (seriesEpisodes.length === 0) {
        return null;
    }

    const episodeCursor = cursor.episodeCursorsBySeries.get(seriesTitle) || 0;
    return seriesEpisodes[normalizeIndex(episodeCursor, seriesEpisodes.length)] || null;
}

function resolveCurrentAsset(
    cursor: PlayoutCursor,
    rotationRows: SeriesRotationRow[],
    episodesBySeries: Map<string, MediaAssetRow[]>,
    bumps: MediaAssetRow[]
): MediaAssetRow | null {
    if (cursor.currentMediaRole === "bump" && bumps.length > 0) {
        return bumps[normalizeIndex(cursor.bumpCursor, bumps.length)] || null;
    }

    const episode = resolveCurrentEpisode(cursor, rotationRows, episodesBySeries);
    if (episode) {
        return episode;
    }

    if (bumps.length > 0) {
        return bumps[normalizeIndex(cursor.bumpCursor, bumps.length)] || null;
    }

    return null;
}

function advanceCurrentSeriesCursor(
    cursor: PlayoutCursor,
    rotationRows: SeriesRotationRow[],
    episodesBySeries: Map<string, MediaAssetRow[]>
) {
    const rotationRow = rotationRows[normalizeIndex(cursor.rotationIndex, rotationRows.length)];
    const seriesTitle = rotationRow?.series_title;
    if (seriesTitle) {
        const seriesEpisodes = episodesBySeries.get(seriesTitle) || [];
        if (seriesEpisodes.length > 0) {
            const episodeCursor = cursor.episodeCursorsBySeries.get(seriesTitle) || 0;
            cursor.episodeCursorsBySeries.set(
                seriesTitle,
                normalizeIndex(episodeCursor + 1, seriesEpisodes.length)
            );
        }
    }

    if (rotationRows.length > 0) {
        cursor.rotationIndex = normalizeIndex(cursor.rotationIndex + 1, rotationRows.length);
    }
}

function advancePlayoutCursor(
    cursor: PlayoutCursor,
    completedAsset: MediaAssetRow,
    rotationRows: SeriesRotationRow[],
    episodesBySeries: Map<string, MediaAssetRow[]>,
    bumps: MediaAssetRow[]
) {
    if (completedAsset.role === "episode" && bumps.length > 0) {
        cursor.currentMediaRole = "bump";
        return;
    }

    advanceCurrentSeriesCursor(cursor, rotationRows, episodesBySeries);
    if (completedAsset.role === "bump" && bumps.length > 0) {
        cursor.bumpCursor = normalizeIndex(cursor.bumpCursor + 1, bumps.length);
    }
    cursor.currentMediaRole = "episode";
}

async function loadRotationRows(db: Database) {
    return await db.all<Array<SeriesRotationRow>>(
        "SELECT series_title FROM series_rotation WHERE channel_state_id = 1 ORDER BY position"
    );
}

async function loadCursorRows(db: Database) {
    return await db.all<Array<EpisodeCursorRow>>(
        "SELECT series_title, episode_index FROM episode_cursors " +
        "WHERE channel_state_id = 1 ORDER BY series_title COLLATE NOCASE"
    );
}

export async function loadCurrentInternalMediaAsset(
    options: InternalScheduleOptions
): Promise<{ mediaAsset: InternalMediaAsset; diagnostics: InternalScheduleDiagnostics }> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const scan = await scanInternalLibrary(options);
    await persistMediaAssets(options.db, scan.assets, now, options.seriesRoot, options.bumpsRoot);
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const cursor = createPlayoutCursor(state, cursorRows);
    const currentAsset = resolveCurrentAsset(
        cursor,
        rotationRows,
        groupEpisodesBySeries(episodes),
        bumps
    );
    const mediaAsset = currentAsset ? toInternalMediaAsset(currentAsset) : null;

    if (mediaAsset) {
        return {
            diagnostics: buildDiagnostics(options, scan, now, state, rotationRows, cursorRows),
            mediaAsset,
        };
    }

    throw new Error("No current internal media asset is available");
}

export async function advanceInternalPlayoutOnCompletion(
    options: InternalScheduleOptions,
    completedMediaAsset: InternalMediaAsset
): Promise<boolean> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const scan = await scanInternalLibrary(options);
    await persistMediaAssets(options.db, scan.assets, now, options.seriesRoot, options.bumpsRoot);
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const episodesBySeries = groupEpisodesBySeries(episodes);
    const cursor = createPlayoutCursor(state, cursorRows);
    const currentAsset = resolveCurrentAsset(cursor, rotationRows, episodesBySeries, bumps);
    const currentMediaAsset = currentAsset ? toInternalMediaAsset(currentAsset) : null;

    if (!currentAsset || !currentMediaAsset || currentMediaAsset.id !== completedMediaAsset.id) {
        return false;
    }

    advancePlayoutCursor(cursor, currentAsset, rotationRows, episodesBySeries, bumps);

    await runExclusiveTransaction(options.db, async () => {
        await options.db.run(
            "UPDATE channel_state SET " +
            "current_rotation_index = ?, " +
            "bump_cursor = ?, " +
            "current_media_role = ?, " +
            "updated_at = ? " +
            "WHERE id = 1",
            cursor.rotationIndex,
            cursor.bumpCursor,
            cursor.currentMediaRole,
            now.toISOString()
        );

        for (const [seriesTitle, episodeIndex] of cursor.episodeCursorsBySeries) {
            await options.db.run(
                "UPDATE episode_cursors SET episode_index = ? " +
                "WHERE channel_state_id = 1 AND series_title = ?",
                episodeIndex,
                seriesTitle
            );
        }
    });

    return true;
}

export async function loadInternalSchedulePayload(
    options: InternalScheduleOptions
): Promise<{ payload: SchedulePayload; diagnostics: InternalScheduleDiagnostics }> {
    const now = options.now ? options.now() : new Date();
    const random = options.random || Math.random;
    const scan = await scanInternalLibrary(options);
    await persistMediaAssets(options.db, scan.assets, now, options.seriesRoot, options.bumpsRoot);
    const state = await ensureChannelState(options.db, random, now);
    const { episodes, bumps } = await loadScheduleAssets(options.db);
    const rotationRows = await loadRotationRows(options.db);
    const cursorRows = await loadCursorRows(options.db);
    const episodesBySeries = groupEpisodesBySeries(episodes);
    const cursor = createPlayoutCursor(state, cursorRows);
    const schedule = [];
    let cursorTime = now;

    while (schedule.length < 25) {
        const asset = resolveCurrentAsset(cursor, rotationRows, episodesBySeries, bumps);
        if (!asset) {
            break;
        }

        const stopAt = addSeconds(cursorTime, asset.duration_seconds || 0);
        schedule.push({
            ...(asset.summary ? { description: asset.summary } : {}),
            ...(asset.role === "episode" ? { episode: asset.title } : {}),
            live: schedule.length === 0,
            startAt: cursorTime.toISOString(),
            stopAt: stopAt.toISOString(),
            ...(schedule.length === 0 ? { time: "live" } : {}),
            title: asset.role === "episode" && asset.series_title ? asset.series_title : asset.title,
        });
        cursorTime = stopAt;
        advancePlayoutCursor(cursor, asset, rotationRows, episodesBySeries, bumps);
    }

    return {
        diagnostics: buildDiagnostics(options, scan, now, state, rotationRows, cursorRows),
        payload: {
            fetchedAt: now.toISOString(),
            refreshAfterMs: computeScheduleRefreshDelay(now, {
                stop: schedule[0]?.stopAt ? new Date(schedule[0].stopAt) : undefined,
            }),
            schedule,
        },
    };
}
