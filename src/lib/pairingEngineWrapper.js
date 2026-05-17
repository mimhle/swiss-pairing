/**
 * Pairing Engine Wrapper
 *
 * Runs the bundled bbpPairings WASM build through its command-line interface.
 */

let bbPairingsModuleFactory = null;
let bbPairingsWasmBinary = null;
let bbPairingsReady = false;

const INPUT_FILE = "/tournament.trf";
const OUTPUT_FILE = "/pairings.txt";

function isBrowser() {
    return typeof window !== "undefined" && typeof fetch !== "undefined";
}

/**
 * Initialize bbpPairings WASM module assets.
 *
 * @param {Function} onProgress - Callback for loading progress (0-100)
 */
export async function initPairingEngine(onProgress = null) {
    console.log("[Pairing Engine] Initializing bbpPairings...");

    if (bbPairingsReady) {
        if (onProgress) onProgress(100);
        return;
    }

    if (!isBrowser()) {
        throw new Error("bbpPairings can only run in the browser");
    }

    try {
        if (onProgress) onProgress(20);

        const moduleImport = await import(/* webpackIgnore: true */ "/bbpPairings/bbpPairings.js");
        bbPairingsModuleFactory = moduleImport.default;

        if (onProgress) onProgress(60);

        const wasmResponse = await fetch("/bbpPairings/bbpPairings.wasm");
        if (!wasmResponse.ok) {
            throw new Error(`Unable to load bbpPairings.wasm (${wasmResponse.status})`);
        }
        bbPairingsWasmBinary = await wasmResponse.arrayBuffer();

        bbPairingsReady = true;
        if (onProgress) onProgress(100);
        console.log("[Pairing Engine] bbpPairings ready");
    } catch (error) {
        console.error("[Pairing Engine] Initialization failed:", error);
        throw error;
    }
}

async function createBbpInstance() {
    const stdout = [];
    const stderr = [];
    const bbpRuntime = await bbPairingsModuleFactory({
        noInitialRun: true,
        noExitRuntime: true,
        wasmBinary: bbPairingsWasmBinary,
        print: (message) => stdout.push(String(message)),
        printErr: (message) => stderr.push(String(message)),
    });

    return { bbpRuntime, stdout, stderr };
}

function normalizePlayers(players) {
    const sortedPlayers = [...players].sort((a, b) => {
        const aRating = Number(a.rating) || 0;
        const bRating = Number(b.rating) || 0;
        if (bRating !== aRating) return bRating - aRating;

        const aId = Number(a.playerUniqueId);
        const bId = Number(b.playerUniqueId);
        if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
            return aId - bId;
        }

        const appIdCompare = String(a.playerUniqueId || "").localeCompare(String(b.playerUniqueId || ""), undefined, { numeric: true });
        if (appIdCompare !== 0) return appIdCompare;

        return String(a.name || "").localeCompare(String(b.name || ""));
    });

    const byAppId = new Map();
    const byPairingId = new Map();

    sortedPlayers.forEach((player, index) => {
        const pairingId = index + 1;
        const entry = { player, pairingId };
        byAppId.set(String(player.playerUniqueId), entry);
        byPairingId.set(pairingId, entry);
    });

    return { sortedPlayers, byAppId, byPairingId };
}

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

function padLeft(value, width) {
    return String(value ?? "").slice(0, width).padStart(width, " ");
}

function padRight(value, width) {
    return String(value ?? "").slice(0, width).padEnd(width, " ");
}

function putField(chars, position, width, value, align = "right") {
    const text = align === "left" ? padRight(value, width) : padLeft(value, width);
    for (let i = 0; i < width; i += 1) {
        chars[position - 1 + i] = text[i];
    }
}

function resultPointsForWhite(result) {
    if (result === "1-0" || result === "1-0f") return 1;
    if (result === "0-1" || result === "0-1f") return 0;
    if (result === "0.5-0.5") return 0.5;
    return 0;
}

function resultPointsForBlack(result) {
    if (result === "0-1" || result === "0-1f") return 1;
    if (result === "1-0" || result === "1-0f") return 0;
    if (result === "0.5-0.5") return 0.5;
    return 0;
}

function resultCodeForPlayer(pairing, playerColor) {
    const result = pairing.result || "";
    const isWhite = playerColor === "w";

    if (pairing.isBye) return "U";
    if (result === "0.5-0.5") return "=";
    if (result === "1-0") return isWhite ? "1" : "0";
    if (result === "0-1") return isWhite ? "0" : "1";
    if (result === "1-0f") return isWhite ? "+" : "-";
    if (result === "0-1f") return isWhite ? "-" : "+";
    if (result === "0-0") return "-";
    return " ";
}

