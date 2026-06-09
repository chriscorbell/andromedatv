import path from "path";
import type {
    SidecarOverride,
    SidecarOverrideEpisode,
    SidecarOverrideSeries,
} from "./sidecar-override";

export type MetadataAuthoritySource = "anidb" | "filename" | "sidecar";

export type MetadataAuthoritySeries = {
    anidbSeriesId: number;
    title: string;
    sortTitle: string | null;
};

export type MetadataAuthorityEpisode = {
    anidbEpisodeId: number;
    anidbSeriesId: number;
    episodeNumber: string;
    title: string;
    summary: string | null;
    airDate: string | null;
    chronologicalOrder: number;
};

export type MetadataAuthorityCache = {
    seriesById: Map<number, MetadataAuthoritySeries>;
    seriesByLookupKey: Map<string, MetadataAuthoritySeries>;
    episodesById: Map<number, MetadataAuthorityEpisode>;
    episodesBySeriesAndNumber: Map<number, Map<string, MetadataAuthorityEpisode>>;
};

export type MetadataAuthoritySidecarSeries = SidecarOverrideSeries;

export type MetadataAuthoritySidecarEpisode = SidecarOverrideEpisode;

export type MetadataAuthoritySidecar = SidecarOverride;

export type ResolveMetadataAuthorityInput = {
    folderTitle: string;
    fileName: string;
    relativePath: string;
    episodeIndex: number;
    sidecar: MetadataAuthoritySidecar | null;
    cache: MetadataAuthorityCache;
    filenameFallbackAllowed: boolean;
};

export type ResolvedMetadataAuthority = {
    anidbEpisodeId?: number | null;
    anidbSeriesId?: number | null;
    airDate?: string | null;
    chronologicalOrder: number;
    episodeNumber?: string | null;
    metadataSource: MetadataAuthoritySource;
    seriesTitle: string;
    summary?: string | null;
    title: string;
};

export type UnresolvedMetadataAuthority = {
    reason: string;
    seriesTitle: string;
};

export function normalizeMetadataLookupKey(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function normalizeEpisodeNumber(value: string): string {
    const normalized = value.trim().toLocaleLowerCase();
    return normalized.replace(/^0+(?=\d)/, "");
}

function getMediaTitle(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
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

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function resolveCachedSeries(
    folderTitle: string,
    sidecar: MetadataAuthoritySidecar | null,
    cache: MetadataAuthorityCache
): MetadataAuthoritySeries | null {
    const sidecarSeriesId = sidecar?.series?.anidbSeriesId;
    if (sidecarSeriesId !== undefined) {
        return cache.seriesById.get(sidecarSeriesId) || null;
    }
    return cache.seriesByLookupKey.get(normalizeMetadataLookupKey(folderTitle)) || null;
}

function findCachedEpisode(
    cache: MetadataAuthorityCache,
    cachedSeries: MetadataAuthoritySeries | null,
    sidecarEpisode: MetadataAuthoritySidecarEpisode | undefined,
    parsedEpisodeNumber: string | null
): MetadataAuthorityEpisode | null {
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

    const episodeMap = cache.episodesBySeriesAndNumber.get(cachedSeries.anidbSeriesId);
    return episodeMap?.get(normalizeEpisodeNumber(episodeNumber)) || null;
}

export function resolveMetadataAuthoritySeriesTitle({
    cache,
    folderTitle,
    sidecar,
}: {
    cache: MetadataAuthorityCache;
    folderTitle: string;
    sidecar: MetadataAuthoritySidecar | null;
}): string {
    const cachedSeries = resolveCachedSeries(folderTitle, sidecar, cache);
    return sidecar?.series?.title || cachedSeries?.title || folderTitle;
}

export function resolveMetadataAuthority(
    input: ResolveMetadataAuthorityInput
): ResolvedMetadataAuthority | UnresolvedMetadataAuthority {
    const sidecarEpisode = input.sidecar?.episodesByPath.get(input.relativePath);
    const parsedEpisodeNumber = sidecarEpisode?.episodeNumber ||
        parseEpisodeNumberFromFileName(input.fileName);
    const cachedSeries = resolveCachedSeries(input.folderTitle, input.sidecar, input.cache);
    const cachedEpisode = findCachedEpisode(
        input.cache,
        cachedSeries,
        sidecarEpisode,
        parsedEpisodeNumber
    );
    const seriesTitle = input.sidecar?.series?.title || cachedSeries?.title || input.folderTitle;

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
        cachedEpisode?.chronologicalOrder ??
        (input.filenameFallbackAllowed ? input.episodeIndex + 1 : undefined);

    if (!isFiniteNumber(chronologicalOrder)) {
        return {
            reason: "no trusted chronological episode order",
            seriesTitle,
        };
    }

    const metadataSource: MetadataAuthoritySource = sidecarEpisode
        ? "sidecar"
        : cachedEpisode || cachedSeries
            ? "anidb"
            : "filename";

    return {
        airDate: sidecarEpisode?.airDate ?? cachedEpisode?.airDate ?? null,
        anidbEpisodeId: sidecarEpisode?.anidbEpisodeId ?? cachedEpisode?.anidbEpisodeId ?? null,
        anidbSeriesId: input.sidecar?.series?.anidbSeriesId ?? cachedSeries?.anidbSeriesId ?? null,
        chronologicalOrder,
        episodeNumber: sidecarEpisode?.episodeNumber ?? cachedEpisode?.episodeNumber ?? parsedEpisodeNumber ?? null,
        metadataSource,
        seriesTitle,
        summary: sidecarEpisode?.summary ?? cachedEpisode?.summary ?? null,
        title: sidecarEpisode?.title ?? cachedEpisode?.title ?? getMediaTitle(input.fileName),
    };
}
