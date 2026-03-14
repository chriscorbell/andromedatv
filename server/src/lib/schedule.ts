import { XMLParser } from "fast-xml-parser";

export type ScheduleItem = {
    title: string;
    episode?: string;
    time?: string;
    description?: string;
    live?: boolean;
};

export type SchedulePayload = {
    fetchedAt: string;
    refreshAfterMs: number;
    schedule: ScheduleItem[];
};

type NormalizedProgram = {
    description?: string;
    episode?: string;
    start?: Date;
    stop?: Date;
    title: string;
};

type XmltvDocument = {
    tv?: {
        channel?: ParsedChannel | ParsedChannel[];
        programme?: ParsedProgramme | ParsedProgramme[];
    };
};

type ParsedChannel = {
    id?: string;
    "display-name"?: ParsedTextNode | ParsedTextNode[];
};

type ParsedProgramme = {
    channel?: string;
    start?: string;
    stop?: string;
    title?: ParsedTextNode;
    desc?: ParsedTextNode;
    "sub-title"?: ParsedTextNode;
    "episode-num"?: ParsedEpisodeNode | ParsedEpisodeNode[];
};

type ParsedEpisodeNode = {
    "#text"?: string;
    system?: string;
};

type ParsedTextNode =
    | string
    | {
        "#text"?: string;
    };

const xmlParser = new XMLParser({
    attributeNamePrefix: "",
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    processEntities: false,
    trimValues: false,
});