function unplayedResultCodeForPlayer(pairing, playerColor) {
    const points = playerColor === "w"
        ? resultPointsForWhite(pairing.result)
        : resultPointsForBlack(pairing.result);

    if (points === 1) return "F";
    if (points === 0.5) return "H";
    return "Z";
}

function calculateScores(players, previousRounds) {
    const scores = new Map(players.map((player) => [String(player.playerUniqueId), 0]));

    previousRounds.forEach((round) => {
        round.pairings?.forEach((pairing) => {
            const whiteKey = String(pairing.whiteId);
            const blackKey = String(pairing.blackId);

            if (pairing.isTournamentForfeit) return;

            if (pairing.isBye && !pairing.isSkip) {
                scores.set(whiteKey, (scores.get(whiteKey) || 0) + 1);
                return;
            }

            scores.set(whiteKey, (scores.get(whiteKey) || 0) + resultPointsForWhite(pairing.result));
            scores.set(blackKey, (scores.get(blackKey) || 0) + resultPointsForBlack(pairing.result));
        });
    });

    return scores;
}

function buildRoundLookup(playerId, round, activePlayerLookup) {
    const pairing = round.pairings?.find((candidate) => (
        String(candidate.whiteId) === playerId ||
        (!candidate.isBye && String(candidate.blackId) === playerId)
    ));

    if (!pairing) return null;
    if (pairing.isTournamentForfeit) return { opponentId: "0000", color: "-", result: "Z" };
    if (pairing.isBye && pairing.isSkip) {
        return { opponentId: "0000", color: "-", result: unplayedResultCodeForPlayer(pairing, "w") };
    }
    if (pairing.isBye) return { opponentId: "0000", color: "-", result: "U" };

    const isWhite = String(pairing.whiteId) === playerId;
    const opponentId = String(isWhite ? pairing.blackId : pairing.whiteId);
    if (!activePlayerLookup.has(opponentId)) {
        return { opponentId: "0000", color: "-", result: "Z" };
    }

    return {
        opponentId,
        color: isWhite ? "w" : "b",
        result: resultCodeForPlayer(pairing, isWhite ? "w" : "b"),
    };
}

function buildTrf(players, previousRounds, options = {}) {
    const { sortedPlayers, byAppId } = normalizePlayers(players);
    const scores = calculateScores(players, previousRounds);
    const includeNextRound = options.includeNextRound !== false;
    const excludedPlayerIds = new Set((options.excludedPlayerIds || []).map(String));
    const totalRounds = Math.max(
        Number(options.totalRounds) || Number(options.numRounds) || 5,
        previousRounds.length + (includeNextRound ? 1 : 0)
    );
    const lines = [
        `012 ${String(options.tournamentName || "Swiss Pairing").slice(0, 60)}`,
        `XXR ${totalRounds}`,
        "XXC rank",
        options.startingColor === "black" ? "XXC black1" : "XXC white1",
    ];

    sortedPlayers.forEach((player, index) => {
        const playerId = String(player.playerUniqueId);
        const isExcludedFromNextPairing = includeNextRound && excludedPlayerIds.has(playerId);
        const lineLength = 89 + (previousRounds.length + (isExcludedFromNextPairing ? 1 : 0)) * 10;
        const chars = Array(lineLength).fill(" ");
        const pairingId = index + 1;
        const name = player.name || `Player ${player.playerUniqueId}`;
        const rating = Number(player.rating) || 0;
        const score = (scores.get(playerId) || 0).toFixed(1);

        putField(chars, 1, 3, "001", "left");
        putField(chars, 5, 4, pairingId);
        putField(chars, 10, 1, "m", "left");
        putField(chars, 15, 33, name, "left");
        putField(chars, 49, 4, rating || "");
        putField(chars, 54, 3, player.federation || "");
        putField(chars, 58, 11, player.fideId || 0);
        putField(chars, 81, 4, score);
        putField(chars, 86, 4, pairingId);

        previousRounds.forEach((round, roundIndex) => {
            const fieldStart = 92 + roundIndex * 10;
            const roundData = buildRoundLookup(playerId, round, byAppId);

            if (!roundData) {
                putField(chars, fieldStart, 4, "0000");
                putField(chars, fieldStart + 5, 1, "-", "left");
                putField(chars, fieldStart + 7, 1, "Z", "left");
                return;
            }

            const opponent = byAppId.get(String(roundData.opponentId));
            putField(chars, fieldStart, 4, opponent ? opponent.pairingId : "0000");
            putField(chars, fieldStart + 5, 1, roundData.color, "left");
            putField(chars, fieldStart + 7, 1, roundData.result, "left");
        });

        if (isExcludedFromNextPairing) {
            const fieldStart = 92 + previousRounds.length * 10;
            putField(chars, fieldStart, 4, "0000");
            putField(chars, fieldStart + 5, 1, "-", "left");
            putField(chars, fieldStart + 7, 1, "Z", "left");
        }

        lines.push(chars.join("").trimEnd());
    });

    return `${lines.join("\r\n")}\r\n`;
}

