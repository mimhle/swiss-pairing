"use client";

/**
 * Client-side tool executor for the in-app tournament assistant.
 *
 * The assistant API runs on the server, but tournament data lives in the
 * browser's IndexedDB. The chat drawer therefore executes tool calls locally
 * and sends the results back to the API for the next model turn.
 *
 * Read tools are safe. Write tools modify IndexedDB through the same store
 * functions the UI uses, then notify the app so visible views reload.
 */

import { loadPlayers, savePlayers, loadRounds, saveRounds } from "@/lib/tournamentStore";
import { calculateStandings } from "@/lib/standingsLogic";
import { generatePairings } from "@/lib/pairingEngine";
import { PLAYER_EDITABLE_KEYS } from "@/lib/knownFields";

const VALID_TIEBREAKS = new Set([
    "bh",
    "bh_cut1",
    "bh_virtual_cut1",
    "sb",
    "wins",
    "direct",
    "progressive",
    "wins_black",
    "games_black",
]);

const PLAYER_WRITE_FIELDS = new Set([...PLAYER_EDITABLE_KEYS, "teamUniqueId"]);

const TEMPLATE_MAX_LENGTH = 500;
const FORBIDDEN_TEMPLATE_PATTERN = /\b(?:fetch|XMLHttpRequest|WebSocket|eval|Function|import|require|process|globalThis|window|document|localStorage|sessionStorage|indexedDB|navigator|location|constructor|__proto__|prototype|this|self|top|parent|frames|opener|postMessage|setTimeout|setInterval|alert|confirm|prompt|WebAssembly|Worker|SharedWorker|ServiceWorker|BroadcastChannel|MessageChannel|caches|Atomics|SharedArrayBuffer)\b/i;

function validateTemplate(template) {
    const value = String(template ?? "");

    if (value.length > TEMPLATE_MAX_LENGTH) {
        return `Template is too long. Maximum ${TEMPLATE_MAX_LENGTH} characters.`;
    }

    if (value.includes("`")) {
        return "Template cannot contain backticks.";
    }

    const expressionPattern = /\$\{([^}]*)\}/g;
    let match;
    while ((match = expressionPattern.exec(value)) !== null) {
        const expression = match[1];
        if (expression.includes("{") || expression.includes("}")) {
            return "Template expressions cannot contain braces.";
        }
        if (FORBIDDEN_TEMPLATE_PATTERN.test(expression)) {
            return "Template contains a disallowed identifier.";
        }
    }

    return null;
}

function createTemplateProxy(player) {
    return new Proxy(player, {
        has(target, prop) {
            if (typeof prop !== "string") return false;
            if (prop in target) return true;
            if (prop === "lastname" || prop === "firstname") return true;
            if (prop in globalThis) return false;
            return true;
        },
        get(target, prop) {
            if (prop === "lastname") return (target.name || "").split(" ")[0] || "";
            if (prop === "firstname") return (target.name || "").split(" ").slice(1).join(" ") || "";
            const value = target[prop];
            return value !== undefined && value !== null ? value : "";
        },
    });
}

function compileTemplate(template) {
    return new Function("ctx", `with (ctx) { return \`${template}\`; }`);
}

function evaluateTemplateForPlayer(evaluator, player) {
    const value = evaluator(createTemplateProxy(player));
    return value === undefined || value === null ? "" : String(value);
}

const RESULT_ALIASES = new Map([
    ["1-0", "1-0"],
    ["1:0", "1-0"],
    ["white", "1-0"],
    ["white wins", "1-0"],
    ["white win", "1-0"],
    ["w", "1-0"],
    ["0-1", "0-1"],
    ["0:1", "0-1"],
    ["black", "0-1"],
    ["black wins", "0-1"],
    ["black win", "0-1"],
    ["b", "0-1"],
    ["0.5-0.5", "0.5-0.5"],
    ["0,5-0,5", "0.5-0.5"],
    ["1/2-1/2", "0.5-0.5"],
    ["1/2", "0.5-0.5"],
    ["½-½", "0.5-0.5"],
    ["draw", "0.5-0.5"],
    ["d", "0.5-0.5"],
    ["tie", "0.5-0.5"],
    ["1-0f", "1-0f"],
    ["+:-", "1-0f"],
    ["white forfeit", "1-0f"],
    ["white wins by forfeit", "1-0f"],
    ["forfeit white", "1-0f"],
    ["0-1f", "0-1f"],
    ["-:+", "0-1f"],
    ["black forfeit", "0-1f"],
    ["black wins by forfeit", "0-1f"],
    ["forfeit black", "0-1f"],
    ["0-0", "0-0"],
    ["0:0", "0-0"],
    ["double forfeit", "0-0"],
    ["both forfeit", "0-0"],
]);

