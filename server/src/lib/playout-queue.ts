export type PlayoutQueueMediaRole = "episode" | "bump";

export type PlayoutQueueAsset = {
    id: number;
    role: PlayoutQueueMediaRole;
    filePath: string;
    seriesTitle: string | null;
    title: string;
    durationSeconds: number;
    summary?: string | null;
};

export type PlayoutQueueEpisodeCursor = {
    seriesTitle: string;
    episodeIndex: number;
};

export type PlayoutQueueChannelState = {
    currentRotationIndex: number;
    bumpCursor: number;
    currentMediaRole: PlayoutQueueMediaRole;
    episodeCursors: PlayoutQueueEpisodeCursor[];
};

export type PlayoutQueueSnapshot = {
    state: PlayoutQueueChannelState;
    seriesRotation: string[];
    episodeAssets: PlayoutQueueAsset[];
    bumpAssets: PlayoutQueueAsset[];
};

export type PlayoutQueueStep = {
    asset: PlayoutQueueAsset;
    index: number;
    startAt: Date;
    stopAt: Date;
};

export type PlayoutQueueAdvanceResult = {
    advanced: boolean;
    state: PlayoutQueueChannelState;
};

export type PreviewPlayoutQueueOptions = {
    maxSteps: number;
    startAt: Date;
};

function normalizeIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return ((index % length) + length) % length;
}

function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
}

function cloneState(state: PlayoutQueueChannelState): PlayoutQueueChannelState {
    return {
        bumpCursor: state.bumpCursor,
        currentMediaRole: state.currentMediaRole,
        currentRotationIndex: state.currentRotationIndex,
        episodeCursors: state.episodeCursors.map((cursor) => ({ ...cursor })),
    };
}

function groupEpisodesBySeries(episodes: PlayoutQueueAsset[]) {
    const episodesBySeries = new Map<string, PlayoutQueueAsset[]>();
    for (const episode of episodes) {
        if (episode.role !== "episode" || !episode.seriesTitle) {
            continue;
        }
        const list = episodesBySeries.get(episode.seriesTitle) || [];
        list.push(episode);
        episodesBySeries.set(episode.seriesTitle, list);
    }
    return episodesBySeries;
}

function getEpisodeCursor(state: PlayoutQueueChannelState, seriesTitle: string): number {
    return state.episodeCursors.find((cursor) => cursor.seriesTitle === seriesTitle)?.episodeIndex || 0;
}

function setEpisodeCursor(
    state: PlayoutQueueChannelState,
    seriesTitle: string,
    episodeIndex: number
) {
    const existingCursor = state.episodeCursors.find((cursor) => cursor.seriesTitle === seriesTitle);
    if (existingCursor) {
        existingCursor.episodeIndex = episodeIndex;
        return;
    }

    state.episodeCursors.push({ episodeIndex, seriesTitle });
}

function resolveCurrentEpisode(
    state: PlayoutQueueChannelState,
    seriesRotation: string[],
    episodesBySeries: Map<string, PlayoutQueueAsset[]>
): PlayoutQueueAsset | null {
    const seriesTitle = seriesRotation[normalizeIndex(
        state.currentRotationIndex,
        seriesRotation.length
    )];
    if (!seriesTitle) {
        return null;
    }

    const seriesEpisodes = episodesBySeries.get(seriesTitle) || [];
    if (seriesEpisodes.length === 0) {
        return null;
    }

    return seriesEpisodes[normalizeIndex(
        getEpisodeCursor(state, seriesTitle),
        seriesEpisodes.length
    )] || null;
}

function resolveCurrentAsset(
    snapshot: PlayoutQueueSnapshot,
    state: PlayoutQueueChannelState
): PlayoutQueueAsset | null {
    if (state.currentMediaRole === "bump" && snapshot.bumpAssets.length > 0) {
        return snapshot.bumpAssets[normalizeIndex(state.bumpCursor, snapshot.bumpAssets.length)] || null;
    }

    const episode = resolveCurrentEpisode(
        state,
        snapshot.seriesRotation,
        groupEpisodesBySeries(snapshot.episodeAssets)
    );
    if (episode) {
        return episode;
    }

    if (snapshot.bumpAssets.length > 0) {
        return snapshot.bumpAssets[normalizeIndex(state.bumpCursor, snapshot.bumpAssets.length)] || null;
    }

    return null;
}

function advanceCurrentSeriesCursor(
    state: PlayoutQueueChannelState,
    seriesRotation: string[],
    episodesBySeries: Map<string, PlayoutQueueAsset[]>
) {
    const seriesTitle = seriesRotation[normalizeIndex(
        state.currentRotationIndex,
        seriesRotation.length
    )];
    if (seriesTitle) {
        const seriesEpisodes = episodesBySeries.get(seriesTitle) || [];
        if (seriesEpisodes.length > 0) {
            setEpisodeCursor(
                state,
                seriesTitle,
                normalizeIndex(getEpisodeCursor(state, seriesTitle) + 1, seriesEpisodes.length)
            );
        }
    }

    if (seriesRotation.length > 0) {
        state.currentRotationIndex = normalizeIndex(
            state.currentRotationIndex + 1,
            seriesRotation.length
        );
    }
}

function advanceCurrentAsset(
    snapshot: PlayoutQueueSnapshot,
    state: PlayoutQueueChannelState,
    completedAsset: PlayoutQueueAsset
) {
    const episodesBySeries = groupEpisodesBySeries(snapshot.episodeAssets);
    if (completedAsset.role === "episode" && snapshot.bumpAssets.length > 0) {
        state.currentMediaRole = "bump";
        return;
    }

    advanceCurrentSeriesCursor(state, snapshot.seriesRotation, episodesBySeries);
    if (completedAsset.role === "bump" && snapshot.bumpAssets.length > 0) {
        state.bumpCursor = normalizeIndex(state.bumpCursor + 1, snapshot.bumpAssets.length);
    }
    state.currentMediaRole = "episode";
}

export function getCurrentPlayoutQueueItem(snapshot: PlayoutQueueSnapshot): PlayoutQueueAsset | null {
    return resolveCurrentAsset(snapshot, cloneState(snapshot.state));
}

export function advancePlayoutQueue(
    snapshot: PlayoutQueueSnapshot,
    completedMediaAssetId: number
): PlayoutQueueAdvanceResult {
    const nextState = cloneState(snapshot.state);
    const currentAsset = resolveCurrentAsset(snapshot, nextState);
    if (!currentAsset || currentAsset.id !== completedMediaAssetId) {
        return {
            advanced: false,
            state: nextState,
        };
    }

    advanceCurrentAsset(snapshot, nextState, currentAsset);
    return {
        advanced: true,
        state: nextState,
    };
}

export function previewPlayoutQueue(
    snapshot: PlayoutQueueSnapshot,
    { maxSteps, startAt }: PreviewPlayoutQueueOptions
): PlayoutQueueStep[] {
    const steps: PlayoutQueueStep[] = [];
    const previewState = cloneState(snapshot.state);
    let cursorTime = new Date(startAt.getTime());

    for (let index = 0; index < maxSteps; index += 1) {
        const asset = resolveCurrentAsset(snapshot, previewState);
        if (!asset) {
            break;
        }

        const stopAt = addSeconds(cursorTime, asset.durationSeconds);
        steps.push({
            asset,
            index,
            startAt: cursorTime,
            stopAt,
        });
        advanceCurrentAsset(snapshot, previewState, asset);
        cursorTime = stopAt;
    }

    return steps;
}