export function buildTournamentTrf(players, rounds = [], options = {}) {
    return buildTrf(players || [], rounds || [], {
        ...options,
        includeNextRound: false,
    });
}

function parseBbpOutput(output, byPairingId) {
    const tokens = output.trim().split(/\s+/).map((token) => Number(token)).filter(Number.isFinite);
    if (tokens.length === 0) {
        throw new Error("bbpPairings did not produce any pairings");
    }

    const pairCount = tokens[0];
    const pairings = [];

    for (let i = 0; i < pairCount; i += 1) {
        const whitePairingId = tokens[1 + i * 2];
        const blackPairingId = tokens[2 + i * 2];
        const white = byPairingId.get(whitePairingId);

        if (!white) {
            throw new Error(`bbpPairings returned unknown player id ${whitePairingId}`);
        }

        if (blackPairingId === 0) {
            pairings.push({
                whiteId: white.player.playerUniqueId,
                blackId: null,
                isBye: true,
            });
            continue;
        }

        const black = byPairingId.get(blackPairingId);
        if (!black) {
            throw new Error(`bbpPairings returned unknown player id ${blackPairingId}`);
        }

        pairings.push({
            whiteId: white.player.playerUniqueId,
            blackId: black.player.playerUniqueId,
            isBye: false,
        });
    }

    return pairings;
}

/**
 * Generate pairings for next round using bbpPairings.
 *
 * @param {Array} players - List of player objects
 * @param {Object} options - Pairing options
 * @param {Array} previousRounds - Previous round data
 * @returns {Promise<Array>} - List of pairings
 */
export async function generatePairings(players, options = {}, previousRounds = []) {
    console.log("[Pairing Engine] Generating pairings for round", previousRounds.length + 1);

    const forfeitedIds = getForfeitedPlayerIds(previousRounds);
    const excludedPlayerIds = new Set([
        ...forfeitedIds,
        ...(options.excludedPlayerIds || []).map(String),
    ]);
    const eligiblePlayers = (players || []).filter(player => !excludedPlayerIds.has(getPlayerId(player)));

    if (!eligiblePlayers || eligiblePlayers.length < 2) {
        return eligiblePlayers?.length === 1
            ? [{ whiteId: getPlayerId(eligiblePlayers[0]), blackId: null, isBye: true }]
            : [];
    }

    await initPairingEngine();

    const { byPairingId } = normalizePlayers(players || []);
    const trf = buildTrf(players || [], previousRounds, {
        ...options,
        excludedPlayerIds: [...excludedPlayerIds],
    });

    try {
        const { bbpRuntime, stderr } = await createBbpInstance();
        bbpRuntime.FS_createDataFile("/", INPUT_FILE.slice(1), trf, true, true, true);

        let exitCode;
        try {
            exitCode = bbpRuntime.callMain(["--dutch", INPUT_FILE, "-p", OUTPUT_FILE]);
        } catch (error) {
            const bbpMessage = stderr.join("\n").trim();
            if (bbpMessage) {
                const message = bbpMessage === "Aborted(undefined)"
                    ? "bbpPairings could not generate a valid pairing for the remaining players."
                    : bbpMessage;
                throw new Error(message, { cause: error });
            }
            throw error;
        }

        if (exitCode !== 0) {
            throw new Error(stderr.join("\n") || `bbpPairings exited with code ${exitCode}`);
        }

        const output = bbpRuntime.FS.readFile(OUTPUT_FILE, { encoding: "utf8" });
        return parseBbpOutput(output, byPairingId);
    } catch (error) {
        throw error;
    }
}
