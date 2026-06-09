import path from "path";

export const SIDECAR_FILE_NAME = "andromeda.sidecar.json";

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

export type SidecarOverrideSeries = {
    title?: string;
    sortTitle?: string;
    anidbSeriesId?: number;
    synonyms?: string[];
};

export type SidecarOverrideEpisode = {
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

export type SidecarOverride = {
    series?: SidecarOverrideSeries;
    episodesByPath: Map<string, SidecarOverrideEpisode>;
};

export type SidecarOverrideParseResult = {
    sidecar: SidecarOverride | null;
    diagnostics: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getUnknownFields(value: Record<string, unknown>, allowedFields: Set<string>) {
    return Object.keys(value).filter((field) => !allowedFields.has(field));
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

function parseSidecarSeries(
    value: unknown,
    diagnostics: string[]
): SidecarOverrideSeries | undefined {
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
): SidecarOverrideEpisode | null {
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

export function parseSidecarOverride(
    rawSidecar: string,
    sidecarPath = SIDECAR_FILE_NAME
): SidecarOverrideParseResult {
    const diagnostics: string[] = [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawSidecar);
    } catch (error) {
        diagnostics.push(
            `Invalid Sidecar Override ${sidecarPath}: ${error instanceof Error ? error.message : String(error)}`
        );
        return { diagnostics, sidecar: null };
    }

    if (!isRecord(parsed)) {
        diagnostics.push(`Invalid Sidecar Override ${sidecarPath}: expected a JSON object`);
        return { diagnostics, sidecar: null };
    }

    for (const field of getUnknownFields(parsed, SIDECAR_ROOT_FIELDS)) {
        diagnostics.push(`Unknown Sidecar Override field ${field}`);
    }

    if (parsed.sidecarVersion !== 1) {
        diagnostics.push(`Invalid Sidecar Override ${sidecarPath}: sidecarVersion must be 1`);
        return { diagnostics, sidecar: null };
    }

    const episodesByPath = new Map<string, SidecarOverrideEpisode>();
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

    const series = parseSidecarSeries(parsed.series, diagnostics);

    return {
        diagnostics,
        sidecar: {
            episodesByPath,
            series,
        },
    };
}
