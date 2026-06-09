export type LibraryReconciliationMediaRole = "episode" | "bump";

export type LibraryReconciliationPreviousState = {
    currentRotationIndex: number;
    bumpCursor: number;
    currentMediaRole: LibraryReconciliationMediaRole;
};

export type LibraryReconciliationEpisodeCursor = {
    seriesTitle: string;
    episodeIndex: number;
    mediaFilePath: string | null;
};

export type LibraryReconciliationEpisodeTarget = {
    seriesTitle: string;
    filePath: string;
};

export type LibraryReconciliationInput = {
    previousState: LibraryReconciliationPreviousState;
    existingSeriesRotation: string[];
    existingEpisodeCursors: LibraryReconciliationEpisodeCursor[];
    schedulableSeries: string[];
    episodeTargets: LibraryReconciliationEpisodeTarget[];
    bumpCount: number;
    random: () => number;
};

export type LibraryReconciliationResult = LibraryReconciliationPreviousState & {
    seriesRotation: string[];
    episodeCursors: LibraryReconciliationEpisodeCursor[];
};

function normalizeIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return ((index % length) + length) % length;
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

function groupEpisodeTargetsBySeries(targets: LibraryReconciliationEpisodeTarget[]) {
    const targetsBySeries = new Map<string, LibraryReconciliationEpisodeTarget[]>();
    for (const target of targets) {
        const list = targetsBySeries.get(target.seriesTitle) || [];
        list.push(target);
        targetsBySeries.set(target.seriesTitle, list);
    }
    return targetsBySeries;
}

function buildReconciledRotation(
    existingSeriesRotation: string[],
    schedulableSeries: string[],
    random: () => number
): string[] {
    const schedulableTitles = new Set(schedulableSeries);
    const preservedRotation = existingSeriesRotation
        .filter((seriesTitle) => schedulableTitles.has(seriesTitle));
    const preservedTitles = new Set(preservedRotation);
    const newSeriesTitles = schedulableSeries
        .filter((seriesTitle) => !preservedTitles.has(seriesTitle));

    return preservedRotation.concat(shuffleSeries(newSeriesTitles, random));
}

function reconcileCurrentRotationIndex(
    previousState: LibraryReconciliationPreviousState,
    existingSeriesRotation: string[],
    reconciledRotation: string[]
): number {
    if (reconciledRotation.length === 0) {
        return 0;
    }

    const currentSeriesTitle = existingSeriesRotation[normalizeIndex(
        previousState.currentRotationIndex,
        existingSeriesRotation.length
    )];
    if (currentSeriesTitle) {
        const reconciledCurrentIndex = reconciledRotation.indexOf(currentSeriesTitle);
        if (reconciledCurrentIndex >= 0) {
            return reconciledCurrentIndex;
        }
    }

    return normalizeIndex(previousState.currentRotationIndex, reconciledRotation.length);
}

function reconcileEpisodeCursor(
    seriesTitle: string,
    existingCursor: LibraryReconciliationEpisodeCursor | undefined,
    episodeTargets: LibraryReconciliationEpisodeTarget[],
    random: () => number
): LibraryReconciliationEpisodeCursor {
    if (episodeTargets.length === 0) {
        return {
            episodeIndex: 0,
            mediaFilePath: null,
            seriesTitle,
        };
    }

    let episodeIndex: number;
    if (!existingCursor) {
        episodeIndex = clampRandomIndex(random, episodeTargets.length);
    } else if (existingCursor.mediaFilePath) {
        const existingAssetIndex = episodeTargets.findIndex(
            (target) => target.filePath === existingCursor.mediaFilePath
        );
        episodeIndex = existingAssetIndex >= 0
            ? existingAssetIndex
            : normalizeIndex(existingCursor.episodeIndex, episodeTargets.length);
    } else {
        episodeIndex = normalizeIndex(existingCursor.episodeIndex, episodeTargets.length);
    }

    return {
        episodeIndex,
        mediaFilePath: episodeTargets[episodeIndex]?.filePath || null,
        seriesTitle,
    };
}

export function reconcileLibrary(input: LibraryReconciliationInput): LibraryReconciliationResult {
    const seriesRotation = buildReconciledRotation(
        input.existingSeriesRotation,
        input.schedulableSeries,
        input.random
    );
    const currentRotationIndex = reconcileCurrentRotationIndex(
        input.previousState,
        input.existingSeriesRotation,
        seriesRotation
    );
    const existingCursorsBySeries = new Map(
        input.existingEpisodeCursors.map((cursor) => [cursor.seriesTitle, cursor])
    );
    const targetsBySeries = groupEpisodeTargetsBySeries(input.episodeTargets);
    const episodeCursors = seriesRotation.map((seriesTitle) => reconcileEpisodeCursor(
        seriesTitle,
        existingCursorsBySeries.get(seriesTitle),
        targetsBySeries.get(seriesTitle) || [],
        input.random
    ));

    return {
        bumpCursor: normalizeIndex(input.previousState.bumpCursor, input.bumpCount),
        currentMediaRole: input.previousState.currentMediaRole,
        currentRotationIndex,
        episodeCursors,
        seriesRotation,
    };
}