function getPlayerId(player) {
    return String(player?.playerUniqueId ?? player?.id ?? "");
}

function compactPlayer(player) {
    return {
        id: player.playerUniqueId,
        name: player.name || "",
        rating: Number(player.rating) || 0,
        title: player.title || "",
        federation: player.federation || "",
        club: player.club || "",
        group: player.group || "",
        gender: player.gender || "",
        fideId: player.fideId || "",
        teamUniqueId: player.teamUniqueId || "",
        type: player.type || "",
    };
}

function buildPlayerMap(players) {
    return new Map((players || []).map(player => [getPlayerId(player), player]));
}

function pairingToJson(pairing, index, playerMap) {
    const white = playerMap.get(String(pairing.whiteId));
    const hasBlack = pairing.blackId != null && pairing.blackId !== "";
    const black = hasBlack ? playerMap.get(String(pairing.blackId)) : null;

    return {
        pairingId: pairing.id || null,
        board: index + 1,
        white: white?.name || String(pairing.whiteId || ""),
        whiteId: pairing.whiteId ?? null,
        black: black?.name || (hasBlack ? String(pairing.blackId) : null),
        blackId: hasBlack ? pairing.blackId : null,
        result: pairing.result || "",
        pending: !pairing.isBye && !pairing.isSkip && !pairing.isTournamentForfeit && !pairing.result,
        isBye: Boolean(pairing.isBye),
        isSkip: Boolean(pairing.isSkip),
        isTournamentForfeit: Boolean(pairing.isTournamentForfeit),
    };
}

function nextPlayerId(players) {
    return Math.max(0, ...(players || []).map(player => Number(player.playerUniqueId)).filter(Number.isFinite)) + 1;
}

function normalizePlayerFields(input = {}) {
    const fields = {};
    const warnings = [];

    for (const [key, raw] of Object.entries(input || {})) {
        if (!PLAYER_WRITE_FIELDS.has(key)) {
            warnings.push(`Ignored unknown field "${key}".`);
            continue;
        }

        if (key === "rating") {
            const value = String(raw ?? "").trim();
            if (value === "") {
                fields.rating = "";
                continue;
            }
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
                warnings.push(`Rating "${value}" is not a number and was ignored.`);
                continue;
            }
            fields.rating = String(numeric);
            continue;
        }

        fields[key] = String(raw ?? "").trim();
    }

    return { fields, warnings };
}

function findPlayer(players, { playerId, name } = {}) {
    const id = String(playerId ?? "").trim();
    if (id) {
        const byId = (players || []).find(player => String(player.playerUniqueId) === id);
        if (byId) return { player: byId, error: null };
        return { player: null, error: `No player with ID ${id}. Use get_players to list current IDs.` };
    }

    const target = String(name ?? "").trim().toLowerCase();
    if (!target) return { player: null, error: "Provide a playerId or an exact name." };

    const matches = (players || []).filter(player => String(player.name || "").trim().toLowerCase() === target);
    if (matches.length === 0) return { player: null, error: `No player named "${name}". Use get_players to search.` };
    if (matches.length > 1) {
        return {
            player: null,
            error: `Multiple players match "${name}": ${matches.map(player => `${player.name} (ID ${player.playerUniqueId})`).join(", ")}. Use playerId.`,
        };
    }
    return { player: matches[0], error: null };
}

function playerIsPaired(rounds, playerId) {
    const id = String(playerId);
    return (rounds || []).some(round => (round.pairings || []).some(pairing => (
        String(pairing.whiteId) === id || String(pairing.blackId) === id
    )));
}

