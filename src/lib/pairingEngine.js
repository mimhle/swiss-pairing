import { buildTournamentTrf, generatePairings as engineGeneratePairings } from './pairingEngineWrapper';

function getPlayerId(player) {
    return String(player?.playerUniqueId ?? player?.id ?? "");
}

function getForfeitedPlayerIds(rounds = []) {
    const forfeitedIds = new Set();

    rounds.forEach((round) => {
        [
            ...(round.returnedForfeitPlayerIds || []),
            ...(round.options?.returnedForfeitPlayerIds || []),
        ].forEach((playerId) => forfeitedIds.delete(String(playerId)));
        round.pairings?.forEach((pairing) => {
            if (pairing.isTournamentForfeit && pairing.whiteId) forfeitedIds.add(String(pairing.whiteId));
        });
    });

    return forfeitedIds;
}

/**
 * Pairs players for a round.
 * 
 * @param {Array} players - List of player objects.
 * @param {Object} options - Pairing options (starting color, protection, etc.)
 * @param {Array} previousRounds - List of previous round data for Swiss consistency.
 * @param {Object} tournamentConfig - Tournament configuration.
 * @param {string} tournamentName - Tournament name.
 * @param {Function} onProgress - Callback for loading progress.
 * @returns {Promise<Array>} - List of pairings: [{ whiteId, blackId, isBye }, ...]
 */
export async function generatePairings(players, options = {}, previousRounds = [], tournamentConfig = {}, tournamentName = "Tournament", onProgress = null) {
    const forfeitedIds = getForfeitedPlayerIds(previousRounds);
    const excludedPlayerIds = new Set([
        ...forfeitedIds,
        ...(options.excludedPlayerIds || []).map(String),
    ]);

    console.log("[Pairing] Generating pairings. Players:", (players || []).length - excludedPlayerIds.size, "Round:", previousRounds.length + 1);

    if (onProgress) onProgress(50);

    const pairings = await engineGeneratePairings(
        players,
        { ...options, totalRounds: tournamentConfig?.numRounds, excludedPlayerIds: [...excludedPlayerIds] },
        previousRounds
    );

    if (onProgress) onProgress(100);

    return pairings;
}

export function exportTournamentTrf(players, rounds = [], tournamentConfig = {}, tournamentName = "Tournament") {
    return buildTournamentTrf(players, rounds, {
        ...tournamentConfig,
        totalRounds: tournamentConfig?.numRounds,
        tournamentName,
    });
}