export function decodeXmlEntities(value: string): string {
    return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
        const normalized = String(entity).toLowerCase();
        if (normalized === "amp") {
            return "&";
        }
        if (normalized === "lt") {
            return "<";
        }
        if (normalized === "gt") {
            return ">";
        }
        if (normalized === "quot") {
            return "\"";
        }
        if (normalized === "apos") {
            return "'";
        }
        if (normalized.startsWith("#x")) {
            const codePoint = Number.parseInt(normalized.slice(2), 16);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        if (normalized.startsWith("#")) {
            const codePoint = Number.parseInt(normalized.slice(1), 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        return match;
    });
}

export function stripXmlMarkup(value: string): string {
    let normalized = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

    for (let index = 0; index < 3; index += 1) {
        const decoded = decodeXmlEntities(normalized);
        normalized = decoded
            .replace(/<br\s*\/?\s*>/gi, "\n")
            .replace(/<[^>]+>/g, "");
    }

    return normalized
        .replace(/\s+\n/g, "\n")
        .replace(/\n?\s*Source:\s*[^\n]+\s*$/i, "")
        .trim();
}

function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function getNodeText(node: ParsedTextNode | ParsedEpisodeNode | undefined): string | undefined {
    if (typeof node === "string") {
        const text = stripXmlMarkup(node);
        return text || undefined;
    }

    if (!node || typeof node !== "object") {
        return undefined;
    }

    const rawText = typeof node["#text"] === "string" ? node["#text"] : "";
    const text = stripXmlMarkup(rawText);
    return text || undefined;
}

function getChannelDisplayNames(channel: ParsedChannel): string[] {
    return toArray(channel["display-name"])
        .map((name) => getNodeText(name))
        .filter((name): name is string => Boolean(name));
}

export function getEpisodePrefix(node: ParsedEpisodeNode | ParsedEpisodeNode[] | undefined): string | undefined {
    const episodeNode = toArray(node)[0];
    if (!episodeNode) {
        return undefined;
    }

    const system = episodeNode.system || "xmltv_ns";
    const raw = getNodeText(episodeNode);
    if (!raw) {
        return undefined;
    }

    if (system === "xmltv_ns") {
        const [seasonRaw, episodeRaw] = raw.split(".");
        const seasonIndex = Number(seasonRaw);
        const episodeIndex = Number(episodeRaw);
        if (Number.isFinite(seasonIndex) && Number.isFinite(episodeIndex)) {
            const season = String(seasonIndex + 1).padStart(2, "0");
            const episode = String(episodeIndex + 1).padStart(2, "0");
            return `S${season}E${episode}`;
        }
    }

    const seasonEpisodeMatch = raw.match(/S(\d+)E(\d+)/i);
    if (seasonEpisodeMatch) {
        const season = String(Number(seasonEpisodeMatch[1])).padStart(2, "0");
        const episode = String(Number(seasonEpisodeMatch[2])).padStart(2, "0");
        return `S${season}E${episode}`;
    }

    return undefined;
}

export function parseXmltvDate(value?: string): Date | null {
    if (!value) {
        return null;
    }

    const [stamp, offset = ""] = value.trim().split(" ");
    if (!stamp || stamp.length < 14) {
        return null;
    }

    const year = Number(stamp.slice(0, 4));
    const month = Number(stamp.slice(4, 6)) - 1;
    const day = Number(stamp.slice(6, 8));
    const hour = Number(stamp.slice(8, 10));
    const minute = Number(stamp.slice(10, 12));
    const second = Number(stamp.slice(12, 14));

    let dateUtc = Date.UTC(year, month, day, hour, minute, second);

    if (offset && /^[+-]\d{4}$/.test(offset)) {
        const sign = offset.startsWith("-") ? -1 : 1;
        const offsetHours = Number(offset.slice(1, 3));
        const offsetMinutes = Number(offset.slice(3, 5));
        const totalMinutes = sign * (offsetHours * 60 + offsetMinutes);
        dateUtc -= totalMinutes * 60_000;
    }

    return new Date(dateUtc);
}

export function formatTimeRange(start?: Date, stop?: Date): string | undefined {
    if (!start || !stop) {
        return undefined;
    }

    const options: Intl.DateTimeFormatOptions = {
        hour: "numeric",
        minute: "2-digit",
    };
    const startLabel = start.toLocaleTimeString([], options);
    const stopLabel = stop.toLocaleTimeString([], options);
    return `${startLabel} - ${stopLabel}`;
}

export function computeScheduleRefreshDelay(now: Date, currentItem?: { stop?: Date }) {
    if (!currentItem?.stop) {
        return 60_000;
    }

    const millisecondsUntilBoundary = currentItem.stop.getTime() - now.getTime() + 1_000;
    if (!Number.isFinite(millisecondsUntilBoundary) || millisecondsUntilBoundary <= 0) {
        return 15_000;
    }

    return Math.min(Math.max(millisecondsUntilBoundary, 15_000), 5 * 60_000);
}

function pickPreferredChannel(channels: ParsedChannel[]): ParsedChannel | undefined {
    return channels.find((channel) => {
        const names = getChannelDisplayNames(channel).map((name) => name.trim().toLowerCase());
        return (
            names.includes("1") ||
            names.includes("1 andromeda") ||
            names.includes("andromeda")
        );
    });
}

function normalizeProgramme(programme: ParsedProgramme): NormalizedProgram | null {
    const title = getNodeText(programme.title);
    if (!title) {
        return null;
    }

    const episodeTitle = getNodeText(programme["sub-title"]);
    const episodePrefix = getEpisodePrefix(programme["episode-num"]);
    const episode = episodeTitle
        ? `${episodePrefix ? `${episodePrefix} ` : ""}${episodeTitle}`
        : episodePrefix;
    const description = getNodeText(programme.desc);
    const start = parseXmltvDate(programme.start);
    const stop = parseXmltvDate(programme.stop);

    return {
        description,
        episode,
        start: start || undefined,
        stop: stop || undefined,
        title,
    };
}

export function normalizeScheduleXml(xmlText: string, now = new Date()): SchedulePayload {
    const parsed = xmlParser.parse(xmlText) as XmltvDocument;
    const channels = toArray(parsed.tv?.channel);
    const preferredChannel = pickPreferredChannel(channels);
    const channelId = preferredChannel?.id;

    const allProgrammes = toArray(parsed.tv?.programme);
    const programmes = channelId
        ? allProgrammes.filter((programme) => programme.channel === channelId)
        : allProgrammes;

    const normalizedPrograms = programmes
        .map((programme) => normalizeProgramme(programme))
        .filter((item): item is NormalizedProgram => item !== null)
        .sort((a, b) => (a.start?.getTime() || 0) - (b.start?.getTime() || 0));

    const currentIndex = normalizedPrograms.findIndex(
        (item) =>
            item.start && item.stop && item.start <= now && now < item.stop
    );
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const slicedPrograms = normalizedPrograms.slice(startIndex, startIndex + 25);

    const schedule = slicedPrograms.map((item, index): ScheduleItem => {
        const live = index === 0 && currentIndex >= 0;
        return {
            ...(item.description ? { description: item.description } : {}),
            ...(item.episode ? { episode: item.episode } : {}),
            live,
            time: live ? "live" : formatTimeRange(item.start, item.stop),
            title: item.title,
        };
    });

    return {
        fetchedAt: now.toISOString(),
        refreshAfterMs: computeScheduleRefreshDelay(now, slicedPrograms[0]),
        schedule,
    };
}
