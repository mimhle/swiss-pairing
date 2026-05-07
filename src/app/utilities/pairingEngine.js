import { generatePairings as engineGeneratePairings } from './pairingEngineWrapper';

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
    console.log("[Pairing] Generating pairings. Players:", players.length, "Round:", previousRounds.length + 1);

    if (onProgress) onProgress(50);

    const pairings = await engineGeneratePairings(
        players,
        { ...options, totalRounds: tournamentConfig?.numRounds },
        previousRounds
    );

    if (onProgress) onProgress(100);

    return pairings;
}