function normalizeResult(value) {
    const raw = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!raw) return "";
    if (["pending", "clear", "none", "unplayed"].includes(raw)) return "";
    return RESULT_ALIASES.get(raw) ?? null;
}

function findPairing(pairings, entry, playerMap) {
    const board = Number(entry?.board);
    if (Number.isFinite(board) && board >= 1) {
        if (board > pairings.length) {
            return { index: -1, error: `Board ${board} does not exist. This round has ${pairings.length} boards.` };
        }
        return { index: board - 1, error: null };
    }

    const whiteKey = String(entry?.white ?? "").trim().toLowerCase();
    const blackKey = String(entry?.black ?? "").trim().toLowerCase();
    if (!whiteKey && !blackKey) {
        return { index: -1, error: "Provide a board number or both white and black player names." };
    }

    const matches = [];
    pairings.forEach((pairing, index) => {
        const whitePlayer = playerMap.get(String(pairing.whiteId));
        const blackPlayer = pairing.blackId != null ? playerMap.get(String(pairing.blackId)) : null;
        const whiteName = String(whitePlayer?.name || "").trim().toLowerCase();
        const blackName = String(blackPlayer?.name || "").trim().toLowerCase();
        const whiteId = String(pairing.whiteId ?? "").trim().toLowerCase();
        const blackId = String(pairing.blackId ?? "").trim().toLowerCase();

        const whiteMatches = whiteKey && (whiteName === whiteKey || whiteId === whiteKey);
        const blackMatches = blackKey && (blackName === blackKey || blackId === blackKey);

        if (whiteKey && blackKey) {
            if (whiteMatches && blackMatches) matches.push(index);
        } else if (whiteKey) {
            if (whiteMatches) matches.push(index);
        } else if (blackMatches) {
            matches.push(index);
        }
    });

    if (matches.length === 0) {
        return { index: -1, error: "No pairing matched those player names in this round." };
    }
    if (matches.length > 1) {
        return {
            index: -1,
            error: `Multiple pairings matched. Use a board number. Matching boards: ${matches.map(index => index + 1).join(", ")}.`,
        };
    }
    return { index: matches[0], error: null };
}

export function createAssistantToolContext({
    activeTournamentId,
    tournaments,
    tournamentConfig,
    rounds,
    onDataChanged,
}) {
    let playersPromise = null;

    const context = {
        activeTournamentId,
        tournaments: tournaments || [],
        tournamentConfig: tournamentConfig || null,
        rounds: rounds || [],
        onDataChanged: onDataChanged || null,
        getPlayers: () => {
            if (!playersPromise) {
                playersPromise = loadPlayers(activeTournamentId).catch(() => []);
            }
            return playersPromise;
        },
        invalidatePlayers: () => {
            playersPromise = null;
        },
        refreshRounds: async () => {
            const fresh = await loadRounds(activeTournamentId).catch(() => []);
            context.rounds = fresh;
            return fresh;
        },
    };

    return context;
}

export async function executeAssistantTool({ name, arguments: args = {}, context }) {
    try {
        switch (name) {
            case "get_tournament_summary": {
                const players = await context.getPlayers();
                const active = (context.tournaments || []).find(tournament => tournament.id === context.activeTournamentId);
                const config = context.tournamentConfig;
                const rounds = context.rounds || [];
                const completedRounds = rounds.filter(round => {
                    const pairings = round.pairings || [];
                    return pairings.length > 0 && pairings.every(pairing => (
                        pairing.isBye || pairing.isSkip || pairing.isTournamentForfeit || pairing.result
                    ));
                }).length;

                return {
                    activeTournament: active
                        ? { id: active.id, name: active.name }
                        : { id: context.activeTournamentId, name: "Unknown" },
                    tournaments: (context.tournaments || []).map(tournament => ({
                        id: tournament.id,
                        name: tournament.name,
                    })),
                    config: config ? {
                        name: config.name || active?.name || "",
                        numRounds: Number(config.numRounds) || null,
                        pairingMode: config.pairingMode || "all",
                        tiebreaks: config.tiebreaks || ["bh", "sb", "wins"],
                        startingColor: config.startingColor || "white",
                    } : null,
                    playerCount: players.length,
                    playerListLocked: rounds.some(round => (round.pairings || []).length > 0),
                    roundCount: rounds.length,
                    completedRounds,
                };
            }

            case "get_players": {
                const players = await context.getPlayers();
                const search = String(args.search ?? "").trim().toLowerCase();
                const limit = Math.min(300, Math.max(1, Number(args.limit) || 100));

                const filtered = search
                    ? players.filter(player => [
                        player.name,
                        player.club,
                        player.federation,
                        player.title,
                        player.fideId,
                        player.teamUniqueId,
                        player.playerUniqueId,
                    ].some(value => String(value ?? "").toLowerCase().includes(search)))
                    : players;

                return {
                    totalPlayers: players.length,
                    returnedPlayers: Math.min(filtered.length, limit),
                    players: filtered.slice(0, limit).map(compactPlayer),
                    note: filtered.length > limit
                        ? `Showing ${limit} of ${filtered.length} matching players. Refine the search or raise the limit.`
                        : undefined,
                };
            }

            case "get_standings": {
                const players = await context.getPlayers();
                const requestedTiebreaks = Array.isArray(args.tiebreaks)
                    ? args.tiebreaks.filter(tiebreak => VALID_TIEBREAKS.has(tiebreak))
                    : null;
                const tiebreaks = requestedTiebreaks && requestedTiebreaks.length > 0
                    ? requestedTiebreaks
                    : (context.tournamentConfig?.tiebreaks || ["bh", "sb", "wins"]);
                const limit = Math.min(200, Math.max(1, Number(args.limit) || 20));

                const standings = calculateStandings(players, context.rounds || [], tiebreaks);
                const playerMap = buildPlayerMap(players);

                return {
                    tiebreaks,
                    totalPlayers: standings.length,
                    returnedStandings: Math.min(standings.length, limit),
                    standings: standings.slice(0, limit).map((standing, index) => ({
                        rank: index + 1,
                        player: playerMap.get(String(standing.playerUniqueId))?.name || "",
                        playerId: standing.playerUniqueId,
                        points: standing.points,
                        tiebreakers: standing.tiebreakers,
                        results: (standing.results || []).map(result => ({
                            opponentId: result.opponentId,
                            opponent: playerMap.get(String(result.opponentId))?.name || "",
                            result: result.result,
                            pointsEarned: result.pointsEarned,
                        })),
                    })),
                    note: standings.length > limit
                        ? `Showing the top ${limit} of ${standings.length} players. Raise the limit to see more.`
                        : undefined,
                };
            }

            case "get_rounds": {
                const players = await context.getPlayers();
                const playerMap = buildPlayerMap(players);
                const allRounds = context.rounds || [];
                const requested = Number(args.roundNumber);
                const allRoundsRequested = Boolean(args.allRounds);

                let selected;
                if (allRoundsRequested) {
                    selected = allRounds.map((round, index) => ({ round, index }));
                } else if (Number.isFinite(requested) && requested > 0) {
                    const roundIndex = allRounds.findIndex(round => Number(round.roundNumber) === requested);
                    selected = roundIndex >= 0 ? [{ round: allRounds[roundIndex], index: roundIndex }] : [];
                } else if (allRounds.length > 0) {
                    selected = [{ round: allRounds[allRounds.length - 1], index: allRounds.length - 1 }];
                } else {
                    selected = [];
                }

                if (selected.length === 0) {
                    return {
                        error: requested
                            ? `Round ${requested} was not found. The tournament has ${allRounds.length} round(s).`
                            : "No rounds exist yet. Generate pairings in the Rounds tab first.",
                    };
                }

                return {
                    totalRounds: allRounds.length,
                    returnedRounds: selected.length,
                    rounds: selected.map(({ round, index }) => ({
                        roundNumber: Number(round.roundNumber) || index + 1,
                        status: round.status || "",
                        pairings: (round.pairings || []).map((pairing, pairingIndex) => (
                            pairingToJson(pairing, pairingIndex, playerMap)
                        )),
                    })),
                };
            }

            case "get_player_history": {
                const players = await context.getPlayers();
                const playerMap = buildPlayerMap(players);
                const id = String(args.playerId ?? "").trim();
                const name = String(args.name ?? "").trim().toLowerCase();
                const player = (id ? playerMap.get(id) : null)
                    || (name ? players.find(candidate => String(candidate.name || "").toLowerCase().includes(name)) : null);

                if (!player) {
                    return { error: "Player not found in the active tournament." };
                }

                const playerId = getPlayerId(player);
                const history = (context.rounds || []).map((round, roundIndex) => {
                    const pairing = (round.pairings || []).find(candidate => (
                        String(candidate.whiteId) === playerId || String(candidate.blackId) === playerId
                    ));
                    if (!pairing) return null;

                    const isWhite = String(pairing.whiteId) === playerId;
                    const opponentId = isWhite ? pairing.blackId : pairing.whiteId;
                    const opponent = opponentId != null ? playerMap.get(String(opponentId)) : null;

                    return {
                        round: Number(round.roundNumber) || roundIndex + 1,
                        color: pairing.isBye ? "bye" : isWhite ? "white" : "black",
                        opponent: pairing.isBye ? "BYE" : (opponent?.name || String(opponentId ?? "")),
                        result: pairing.result || "",
                        isTournamentForfeit: Boolean(pairing.isTournamentForfeit),
                    };
                }).filter(Boolean);

                const standings = calculateStandings(
                    players,
                    context.rounds || [],
                    context.tournamentConfig?.tiebreaks || ["bh", "sb", "wins"]
                );
                const rankIndex = standings.findIndex(standing => String(standing.playerUniqueId) === playerId);

                return {
                    player: compactPlayer(player),
                    standing: rankIndex >= 0 ? {
                        rank: rankIndex + 1,
                        points: standings[rankIndex].points,
                        tiebreakers: standings[rankIndex].tiebreakers,
                    } : null,
                    history,
                };
            }

            case "add_players": {
                const inputPlayers = Array.isArray(args.players) ? args.players : [];
                if (inputPlayers.length === 0) {
                    return { error: "No players were provided." };
                }

                const existing = await loadPlayers(context.activeTournamentId).catch(() => []);
                const rounds = context.rounds || [];
                const listLocked = rounds.some(round => (round.pairings || []).length > 0);
                const mode = args.mode === "replace" ? "replace" : "append";

                if (mode === "replace" && listLocked) {
                    return {
                        error: "Cannot replace the player list after rounds have been created. Add players instead, or clear the rounds in the Rounds tab first.",
                    };
                }

                const base = mode === "replace" ? [] : [...existing];
                let nextId = nextPlayerId(base);
                const added = [];
                const skipped = [];
                const warnings = [];

                for (const raw of inputPlayers) {
                    const { fields, warnings: fieldWarnings } = normalizePlayerFields(raw);
                    if (!fields.name) {
                        skipped.push({ player: raw, reason: "Missing name." });
                        continue;
                    }

                    const duplicate = base.some(player => (
                        String(player.name || "").trim().toLowerCase() === fields.name.toLowerCase()
                    ));
                    if (duplicate) {
                        warnings.push(`A player named "${fields.name}" already exists.`);
                    }

                    const player = { playerUniqueId: nextId++, ...fields };
                    base.push(player);
                    added.push(player);

                    fieldWarnings.forEach(warning => warnings.push(`${fields.name}: ${warning}`));
                }

                if (added.length === 0) {
                    return {
                        error: "No valid players were provided. Every player needs a name.",
                        skipped,
                    };
                }

                await savePlayers(base, context.activeTournamentId);
                context.invalidatePlayers();
                await context.onDataChanged?.();

                return {
                    mode,
                    addedCount: added.length,
                    totalPlayers: base.length,
                    added: added.slice(0, 20).map(compactPlayer),
                    skipped,
                    warnings: warnings.slice(0, 20),
                    note: added.length > 20
                        ? `Showing the first 20 of ${added.length} added players. Use get_players to see more.`
                        : undefined,
                };
            }

            case "update_player": {
                const existing = await loadPlayers(context.activeTournamentId).catch(() => []);
                const { player, error } = findPlayer(existing, args);
                if (error) return { error };

                const { fields, warnings } = normalizePlayerFields(args.fields || {});
                if (Object.keys(fields).length === 0) {
                    return { error: "No valid fields to update.", warnings };
                }
                if (Object.prototype.hasOwnProperty.call(fields, "name") && !fields.name) {
                    return { error: "A player name cannot be empty.", warnings };
                }

                if (fields.name && fields.name.toLowerCase() !== String(player.name || "").toLowerCase()) {
                    const duplicate = existing.some(candidate => (
                        String(candidate.playerUniqueId) !== String(player.playerUniqueId)
                        && String(candidate.name || "").trim().toLowerCase() === fields.name.toLowerCase()
                    ));
                    if (duplicate) {
                        warnings.push(`Another player is already named "${fields.name}".`);
                    }
                }

                const updated = { ...player, ...fields };
                const nextPlayers = existing.map(candidate => (
                    String(candidate.playerUniqueId) === String(player.playerUniqueId)
                        ? updated
                        : candidate
                ));

                await savePlayers(nextPlayers, context.activeTournamentId);
                context.invalidatePlayers();
                await context.onDataChanged?.();

                return {
                    updated: compactPlayer(updated),
                    changedFields: Object.keys(fields),
                    warnings,
                };
            }

            case "apply_column_template": {
                const column = String(args.column ?? "").trim();
                if (!PLAYER_WRITE_FIELDS.has(column)) {
                    return {
                        error: `Unknown column "${column}". Use one of: ${[...PLAYER_WRITE_FIELDS].join(", ")}.`,
                    };
                }

                const template = String(args.template ?? "");
                const validationError = validateTemplate(template);
                if (validationError) {
                    return { error: validationError };
                }

                const players = await loadPlayers(context.activeTournamentId).catch(() => []);
                if (players.length === 0) {
                    return { error: "There are no players to update." };
                }

                let evaluator;
                try {
                    evaluator = compileTemplate(template);
                } catch (error) {
                    return { error: `Invalid template: ${error.message}` };
                }

                const updated = [];
                const errors = [];

                for (const player of players) {
                    try {
                        const value = evaluateTemplateForPlayer(evaluator, player);
                        updated.push({ ...player, [column]: value });
                    } catch (error) {
                        errors.push({
                            player: player.name || String(player.playerUniqueId),
                            error: error.message,
                        });
                        if (errors.length >= 3) break;
                    }
                }

                if (errors.length > 0) {
                    return {
                        error: "The template failed for some players, so no changes were saved. Fix the template and try again.",
                        errors,
                    };
                }

                const changed = updated.filter((player, index) => (
                    String(player[column] ?? "") !== String(players[index][column] ?? "")
                )).length;

                if (changed === 0) {
                    return {
                        column,
                        template,
                        totalPlayers: players.length,
                        updatedCount: 0,
                        note: "The template produced the same values that were already stored. No changes were saved.",
                    };
                }

                await savePlayers(updated, context.activeTournamentId);
                context.invalidatePlayers();
                await context.onDataChanged?.();

                return {
                    column,
                    template,
                    totalPlayers: players.length,
                    updatedCount: changed,
                    sample: updated.slice(0, 5).map(player => ({
                        id: player.playerUniqueId,
                        name: player.name || "",
                        value: player[column],
                    })),
                    note: changed > 5
                        ? `Showing the first 5 of ${changed} changed players.`
                        : undefined,
                };
            }

            case "delete_player": {
                const existing = await loadPlayers(context.activeTournamentId).catch(() => []);
                const { player, error } = findPlayer(existing, args);
                if (error) return { error };

                const rounds = await loadRounds(context.activeTournamentId).catch(() => []);
                if (playerIsPaired(rounds, player.playerUniqueId)) {
                    return {
                        error: `"${player.name}" appears in a round pairing and cannot be removed. Change or remove the pairing in the Rounds tab first.`,
                    };
                }

                const nextPlayers = existing.filter(candidate => (
                    String(candidate.playerUniqueId) !== String(player.playerUniqueId)
                ));

                await savePlayers(nextPlayers, context.activeTournamentId);
                context.invalidatePlayers();
                await context.onDataChanged?.();

                return {
                    removed: compactPlayer(player),
                    totalPlayers: nextPlayers.length,
                };
            }

            case "enter_results": {
                const players = await context.getPlayers();
                const playerMap = buildPlayerMap(players);
                const rounds = await loadRounds(context.activeTournamentId).catch(() => []);
                const requested = Number(args.roundNumber);

                let roundIndex;
                if (Number.isFinite(requested) && requested > 0) {
                    roundIndex = rounds.findIndex(round => Number(round.roundNumber) === requested);
                } else {
                    roundIndex = rounds.length - 1;
                }

                if (roundIndex < 0 || !rounds[roundIndex]) {
                    return {
                        error: requested
                            ? `Round ${requested} was not found. Generate pairings in the Rounds tab first.`
                            : "No rounds exist yet. Generate pairings in the Rounds tab first.",
                    };
                }

                const round = rounds[roundIndex];
                const entries = Array.isArray(args.results) ? args.results : [];
                if (entries.length === 0) {
                    return { error: "No results were provided." };
                }

                const newPairings = (round.pairings || []).map(pairing => ({ ...pairing }));
                const updated = [];
                const skipped = [];

                for (const entry of entries) {
                    const normalized = normalizeResult(entry?.result);
                    if (normalized === null) {
                        skipped.push({ entry, reason: "Invalid result value." });
                        continue;
                    }

                    const found = findPairing(newPairings, entry, playerMap);
                    if (found.error) {
                        skipped.push({ entry, reason: found.error });
                        continue;
                    }

                    const pairing = newPairings[found.index];
                    if (pairing.isTournamentForfeit || pairing.isSkip) {
                        skipped.push({ entry, reason: "Automatic skip or forfeit rows cannot be edited." });
                        continue;
                    }
                    if (pairing.isBye && normalized !== "1-0" && normalized !== "0-0") {
                        skipped.push({ entry, reason: "A true bye must be 1-0 or 0-0." });
                        continue;
                    }

                    pairing.result = normalized;
                    updated.push(pairingToJson(pairing, found.index, playerMap));
                }

                if (updated.length === 0) {
                    return { error: "No results were applied.", skipped };
                }

                const newRounds = [...rounds];
                newRounds[roundIndex] = { ...round, pairings: newPairings };
                await saveRounds(newRounds, context.activeTournamentId);
                context.rounds = newRounds;
                await context.onDataChanged?.();

                const pendingResults = newPairings.filter(pairing => (
                    !pairing.isBye
                    && !pairing.isSkip
                    && !pairing.isTournamentForfeit
                    && !pairing.result
                )).length;

                return {
                    roundNumber: Number(round.roundNumber) || roundIndex + 1,
                    updatedCount: updated.length,
                    updated: updated.slice(0, 20),
                    skipped,
                    pendingResults,
                    note: updated.length > 20
                        ? `Showing the first 20 of ${updated.length} updated pairings.`
                        : undefined,
                };
            }

            case "get_pairings_preview": {
                const players = await context.getPlayers();
                const rounds = context.rounds || [];
                const config = context.tournamentConfig || {};
                const tournamentName = config.name || "Tournament";
                const pairings = await generatePairings(
                    players,
                    { startingColor: config.startingColor || "white" },
                    rounds,
                    config,
                    tournamentName
                );
                const playerMap = buildPlayerMap(players);

                return {
                    preview: true,
                    roundNumber: rounds.length + 1,
                    pairings: pairings.map((pairing, index) => pairingToJson(pairing, index, playerMap)),
                    note: "Preview only. It has not been saved. Use the Rounds tab to generate and save official pairings.",
                };
            }

            default:
                return { error: `Unknown tool: ${name}` };
        }
    } catch (error) {
        return { error: error?.message || "Tool execution failed." };
    }
}
