"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { useTournament } from '@/context/TournamentContext';
import { Swords, Play, Settings, ChevronRight, ChevronLeft, ChevronDown, AlertTriangle, CheckCircle2, User, Info, Building2, Globe, GraduationCap, Users, Upload, FileUp, ArrowRight, ArrowLeft, Download, UserX, RotateCcw, X } from 'lucide-react';
import { Dialog, Tooltip, Portal } from '@skeletonlabs/skeleton-react';
import TournamentConfigModal from '@/components/modals/TournamentConfigModal';
import RoundSetupModal from '@/components/modals/RoundSetupModal';
import ConfirmationModal from '@/components/modals/ConfirmationModal';
import ManualPairingModal from '@/components/modals/ManualPairingModal';
import PlayerRoundHistoryModal from '@/components/modals/PlayerRoundHistoryModal';
import { exportTournamentTrf, generatePairings } from '@/lib/pairingEngine';
import { loadPlayers } from '@/lib/tournamentStore';
import { SCORE_HEADER_FIELD_MAP, SCORE_TARGET_OPTIONS } from '@/lib/knownFields';

const RESULT_OPTIONS = [
    { value: '', label: 'Pending' },
    { value: '1-0', label: '1 - 0' },
    { value: '0-1', label: '0 - 1' },
    { value: '0.5-0.5', label: '½ - ½' },
    { value: '1-0f', label: '+ : -' },
    { value: '0-1f', label: '- : +' },
    { value: '0-0', label: '0 - 0' },
];

const DEFAULT_SCORE_ROUND_OPTIONS = {
    overwritePrevious: false,
    importAllRounds: false,
    selectedRoundNumbers: [],
    roundLimitAction: 'cap',
};

const createRoundTimestamp = () => Date.now();

function nextUniqueScoreColumnMap(prev, columnIndex, field) {
    const next = { ...prev, [columnIndex]: field };
    if (field) {
        Object.keys(next).forEach(key => {
            if (key !== String(columnIndex) && next[key] === field) next[key] = '';
        });
    }
    return next;
}

function scoreMappingOptionLabel(option, columnMap) {
    return option.value && Object.values(columnMap).includes(option.value)
        ? `✓ ${option.label}`
        : option.label;
}

function parseScoreRawData(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return null;
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map(h => h.trim());
    const rows = lines.slice(1).filter(l => l.trim()).map(l => {
        const parts = l.split(sep);
        while (parts.length < headers.length) parts.push('');
        return parts.map(s => s.trim());
    });
    return { headers, rows };
}

function parseScoreExcel(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (data.length < 2) return null;
    const headers = (data[0] || []).map(c => String(c ?? ''));
    const rows = data.slice(1)
        .filter(row => row.some(c => c !== '' && c !== null && c !== undefined))
        .map(row => {
            const padded = [...row];
            while (padded.length < headers.length) padded.push('');
            return padded.map(c => String(c ?? ''));
        });
    return { headers, rows };
}

function suggestScoreMapping(headers) {
    const mapping = {};
    const used = new Set();
    headers.forEach((header, i) => {
        const key = header.normalize('NFC').toLowerCase().trim();
        const field = SCORE_HEADER_FIELD_MAP.get(key) ?? '';
        if (field && !used.has(field)) {
            mapping[i] = field;
            used.add(field);
        } else {
            mapping[i] = '';
        }
    });
    return mapping;
}

function parseImportedScore(value) {
    const normalized = String(value ?? '').trim().replace(',', '.');
    if (!normalized) return null;
    if (normalized === '½' || normalized.toLowerCase() === 'half') return 0.5;
    const n = Number(normalized);
    return [0, 0.5, 1].includes(n) ? n : null;
}

function parseImportedRound(value) {
    const n = parseInt(String(value ?? '').trim(), 10);
    return n > 0 ? n : null;
}

function parseImportedPlayerId(value) {
    const normalized = String(value ?? '').trim();
    const n = parseInt(normalized, 10);
    return n > 0 ? String(n) : '';
}

function parseImportedResult(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[–—]/g, '-')
        .replace(/½/g, '0.5')
        .replace(/1\/2/g, '0.5');

    if (!normalized) return '';
    if (['1-0', '1:0', 'w', 'white', 'whitewins'].includes(normalized)) return '1-0';
    if (['0-1', '0:1', 'b', 'black', 'blackwins'].includes(normalized)) return '0-1';
    if (['0.5-0.5', '0.5:0.5', 'draw', 'd', '='].includes(normalized)) return '0.5-0.5';
    if (['+-', '+:-', '1-0f', '1:0f'].includes(normalized)) return '1-0f';
    if (['-+', '-:+', '0-1f', '0:1f'].includes(normalized)) return '0-1f';
    if (['0-0', '0:0', '0-0f', '0:0f'].includes(normalized)) return '0-0';
    return '';
}

function resultFromScores(whiteScore, blackScore) {
    if (whiteScore === 1 && blackScore === 0) return '1-0';
    if (whiteScore === 0 && blackScore === 1) return '0-1';
    if (whiteScore === 0.5 && blackScore === 0.5) return '0.5-0.5';
    if (whiteScore === 0 && blackScore === 0) return '0-0';
    return '';
}

function scoreResultFromRow(row) {
    const importedResult = parseImportedResult(row.result);
    const whiteScore = parseImportedScore(row.whiteScore);
    const blackScore = parseImportedScore(row.blackScore);
    if (!row.blackId && whiteScore === 1) return '1-0';
    return importedResult || resultFromScores(whiteScore, blackScore);
}

function getDefaultPairingResult(pairing) {
    if (pairing.isTournamentForfeit) return '0-0';
    if (pairing.isBye) return pairing.isSkip ? '0-0' : '1-0';
    return '';
}

function getPairingResult(pairing) {
    return pairing.result || getDefaultPairingResult(pairing);
}

function getFinalPairingResult(pairing) {
    return pairing.isBye ? getDefaultPairingResult(pairing) : getPairingResult(pairing);
}

const pairingKey = (a, b) => [String(a), String(b)].sort().join('|');

function getPlayerScoreMap(roundsBeforeTarget) {
    const scores = {};
    roundsBeforeTarget.forEach(round => {
        round.pairings?.forEach(pairing => {
            const whiteId = pairing.whiteId;
            const blackId = pairing.blackId;
            const result = pairing.result;

            if (pairing.isTournamentForfeit) return;

            if (pairing.isBye && !pairing.isSkip && whiteId) {
                scores[whiteId] = (scores[whiteId] || 0) + 1;
                return;
            }

            if (!result) return;
            if (whiteId) scores[whiteId] = (scores[whiteId] || 0) + (result === '1-0' || result === '1-0f' ? 1 : result === '0.5-0.5' ? 0.5 : 0);
            if (blackId) scores[blackId] = (scores[blackId] || 0) + (result === '0-1' || result === '0-1f' ? 1 : result === '0.5-0.5' ? 0.5 : 0);
        });
    });
    return scores;
}

function getPreviousOpponentSet(roundsBeforeTarget) {
    const opponents = new Set();
    roundsBeforeTarget.forEach(round => {
        round.pairings?.forEach(pairing => {
            if (!pairing.isBye && pairing.whiteId && pairing.blackId) {
                opponents.add(pairingKey(pairing.whiteId, pairing.blackId));
            }
        });
    });
    return opponents;
}

function getPlayersWithBye(roundsBeforeTarget) {
    const byes = new Set();
    roundsBeforeTarget.forEach(round => {
        round.pairings?.forEach(pairing => {
            if (pairing.isBye && !pairing.isSkip && pairing.whiteId) byes.add(String(pairing.whiteId));
        });
    });
    return byes;
}

function getTournamentForfeitSet(roundsBeforeTarget) {
    const forfeits = new Set();
    roundsBeforeTarget.forEach(round => {
        const returnedIds = [
            ...(round.returnedForfeitPlayerIds || []),
            ...(round.options?.returnedForfeitPlayerIds || []),
        ];
        returnedIds.forEach(playerId => forfeits.delete(String(playerId)));
        round.pairings?.forEach(pairing => {
            if (pairing.isTournamentForfeit && pairing.whiteId) forfeits.add(String(pairing.whiteId));
        });
    });
    return forfeits;
}

function getNextForfeitSet(currentForfeitedIds, newForfeitPlayerIds = [], returnedForfeitPlayerIds = []) {
    const next = new Set([...currentForfeitedIds].map(String));
    returnedForfeitPlayerIds.forEach(playerId => next.delete(String(playerId)));
    newForfeitPlayerIds.forEach(playerId => next.add(String(playerId)));
    return next;
}

function validateManualPairings(manualBoards, previousRounds, options = {}) {
    const errors = [];
    const usedIds = new Set();
    const previousOpponents = getPreviousOpponentSet(previousRounds);
    const previousByes = getPlayersWithBye(previousRounds);
    const trueByeScopes = new Set();
    const getByeScope = options.getByeScope || (() => '');

    manualBoards.forEach((board, index) => {
        const boardNumber = index + 1;
        const whiteId = board.whiteId ? String(board.whiteId) : null;
        const blackId = board.blackId ? String(board.blackId) : null;
        const byeId = board.byeId ? String(board.byeId) : null;
        const forfeitId = board.forfeitId ? String(board.forfeitId) : null;
        const isSkip = Boolean(board.isSkip);
        const playerIds = [whiteId, blackId, byeId, forfeitId].filter(Boolean);

        playerIds.forEach(playerId => {
            if (usedIds.has(playerId)) {
                errors.push(`Player #${playerId} is assigned more than once.`);
            }
            usedIds.add(playerId);
        });

        if (forfeitId) {
            if (whiteId || blackId || byeId) {
                errors.push(`Board ${boardNumber} cannot have a forfeit and another assignment.`);
            }
            return;
        }

        if (byeId) {
            if (whiteId || blackId) {
                errors.push(`Board ${boardNumber} cannot have a skip/bye and regular players.`);
            }
            if (!isSkip) {
                const byeScope = getByeScope(board);
                if (trueByeScopes.has(byeScope)) {
                    errors.push(`Board ${boardNumber} creates a second bye in this round.`);
                } else if (previousByes.has(byeId)) {
                    errors.push(`Player #${byeId} already received a bye in an earlier round.`);
                }
                trueByeScopes.add(byeScope);
            }
            return;
        }

        if (whiteId || blackId) {
            if (!whiteId || !blackId) {
                errors.push(`Board ${boardNumber} needs both White and Black.`);
                return;
            }
            if (whiteId === blackId) {
                errors.push(`Board ${boardNumber} has the same player on both sides.`);
                return;
            }
            if (previousOpponents.has(pairingKey(whiteId, blackId))) {
                errors.push(`Board ${boardNumber} repeats an earlier pairing.`);
            }
        }
    });

    return errors;
}

function unchangedPairingManualValue(board, originalPairings = []) {
    const whiteId = board.whiteId ? String(board.whiteId) : null;
    const blackId = board.blackId ? String(board.blackId) : null;
    const byeId = board.byeId ? String(board.byeId) : null;
    const forfeitId = board.forfeitId ? String(board.forfeitId) : null;

    const original = originalPairings.find(pairing => {
        if (forfeitId) {
            return pairing.isTournamentForfeit && String(pairing.whiteId) === forfeitId;
        }
        if (byeId) {
            return pairing.isBye &&
                !pairing.isTournamentForfeit &&
                String(pairing.whiteId) === byeId &&
                Boolean(pairing.isSkip) === Boolean(board.isSkip);
        }
        return !pairing.isBye &&
            String(pairing.whiteId) === whiteId &&
            String(pairing.blackId) === blackId;
    });

    return original ? Boolean(original.manual) : true;
}

function findMatchingPairing(board, originalPairings = []) {
    const whiteId = board.whiteId ? String(board.whiteId) : null;
    const blackId = board.blackId ? String(board.blackId) : null;
    const byeId = board.byeId ? String(board.byeId) : null;
    const forfeitId = board.forfeitId ? String(board.forfeitId) : null;

    return originalPairings.find(pairing => {
        if (forfeitId) {
            return pairing.isTournamentForfeit && String(pairing.whiteId) === forfeitId;
        }
        if (byeId) {
            return pairing.isBye &&
                !pairing.isTournamentForfeit &&
                String(pairing.whiteId) === byeId &&
                Boolean(pairing.isSkip) === Boolean(board.isSkip);
        }
        return !pairing.isBye &&
            String(pairing.whiteId) === whiteId &&
            String(pairing.blackId) === blackId;
    });
}

function unchangedPairingResultValue(board, originalPairings = []) {
    return findMatchingPairing(board, originalPairings)?.result || '';
}

function withOriginalPairingValues(pairing, originalPairings = []) {
    const original = findMatchingPairing({
        whiteId: pairing.isBye ? null : pairing.whiteId,
        blackId: pairing.isBye ? null : pairing.blackId,
        byeId: pairing.isBye && !pairing.isTournamentForfeit ? pairing.whiteId : null,
        forfeitId: pairing.isTournamentForfeit ? pairing.whiteId : null,
        isSkip: pairing.isSkip,
    }, originalPairings);

    return original
        ? { ...pairing, manual: Boolean(original.manual), result: getPairingResult({ ...pairing, result: original.result || '' }) }
        : pairing;
}

function enforceSingleRoundBye(pairings = [], getByeScope = null) {
    const trueByeScopes = new Set();

    return pairings.map(pairing => {
        if (!pairing.isBye) return pairing;

        const byeScope = getByeScope ? getByeScope(pairing) : '';
        const isSkip = Boolean(pairing.isSkip) || Boolean(pairing.isTournamentForfeit) || trueByeScopes.has(byeScope);
        if (!isSkip) trueByeScopes.add(byeScope);

        return {
            ...pairing,
            isSkip,
        };
    });
}

function mergeManualAndGeneratedPairings(manualBoards, generatedPairings, roundNumber, originalPairings = [], playerGroupLookup = {}, options = {}) {
    const manualTrueByeScopes = new Set();
    const getByeScope = options.enforceByeByGroup
        ? (pairing) => getPairingGroup(pairing, playerGroupLookup)
        : null;
    const manualRegularSlots = [];
    const manualSpecialPairings = [];

    manualBoards.forEach(board => {
        const manual = unchangedPairingManualValue(board, originalPairings);
        const result = unchangedPairingResultValue(board, originalPairings);
        if (board.forfeitId) {
            manualSpecialPairings.push({
                whiteId: String(board.forfeitId),
                blackId: null,
                isBye: true,
                isSkip: true,
                isTournamentForfeit: true,
                manual,
                result: '0-0',
            });
            return;
        }
        if (board.byeId) {
            const group = getPairingGroup({ group: board.group, whiteId: board.byeId }, playerGroupLookup);
            const byeScope = options.enforceByeByGroup ? group : '';
            const isSkip = Boolean(board.isSkip) || manualTrueByeScopes.has(byeScope);
            if (!isSkip) manualTrueByeScopes.add(byeScope);
            manualSpecialPairings.push({
                whiteId: String(board.byeId),
                blackId: null,
                isBye: true,
                isSkip,
                group,
                manual,
                result,
            });
            return;
        }
        manualRegularSlots.push(board.whiteId && board.blackId
            ? {
                whiteId: String(board.whiteId),
                blackId: String(board.blackId),
                isBye: false,
                manual,
                result,
            }
            : null
        );
    });

    const generatedWithOriginalValues = generatedPairings.map(pairing => withOriginalPairingValues(pairing, originalPairings));
    const generatedRegularPairings = generatedWithOriginalValues.filter(pairing => !pairing.isBye);
    const regularPairings = manualRegularSlots.reduce((orderedPairings, manualPairing) => {
        orderedPairings.push(manualPairing || generatedRegularPairings.shift());
        return orderedPairings;
    }, []).filter(Boolean);
    regularPairings.push(...generatedRegularPairings);

    const generatedSpecialPairings = generatedWithOriginalValues.filter(pairing => pairing.isBye);
    const specialPairings = [...manualSpecialPairings, ...generatedSpecialPairings];

    return enforceSingleRoundBye([...regularPairings, ...specialPairings], getByeScope).map((pairing, index) => {
        return {
            ...pairing,
            id: `r${roundNumber}-p${index + 1}`,
            result: getFinalPairingResult(pairing),
        };
    });
}

function buildContinuingForfeitPairings(forfeitedIds, usedIds = new Set()) {
    return [...forfeitedIds]
        .filter(playerId => !usedIds.has(String(playerId)))
        .map(playerId => ({
            whiteId: String(playerId),
            blackId: null,
            isBye: true,
            isSkip: true,
            isTournamentForfeit: true,
            result: '0-0',
        }));
}

function getMaximumRoundCount(playerCount) {
    return Math.max(0, playerCount - 1);
}

function getMaximumRoundCountForMode(players = [], config = {}) {
    if (!isGroupPairingMode(config)) return getMaximumRoundCount(players.length);
    const groups = [...getGroupedPlayers(players).values()];
    if (!groups.length) return 0;
    return Math.min(...groups.map(groupPlayers => getMaximumRoundCount(groupPlayers.length)));
}

const isGroupPairingMode = (config) => config?.pairingMode === 'group';

function getPlayerGroup(player) {
    return String(player?.group || '').trim();
}

function getGroupedPlayers(players = []) {
    return players.reduce((groups, player) => {
        const group = getPlayerGroup(player);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(player);
        return groups;
    }, new Map());
}

function getBlankGroupPlayers(players = []) {
    return players.filter(player => !getPlayerGroup(player));
}

function buildPlayerGroupLookup(players = []) {
    return players.reduce((acc, player) => {
        acc[String(player.playerUniqueId)] = getPlayerGroup(player);
        return acc;
    }, {});
}

function getPairingGroup(pairing, playerGroupLookup = {}) {
    return pairing.group || playerGroupLookup[String(pairing.whiteId)] || playerGroupLookup[String(pairing.blackId)] || '';
}

function withPairingGroups(pairings = [], playerGroupLookup = {}) {
    return pairings.map(pairing => ({
        ...pairing,
        group: getPairingGroup(pairing, playerGroupLookup),
    }));
}

function filterRoundsForGroup(rounds = [], group, playerGroupLookup = {}) {
    return rounds.map(round => ({
        ...round,
        pairings: (round.pairings || []).filter(pairing => getPairingGroup(pairing, playerGroupLookup) === group),
    }));
}

function getRoundGroupSections(pairings = [], playerGroupLookup = {}, enabled = false) {
    if (!enabled) {
        return [{
            key: 'all',
            group: '',
            pairings: pairings.map((pairing, index) => ({ pairing, index, groupIndex: index })),
        }];
    }

    const sections = [];
    const sectionByGroup = new Map();
    pairings.forEach((pairing, index) => {
        const group = getPairingGroup(pairing, playerGroupLookup);
        if (!sectionByGroup.has(group)) {
            const section = {
                key: `${group || 'unassigned'}-${index}`,
                group,
                pairings: [],
            };
            sectionByGroup.set(group, section);
            sections.push(section);
        }
        const currentSection = sectionByGroup.get(group);
        currentSection.pairings.push({ pairing, index, groupIndex: currentSection.pairings.length });
    });
    return sections;
}

function getRoundPlayerIds(round) {
    const ids = new Set();

    round.pairings?.forEach(pairing => {
        if (pairing.whiteId) ids.add(String(pairing.whiteId));
        if (!pairing.isBye && pairing.blackId) ids.add(String(pairing.blackId));
    });

    return ids;
}

function getRoundsPlayerIds(roundsToRead = []) {
    const ids = new Set();
    roundsToRead.forEach(round => {
        getRoundPlayerIds(round).forEach(playerId => ids.add(playerId));
    });
    return ids;
}

function getManualBoardPlayerIds(boards = []) {
    const ids = new Set();
    boards.forEach(board => {
        [board.whiteId, board.blackId, board.byeId, board.forfeitId]
            .filter(Boolean)
            .forEach(playerId => ids.add(String(playerId)));
    });
    return ids;
}

function getManualBoardForfeitIds(boards = []) {
    return new Set(
        boards
            .map(board => board.forfeitId)
            .filter(Boolean)
            .map(String)
    );
}

function hasPlayerName(player) {
    return String(player?.name || '').trim().length > 0;
}

function getActivePairablePlayers(players = [], forfeitedIds = new Set()) {
    return players.filter(player => (
        hasPlayerName(player) &&
        !forfeitedIds.has(String(player.playerUniqueId))
    ));
}

function addMissingPlayerSkips(roundsToUpdate, players) {
    if (!roundsToUpdate.length || !players.length) return roundsToUpdate;

    const playerGroupLookup = buildPlayerGroupLookup(players);
    const playerIds = players
        .map(player => String(player.playerUniqueId))
        .filter(Boolean);
    let changed = false;

    const updatedRounds = roundsToUpdate.map((round, roundIndex) => {
        const existingIds = getRoundPlayerIds(round);
        const missingIds = playerIds.filter(playerId => !existingIds.has(playerId));

        if (!missingIds.length) return round;
        changed = true;

        const roundNumber = round.roundNumber || roundIndex + 1;
        const existingPairings = round.pairings || [];
        const skipPairings = missingIds.map(playerId => ({
            whiteId: playerId,
            blackId: null,
            isBye: true,
            isSkip: true,
            group: playerGroupLookup[playerId] || '',
            result: '0-0',
        }));

        return {
            ...round,
            pairings: [...existingPairings, ...skipPairings].map((pairing, pairingIndex) => ({
                ...pairing,
                id: `r${roundNumber}-p${pairingIndex + 1}`,
            })),
        };
    });

    return changed ? updatedRounds : roundsToUpdate;
}

function preserveOriginalRemainderPairings(remainingPlayers, originalPairings = []) {
    const remainingIds = new Set(remainingPlayers.map(player => String(player.playerUniqueId)));
    const usedIds = new Set();
    const preservedPairings = [];

    originalPairings.forEach(pairing => {
        if (pairing.isTournamentForfeit) return;

        if (pairing.isBye) {
            const playerId = String(pairing.whiteId);
            if (remainingIds.has(playerId) && !usedIds.has(playerId)) {
                preservedPairings.push({
                    whiteId: playerId,
                    blackId: null,
                    isBye: true,
                    isSkip: Boolean(pairing.isSkip),
                    result: getPairingResult(pairing),
                    manual: Boolean(pairing.manual),
                });
                usedIds.add(playerId);
            }
            return;
        }

        const whiteId = String(pairing.whiteId);
        const blackId = String(pairing.blackId);
        if (
            remainingIds.has(whiteId) &&
            remainingIds.has(blackId) &&
            !usedIds.has(whiteId) &&
            !usedIds.has(blackId)
        ) {
            preservedPairings.push({
                whiteId,
                blackId,
                isBye: false,
                result: pairing.result || '',
                manual: Boolean(pairing.manual),
            });
            usedIds.add(whiteId);
            usedIds.add(blackId);
        }
    });

    return {
        preservedPairings,
        remainingPlayers: remainingPlayers.filter(player => !usedIds.has(String(player.playerUniqueId))),
    };
}

async function generateManualRemainderPairingsByGroup(playersNeedingPairing, options, previousRounds, config, tournamentName, onProgress, allPlayersForGroups = playersNeedingPairing) {
    const pairingPlayers = allPlayersForGroups.filter(hasPlayerName);
    const playerGroupLookup = buildPlayerGroupLookup(pairingPlayers);
    const previousByes = getPlayersWithBye(previousRounds);
    const activePlayerIds = new Set(playersNeedingPairing.map(player => String(player.playerUniqueId)));
    const excludedPlayerIds = new Set([
        ...(options.excludedPlayerIds || []).map(String),
        ...pairingPlayers
            .map(player => String(player.playerUniqueId))
            .filter(playerId => !activePlayerIds.has(playerId)),
    ]);
    const groups = [...getGroupedPlayers(playersNeedingPairing).entries()]
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    const allGroups = getGroupedPlayers(pairingPlayers);
    const generated = [];

    for (let index = 0; index < groups.length; index += 1) {
        const [group, groupPlayers] = groups[index];
        if (groupPlayers.length === 0) continue;

        if (groupPlayers.length === 1) {
            const playerId = String(groupPlayers[0].playerUniqueId);
            generated.push({
                whiteId: playerId,
                blackId: null,
                isBye: true,
                isSkip: previousByes.has(playerId),
                group,
                result: previousByes.has(playerId) ? '0-0' : '1-0',
            });
            onProgress?.(Math.round(((index + 1) / groups.length) * 100));
            continue;
        }

        const groupRounds = filterRoundsForGroup(previousRounds, group, playerGroupLookup);
        const groupPairings = await generatePairings(
            allGroups.get(group) || groupPlayers,
            { ...options, excludedPlayerIds: [...excludedPlayerIds] },
            groupRounds,
            config,
            `${tournamentName} - ${group}`,
            (progress) => onProgress?.(Math.round(((index + (progress / 100)) / groups.length) * 100))
        );
        generated.push(...groupPairings.map(pairing => ({ ...pairing, group })));
    }

    return generated;
}

export default function RoundsTab() {
    const {
        activeTournamentId,
        tournamentConfig,
        updateTournamentConfig,
        rounds,
        updateRounds,
        isLoadingConfig,
        setActiveTab,
        activeTab
    } = useTournament();

    const [showConfigModal, setShowConfigModal] = useState(false);
    const [showSetupModal, setShowSetupModal] = useState(false);
    const [showManualPairingModal, setShowManualPairingModal] = useState(false);
    const [showForfeitModal, setShowForfeitModal] = useState(false);
    const [manualPairingMode, setManualPairingMode] = useState('create');
    const [pendingManualBoards, setPendingManualBoards] = useState(null);
    const [roundModalMode, setRoundModalMode] = useState('setup');
    const [modal, setModal] = useState({ open: false, title: '', description: '', details: [], onConfirm: null, isAlert: false, variant: 'primary', confirmText: 'Confirm' });
    const [currentRoundIdx, setCurrentRoundIdx] = useState(0);
    const [isPairing, setIsPairing] = useState(false);
    const [isManualPairing, setIsManualPairing] = useState(false);
    const [pairingProgress, setPairingProgress] = useState(0);
    const [players, setPlayers] = useState([]);
    const [scoreImportPhase, setScoreImportPhase] = useState('input');
    const [scoreRawData, setScoreRawData] = useState(null);
    const [scoreColumnMap, setScoreColumnMap] = useState({});
    const [scoreImportText, setScoreImportText] = useState('');
    const [scoreFileName, setScoreFileName] = useState('');
    const [scoreImportOpen, setScoreImportOpen] = useState(false);
    const [scoreRoundOptions, setScoreRoundOptions] = useState(DEFAULT_SCORE_ROUND_OPTIONS);
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [openPairingGroups, setOpenPairingGroups] = useState({});
    const [selectedForfeitPlayerId, setSelectedForfeitPlayerId] = useState('');
    const [pendingForfeitPlayerIds, setPendingForfeitPlayerIds] = useState([]);
    const [selectedReturnPlayerId, setSelectedReturnPlayerId] = useState('');
    const [pendingReturnPlayerIds, setPendingReturnPlayerIds] = useState([]);
    const scoreFileInputRef = useRef(null);
    const roundSelectorRef = useRef(null);

    // Load players for lookup
    useEffect(() => {
        if (activeTournamentId && activeTab === 'rounds') {
            loadPlayers(activeTournamentId).then(setPlayers);
        }
    }, [activeTournamentId, activeTab]);

    // Update currentRoundIdx to the latest round when rounds change
    useEffect(() => {
        if (rounds.length > 0) {
            setCurrentRoundIdx(rounds.length - 1);
        } else {
            setCurrentRoundIdx(0);
        }
    }, [rounds.length]);

    const currentRound = rounds[currentRoundIdx];
    const isLatestRound = currentRoundIdx === rounds.length - 1 || rounds.length === 0;

    const isRoundComplete = useMemo(() => {
        if (!currentRound) return true;
        return currentRound.pairings.every(p => getPairingResult(p) !== '');
    }, [currentRound]);

    const pairingBusy = isPairing || isManualPairing;

    const manualTargetRoundNumber = manualPairingMode === 'edit' && currentRound
        ? (currentRound.roundNumber || currentRoundIdx + 1)
        : rounds.length + 1;

    const manualPreviousRounds = manualPairingMode === 'edit'
        ? rounds.slice(0, currentRoundIdx)
        : rounds;

    const manualPlayerScores = useMemo(() => {
        return getPlayerScoreMap(manualPreviousRounds);
    }, [manualPreviousRounds]);

    const forfeitedPlayerIds = useMemo(() => {
        const forfeits = getTournamentForfeitSet(manualPreviousRounds);
        return manualPairingMode === 'create'
            ? getNextForfeitSet(forfeits, pendingForfeitPlayerIds, pendingReturnPlayerIds)
            : forfeits;
    }, [manualPairingMode, manualPreviousRounds, pendingForfeitPlayerIds, pendingReturnPlayerIds]);

    const manualInitialBoards = useMemo(() => {
        if (manualPairingMode !== 'edit' || !currentRound) return [];
        return currentRound.pairings.map(pairing => ({
            id: pairing.id,
            whiteId: pairing.isBye ? null : pairing.whiteId,
            blackId: pairing.isBye ? null : pairing.blackId,
            byeId: pairing.isBye && !pairing.isTournamentForfeit ? pairing.whiteId : null,
            forfeitId: pairing.isTournamentForfeit ? pairing.whiteId : null,
            isSkip: pairing.isSkip || false,
            group: pairing.group || '',
            manual: Boolean(pairing.manual),
        }));
    }, [currentRound, manualPairingMode]);

    const playerById = useMemo(() => {
        return players.reduce((acc, player) => {
            acc[String(player.playerUniqueId)] = player;
            return acc;
        }, {});
    }, [players]);

    const currentForfeitedPlayerIds = useMemo(() => getTournamentForfeitSet(rounds), [rounds]);
    const pendingManualForfeitPlayerIds = useMemo(() => (
        roundModalMode === 'manual-options' && pendingManualBoards
            ? getManualBoardForfeitIds(pendingManualBoards)
            : new Set()
    ), [pendingManualBoards, roundModalMode]);
    const pendingManualForfeitPlayerIdList = useMemo(() => (
        [...pendingManualForfeitPlayerIds]
    ), [pendingManualForfeitPlayerIds]);

    const pendingModalForfeitPlayerSet = useMemo(() => new Set(pendingForfeitPlayerIds.map(String)), [pendingForfeitPlayerIds]);
    const pendingForfeitPlayerSet = useMemo(() => new Set([
        ...pendingForfeitPlayerIds.map(String),
        ...pendingManualForfeitPlayerIdList,
    ]), [pendingForfeitPlayerIds, pendingManualForfeitPlayerIdList]);
    const pendingReturnPlayerSet = useMemo(() => new Set(pendingReturnPlayerIds.map(String)), [pendingReturnPlayerIds]);

    const nextRoundForfeitedPlayerIds = useMemo(() => {
        return getNextForfeitSet(
            currentForfeitedPlayerIds,
            [...pendingForfeitPlayerIds, ...pendingManualForfeitPlayerIdList],
            pendingReturnPlayerIds
        );
    }, [currentForfeitedPlayerIds, pendingForfeitPlayerIds, pendingManualForfeitPlayerIdList, pendingReturnPlayerIds]);

    const nextRoundExcludedPlayers = useMemo(() => {
        return [...nextRoundForfeitedPlayerIds]
            .map(playerId => playerById[playerId] || { playerUniqueId: playerId, name: `Player #${playerId}` })
            .sort((a, b) => Number(a.playerUniqueId) - Number(b.playerUniqueId));
    }, [nextRoundForfeitedPlayerIds, playerById]);

    const currentRoundUnassignedPlayers = useMemo(() => {
        if (!currentRound || rounds.length === 0) return [];

        const assignedIds = getRoundPlayerIds(currentRound);
        return players
            .filter(player => hasPlayerName(player) && !assignedIds.has(String(player.playerUniqueId)))
            .sort((a, b) => Number(a.playerUniqueId) - Number(b.playerUniqueId));
    }, [currentRound, players, rounds.length]);

    const unlockedMidTournamentPlayerIds = useMemo(() => {
        if (rounds.length === 0) return new Set();

        const assignedIds = getRoundsPlayerIds(rounds);
        return new Set(
            players
                .filter(player => hasPlayerName(player) && !assignedIds.has(String(player.playerUniqueId)))
                .map(player => String(player.playerUniqueId))
        );
    }, [players, rounds]);

    const nextRoundLockingPlayers = useMemo(() => {
        if (rounds.length === 0) return [];

        return players
            .filter(player => (
                unlockedMidTournamentPlayerIds.has(String(player.playerUniqueId)) &&
                !nextRoundForfeitedPlayerIds.has(String(player.playerUniqueId))
            ))
            .sort((a, b) => Number(a.playerUniqueId) - Number(b.playerUniqueId));
    }, [nextRoundForfeitedPlayerIds, players, rounds.length, unlockedMidTournamentPlayerIds]);

    const nextRoundForfeitCandidates = useMemo(() => {
        const pendingAssignedIds = roundModalMode === 'manual-options' && pendingManualBoards
            ? getManualBoardPlayerIds(pendingManualBoards)
            : new Set();

        return players
            .filter(player => {
                const playerId = String(player.playerUniqueId);
                return hasPlayerName(player) &&
                    !currentForfeitedPlayerIds.has(playerId) &&
                    !pendingForfeitPlayerSet.has(playerId) &&
                    !pendingAssignedIds.has(playerId);
            })
            .sort((a, b) => Number(a.playerUniqueId) - Number(b.playerUniqueId));
    }, [currentForfeitedPlayerIds, pendingForfeitPlayerSet, pendingManualBoards, players, roundModalMode]);

    const forfeitReturnCandidates = useMemo(() => {
        return [...currentForfeitedPlayerIds]
            .filter(playerId => !pendingReturnPlayerSet.has(playerId))
            .map(playerId => playerById[playerId] || { playerUniqueId: playerId, name: `Player #${playerId}` })
            .sort((a, b) => Number(a.playerUniqueId) - Number(b.playerUniqueId));
    }, [currentForfeitedPlayerIds, pendingReturnPlayerSet, playerById]);

    const pendingForfeitPlayers = useMemo(() => {
        return pendingForfeitPlayerIds
            .map(playerId => playerById[String(playerId)])
            .filter(Boolean)
            .sort((a, b) => Number(a.playerUniqueId) - Number(b.playerUniqueId));
    }, [pendingForfeitPlayerIds, playerById]);

    const pendingManualForfeitPlayers = useMemo(() => {
        return pendingManualForfeitPlayerIdList
            .filter(playerId => !pendingModalForfeitPlayerSet.has(String(playerId)))
            .map(playerId => playerById[String(playerId)])
            .filter(Boolean)
            .sort((a, b) => Number(a.playerUniqueId) - Number(b.playerUniqueId));
    }, [pendingManualForfeitPlayerIdList, pendingModalForfeitPlayerSet, playerById]);

    const pendingReturnPlayers = useMemo(() => {
        return pendingReturnPlayerIds
            .map(playerId => playerById[String(playerId)] || { playerUniqueId: playerId, name: `Player #${playerId}` })
            .sort((a, b) => Number(a.playerUniqueId) - Number(b.playerUniqueId));
    }, [pendingReturnPlayerIds, playerById]);

    useEffect(() => {
        const candidateIds = new Set(nextRoundForfeitCandidates.map(player => String(player.playerUniqueId)));
        setSelectedForfeitPlayerId(prev => candidateIds.has(String(prev)) ? prev : '');
        setPendingForfeitPlayerIds(prev => {
            const next = prev.filter(playerId => playerById[String(playerId)] && !currentForfeitedPlayerIds.has(String(playerId)));
            return next.length === prev.length ? prev : next;
        });
    }, [currentForfeitedPlayerIds, nextRoundForfeitCandidates, playerById]);

    useEffect(() => {
        const candidateIds = new Set(forfeitReturnCandidates.map(player => String(player.playerUniqueId)));
        setSelectedReturnPlayerId(prev => candidateIds.has(String(prev)) ? prev : '');
        setPendingReturnPlayerIds(prev => {
            const next = prev.filter(playerId => currentForfeitedPlayerIds.has(String(playerId)));
            return next.length === prev.length ? prev : next;
        });
    }, [currentForfeitedPlayerIds, forfeitReturnCandidates]);

    const validateGroupPairingPlayers = (activePlayers, title = 'Pairing Blocked') => {
        const blankGroupPlayers = getBlankGroupPlayers(activePlayers);
        if (blankGroupPlayers.length) {
            showAlert(
                title,
                'Every active player must have a Group before using By Group pairing.',
                blankGroupPlayers.map(player => ({
                    line: player.playerUniqueId,
                    reason: `${player.name || 'Unnamed'} has no group.`
                }))
            );
            return false;
        }
        return true;
    };

    const getRoundCountWarningForPlayers = (activePlayers, configuredRounds, config = tournamentConfig) => {
        if (activePlayers.length < 2) {
            return {
                message: 'Add at least 2 active players before starting the first round.',
                details: [],
            };
        }

        if (isGroupPairingMode(config)) {
            const blankGroupPlayers = getBlankGroupPlayers(activePlayers);
            if (blankGroupPlayers.length) {
                return {
                    message: 'Every active player must have a Group before using By Group pairing.',
                    details: blankGroupPlayers.map(player => ({
                        line: player.playerUniqueId,
                        reason: `${player.name || 'Unnamed'} has no group.`
                    })),
                };
            }

            const invalidGroups = [...getGroupedPlayers(activePlayers).entries()]
                .map(([group, groupPlayers]) => ({
                    group,
                    playerCount: groupPlayers.length,
                    maxRounds: getMaximumRoundCount(groupPlayers.length),
                }))
                .filter(groupInfo => groupInfo.playerCount < 2 || configuredRounds > groupInfo.maxRounds);

            if (invalidGroups.length) {
                return {
                    message: 'Round count must be valid for every group.',
                    details: invalidGroups.map(groupInfo => ({
                        line: groupInfo.group,
                        reason: groupInfo.playerCount < 2
                            ? `Group ${groupInfo.group} needs at least 2 active players.`
                            : `Group ${groupInfo.group} has ${groupInfo.playerCount} players, so it supports at most ${groupInfo.maxRounds} round${groupInfo.maxRounds !== 1 ? 's' : ''}.`
                    })),
                };
            }

            return null;
        }

        const maxRounds = getMaximumRoundCount(activePlayers.length);
        if (configuredRounds > maxRounds) {
            return {
                message: `This tournament has ${activePlayers.length} players, so the round count cannot be greater than ${maxRounds}.`,
                details: [],
            };
        }

        return null;
    };

    const generatePairingsForMode = async (activePlayers, options, previousRounds, config, tournamentName, onProgress, allPlayersForGroups = activePlayers) => {
        const activePlayerIds = new Set((activePlayers || []).map(player => String(player.playerUniqueId)));
        const pairingPlayers = (allPlayersForGroups || activePlayers || []).filter(hasPlayerName);
        const excludedPlayerIds = new Set([
            ...(options.excludedPlayerIds || []).map(String),
            ...pairingPlayers
                .map(player => String(player.playerUniqueId))
                .filter(playerId => !activePlayerIds.has(playerId)),
        ]);
        const pairingOptions = { ...options, excludedPlayerIds: [...excludedPlayerIds] };

        if (!isGroupPairingMode(config)) {
            return generatePairings(pairingPlayers, pairingOptions, previousRounds, config, tournamentName, onProgress);
        }

        const playerGroupLookup = buildPlayerGroupLookup(pairingPlayers);
        const groups = [...getGroupedPlayers(activePlayers).entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
        const allGroups = getGroupedPlayers(pairingPlayers);
        const generated = [];

        for (let index = 0; index < groups.length; index += 1) {
            const [group, groupPlayers] = groups[index];
            const groupPairingPlayers = allGroups.get(group) || groupPlayers;
            const groupRounds = filterRoundsForGroup(previousRounds, group, playerGroupLookup);
            const groupPairings = await generatePairings(
                groupPairingPlayers,
                pairingOptions,
                groupRounds,
                config,
                `${tournamentName} - ${group}`,
                (progress) => onProgress?.(Math.round(((index + (progress / 100)) / groups.length) * 100))
            );
            generated.push(...groupPairings.map(pairing => ({ ...pairing, group })));
        }

        return enforceSingleRoundBye(generated, pairing => pairing.group || '');
    };

    const getPreRoundForfeitOptions = () => ({
        newForfeitPlayerIds: pendingForfeitPlayerIds,
        returnedForfeitPlayerIds: pendingReturnPlayerIds,
    });

    const clearPreRoundForfeitAssignments = () => {
        setSelectedForfeitPlayerId('');
        setPendingForfeitPlayerIds([]);
        setSelectedReturnPlayerId('');
        setPendingReturnPlayerIds([]);
    };

    const addPendingForfeitPlayer = () => {
        if (!selectedForfeitPlayerId) return;
        setPendingForfeitPlayerIds(prev => prev.includes(selectedForfeitPlayerId) ? prev : [...prev, selectedForfeitPlayerId]);
        setSelectedForfeitPlayerId('');
    };

    const removePendingForfeitPlayer = (playerId) => {
        setPendingForfeitPlayerIds(prev => prev.filter(candidate => String(candidate) !== String(playerId)));
    };

    const addPendingReturnPlayer = () => {
        if (!selectedReturnPlayerId) return;
        setPendingReturnPlayerIds(prev => prev.includes(selectedReturnPlayerId) ? prev : [...prev, selectedReturnPlayerId]);
        setSelectedReturnPlayerId('');
    };

    const removePendingReturnPlayer = (playerId) => {
        setPendingReturnPlayerIds(prev => prev.filter(candidate => String(candidate) !== String(playerId)));
    };

    const openForfeitModal = async () => {
        try {
            const latestPlayers = await loadPlayers(activeTournamentId);
            setPlayers(latestPlayers);
        } catch {
            showAlert('Forfeit Setup Blocked', 'Could not load players to update forfeit assignments.');
            return;
        }

        setShowForfeitModal(true);
    };

    const openRoundSetup = async () => {
        let latestPlayers;
        try {
            latestPlayers = await loadPlayers(activeTournamentId);
        } catch {
            showAlert('Next Round Blocked', 'Could not load players to check for unassigned players.');
            return;
        }

        setPlayers(latestPlayers);
        setRoundModalMode('setup');
        setShowSetupModal(true);
    };

    const handleStartPairing = async (options) => {
        setIsPairing(true);

        try {
            // 1. Get current players
            const latestPlayers = await loadPlayers(activeTournamentId);
            setPlayers(latestPlayers); // Sync local state for lookup
            const forfeitedIds = getTournamentForfeitSet(rounds);
            const newForfeitedIds = new Set((options.newForfeitPlayerIds || []).map(String));
            const returnedForfeitIds = new Set((options.returnedForfeitPlayerIds || []).map(String));
            const excludedForfeitIds = getNextForfeitSet(forfeitedIds, newForfeitedIds, returnedForfeitIds);
            const pairablePlayers = latestPlayers.filter(hasPlayerName);
            const activePlayers = getActivePairablePlayers(latestPlayers, excludedForfeitIds);
            const continuingForfeits = buildContinuingForfeitPairings(excludedForfeitIds);
            const roundsWithPlayerSkips = addMissingPlayerSkips(rounds, getActivePairablePlayers(latestPlayers, forfeitedIds));

            if (rounds.length === 0) {
                const configuredRounds = Number(tournamentConfig?.numRounds) || 0;

                if (getRoundCountWarningForPlayers(activePlayers, configuredRounds)) return;
            } else if (isGroupPairingMode(tournamentConfig) && !validateGroupPairingPlayers(activePlayers, 'Pairing Blocked')) {
                return;
            }

            setShowSetupModal(false);

            // 2. Generate pairings
            const tournamentName = tournamentConfig?.name || "Tournament";
            const newPairings = await generatePairingsForMode(
                activePlayers,
                { ...options, excludedPlayerIds: [...excludedForfeitIds] },
                roundsWithPlayerSkips, 
                tournamentConfig, 
                tournamentName,
                (p) => setPairingProgress(p),
                pairablePlayers
            );

            // 3. Add new round
            const roundNumber = roundsWithPlayerSkips.length + 1;
            const playerGroupLookup = buildPlayerGroupLookup(latestPlayers);
            const newRound = {
                roundNumber,
                pairings: enforceSingleRoundBye(
                    withPairingGroups([...newPairings, ...continuingForfeits], playerGroupLookup),
                    isGroupPairingMode(tournamentConfig) ? pairing => getPairingGroup(pairing, playerGroupLookup) : null
                ).map((p, idx) => ({
                    id: `r${roundNumber}-p${idx + 1}`,
                    ...p,
                    result: getFinalPairingResult(p)
                })),
                status: 'in-progress',
                timestamp: createRoundTimestamp(),
                returnedForfeitPlayerIds: [...returnedForfeitIds],
                options
            };

            updateRounds([...roundsWithPlayerSkips, newRound]);
            clearPreRoundForfeitAssignments();
        } catch {
            showAlert('Pairing Failed', 'Could not generate pairings for this round.');
        } finally {
            setIsPairing(false);
        }
    };

    const handleRoundSetupStart = (options) => {
        const optionsWithPreAssignments = {
            ...options,
            ...getPreRoundForfeitOptions(),
        };
        if (roundModalMode === 'manual-options' && pendingManualBoards) {
            handleManualPairingSave(pendingManualBoards, optionsWithPreAssignments);
            return;
        }
        handleStartPairing(optionsWithPreAssignments);
    };

    const handleRoundSetupClose = () => {
        if (roundModalMode === 'manual-options') {
            setPendingManualBoards(null);
            setRoundModalMode('setup');
        }
        setShowSetupModal(false);
    };

    const openManualPairing = async (mode) => {
        if (mode === 'edit' && !isLatestRound) {
            showAlert('Cannot Change Pairing', 'Pairings can only be changed on the latest round. Delete later rounds first.');
            return;
        }

        const latestPlayers = await loadPlayers(activeTournamentId);
        setPlayers(latestPlayers);
        setManualPairingMode(mode);
        setShowManualPairingModal(true);
    };

    const stageManualPairingSave = (boards, { pairRest = true } = {}) => {
        if (manualPairingMode === 'edit') {
            handleManualPairingSave(boards, currentRound?.options || {}, { pairRest });
            return;
        }
        if (!pairRest) {
            handleManualPairingSave(boards, { manualRemainder: false, ...getPreRoundForfeitOptions() }, { pairRest: false });
            return;
        }
        setPendingManualBoards(boards);
        setShowManualPairingModal(false);
        setRoundModalMode('manual-options');
        setShowSetupModal(true);
    };

    const handleManualPairingSave = async (boards, options = {}, { pairRest = true } = {}) => {
        setIsManualPairing(true);
        setPairingProgress(0);
        setShowSetupModal(false);

        try {
            const latestPlayers = await loadPlayers(activeTournamentId);
            setPlayers(latestPlayers);
            const latestPlayerGroupLookup = buildPlayerGroupLookup(latestPlayers);
            const requestedForfeitIds = new Set((options.newForfeitPlayerIds || []).map(String));
            const requestedReturnIds = new Set((options.returnedForfeitPlayerIds || []).map(String));

            if (manualPairingMode !== 'edit' && rounds.length === 0) {
                const configuredRounds = Number(tournamentConfig?.numRounds) || 0;
                const activePlayers = getActivePairablePlayers(
                    latestPlayers,
                    getNextForfeitSet(getTournamentForfeitSet(rounds), requestedForfeitIds, requestedReturnIds)
                );

                if (getRoundCountWarningForPlayers(activePlayers, configuredRounds)) return;
            }

            let normalizedBoards = boards
                .map(board => ({
                    whiteId: board.whiteId ? String(board.whiteId) : null,
                    blackId: board.blackId ? String(board.blackId) : null,
                    byeId: board.byeId ? String(board.byeId) : null,
                    forfeitId: board.forfeitId ? String(board.forfeitId) : null,
                    isSkip: Boolean(board.isSkip),
                    group: board.group || '',
                }))
                .filter(board => board.whiteId || board.blackId || board.byeId || board.forfeitId)
                .map(board => ({
                    ...board,
                    group: getPairingGroup({
                        group: board.group,
                        whiteId: board.whiteId || board.byeId || board.forfeitId,
                        blackId: board.blackId,
                    }, latestPlayerGroupLookup),
                }));

            const boardForfeitIds = new Set(normalizedBoards.map(board => board.forfeitId).filter(Boolean));
            const setupForfeitBoards = [...requestedForfeitIds]
                .filter(playerId => !boardForfeitIds.has(playerId))
                .map(playerId => ({
                    whiteId: null,
                    blackId: null,
                    byeId: null,
                    forfeitId: playerId,
                    isSkip: true,
                    group: latestPlayerGroupLookup[playerId] || '',
                }));
            normalizedBoards = [...normalizedBoards, ...setupForfeitBoards];

            const usedIds = new Set();
            normalizedBoards.forEach(board => {
                [board.whiteId, board.blackId, board.byeId, board.forfeitId].filter(Boolean).forEach(id => usedIds.add(String(id)));
            });

            const pairableLatestPlayers = latestPlayers.filter(hasPlayerName);
            const roundsWithPlayerSkips = manualPairingMode === 'edit'
                ? rounds
                : addMissingPlayerSkips(rounds, pairableLatestPlayers);
            const previousRounds = manualPairingMode === 'edit' ? rounds.slice(0, currentRoundIdx) : roundsWithPlayerSkips;
            const alreadyForfeited = getTournamentForfeitSet(previousRounds);
            const activeForfeitedForRound = getNextForfeitSet(alreadyForfeited, requestedForfeitIds, requestedReturnIds);
            const remainingPlayers = latestPlayers.filter(player => (
                hasPlayerName(player) &&
                !usedIds.has(String(player.playerUniqueId)) &&
                !activeForfeitedForRound.has(String(player.playerUniqueId))
            ));
            const errors = validateManualPairings(normalizedBoards, previousRounds, {
                getByeScope: isGroupPairingMode(tournamentConfig)
                    ? board => getPairingGroup({ group: board.group, whiteId: board.byeId }, latestPlayerGroupLookup)
                    : null,
            });
            if (isGroupPairingMode(tournamentConfig)) {
                normalizedBoards.forEach((board, index) => {
                    if (!board.whiteId || !board.blackId) return;
                    const whiteGroup = latestPlayerGroupLookup[board.whiteId] || '';
                    const blackGroup = latestPlayerGroupLookup[board.blackId] || '';
                    if (whiteGroup !== blackGroup) {
                        errors.push(`Board ${index + 1} has players from different groups.`);
                    }
                });
                if (!validateGroupPairingPlayers(
                    getActivePairablePlayers(latestPlayers, activeForfeitedForRound),
                    'Manual Pairing Blocked'
                )) return;
            }

            if (errors.length > 0) {
                showAlert('Manual Pairing Blocked', 'Fix these pairing issues before saving.', errors.map((reason, index) => ({ line: index + 1, reason })));
                return;
            }

            const originalPairings = manualPairingMode === 'edit' ? (currentRound?.pairings || []) : [];
            const {
                preservedPairings,
                remainingPlayers: playersNeedingPairing,
            } = manualPairingMode === 'edit' && pairRest
                ? preserveOriginalRemainderPairings(remainingPlayers, originalPairings)
                : { preservedPairings: [], remainingPlayers };

            const tournamentName = tournamentConfig?.name || 'Tournament';
            const generatedPairings = pairRest && playersNeedingPairing.length > 0
                ? isGroupPairingMode(tournamentConfig)
                    ? await generateManualRemainderPairingsByGroup(
                        playersNeedingPairing,
                        { ...options, manualRemainder: true },
                        previousRounds,
                        tournamentConfig,
                        tournamentName,
                        (p) => setPairingProgress(p),
                        latestPlayers
                    )
                    : await generatePairingsForMode(
                        playersNeedingPairing,
                        { ...options, manualRemainder: true },
                        previousRounds,
                        tournamentConfig,
                        tournamentName,
                        (p) => setPairingProgress(p),
                        latestPlayers
                    )
                : [];
            const continuingForfeits = manualPairingMode === 'edit'
                ? []
                : buildContinuingForfeitPairings(activeForfeitedForRound, usedIds);

            const roundNumber = manualPairingMode === 'edit' && currentRound
                ? (currentRound.roundNumber || currentRoundIdx + 1)
                : roundsWithPlayerSkips.length + 1;
            const mergedPairings = mergeManualAndGeneratedPairings(
                normalizedBoards,
                [...preservedPairings, ...generatedPairings, ...continuingForfeits],
                roundNumber,
                originalPairings,
                latestPlayerGroupLookup,
                { enforceByeByGroup: isGroupPairingMode(tournamentConfig) }
            ).map(pairing => ({
                ...pairing,
                group: getPairingGroup(pairing, latestPlayerGroupLookup),
            }));

            if (manualPairingMode === 'edit') {
                const currentRoundPlayerIds = getRoundPlayerIds({ pairings: mergedPairings });
                const currentRoundPlayers = latestPlayers.filter(player => currentRoundPlayerIds.has(String(player.playerUniqueId)));
                const previousRoundsWithPlayerSkips = addMissingPlayerSkips(
                    rounds.slice(0, currentRoundIdx),
                    currentRoundPlayers
                );
                const updatedCurrentRound = {
                    ...currentRound,
                    pairings: mergedPairings,
                    options: { ...(currentRound.options || {}), ...options, manualPairing: true },
                };
                const updatedRounds = [
                    ...previousRoundsWithPlayerSkips,
                    updatedCurrentRound,
                    ...rounds.slice(currentRoundIdx + 1),
                ];
                updateRounds(updatedRounds);
            } else {
                const newRound = {
                    roundNumber,
                    pairings: mergedPairings,
                    status: 'in-progress',
                    returnedForfeitPlayerIds: [...requestedReturnIds],
                    options: { ...options, manualPairing: true }
                };
                updateRounds([...roundsWithPlayerSkips, newRound]);
            }

            setShowManualPairingModal(false);
            setPendingManualBoards(null);
            setRoundModalMode('setup');
            clearPreRoundForfeitAssignments();
        } catch (error) {
            showAlert('Manual Pairing Failed', error?.message || 'Could not generate the automatic remainder.');
        } finally {
            setIsManualPairing(false);
            setPairingProgress(0);
        }
    };

    const updateResult = (pairingId, result) => {
        const updatedRounds = rounds.map((r, rIdx) => {
            if (rIdx === currentRoundIdx) {
                return {
                    ...r,
                    pairings: r.pairings.map(p =>
                        p.id === pairingId && !p.isTournamentForfeit ? { ...p, result } : p
                    )
                };
            }
            return r;
        });
        updateRounds(updatedRounds);
    };

    const advanceToScoreMapping = (data) => {
        setScoreRawData(data);
        setScoreColumnMap(suggestScoreMapping(data.headers));
        setScoreImportPhase('mapping');
    };

    const handleScoreFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setScoreFileName(file.name);
        setScoreImportText('');

        if (/\.(xlsx|xls)$/i.test(file.name)) {
            file.arrayBuffer().then(buf => {
                const data = parseScoreExcel(buf);
                if (data) advanceToScoreMapping(data);
            });
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target.result ?? '';
                setScoreImportText(text);
                const data = parseScoreRawData(text);
                if (data) advanceToScoreMapping(data);
            };
            reader.readAsText(file, 'utf-8');
        }
    };

    const resetScoreImportState = () => {
        setScoreImportPhase('input');
        setScoreRawData(null);
        setScoreColumnMap({});
        setScoreImportText('');
        setScoreFileName('');
        setScoreRoundOptions(DEFAULT_SCORE_ROUND_OPTIONS);
        if (scoreFileInputRef.current) scoreFileInputRef.current.value = '';
    };

    const getScoreImportRows = () => {
        if (!scoreRawData) return [];
        return scoreRawData.rows.map((row, index) => {
            const values = { __index: index, __raw: row };
            Object.entries(scoreColumnMap).forEach(([idxStr, field]) => {
                if (!field) return;
                values[field] = String(row[parseInt(idxStr, 10)] ?? '').trim();
            });
            values.roundNumber = parseImportedRound(values.round);
            values.whiteId = parseImportedPlayerId(values.whiteId);
            values.blackId = parseImportedPlayerId(values.blackId);
            return values;
        });
    };

    const formatSkippedScoreRow = (row, reason) => ({
        line: row.__index + 2,
        reason,
        raw: (row.__raw || []).join(';')
    });

    const applyRowsToPairings = (pairings, rowsForRound) => {
        const byBoard = new Map();
        const byPlayers = new Map();
        const matchedRows = new Set();
        const skippedRows = [];

        rowsForRound.forEach(row => {
            if (row.board) byBoard.set(String(parseInt(row.board, 10)), row);
            if (row.whiteId) byPlayers.set(`${row.whiteId}|${row.blackId || ''}`, row);
        });

        let imported = 0;
        let skipped = 0;
        const pairingsWithResults = pairings.map((pairing, index) => {
            const row = byBoard.get(String(index + 1))
                ?? byPlayers.get(`${pairing.whiteId}|${pairing.blackId || ''}`)
                ?? rowsForRound[index];

            if (!row) {
                return pairing;
            }
            matchedRows.add(row.__index);

            const result = scoreResultFromRow(row);
            if (!result) {
                skipped += 1;
                skippedRows.push(formatSkippedScoreRow(row, 'No valid result'));
                return pairing;
            }

            imported += 1;
            return { ...pairing, result };
        });

        rowsForRound.forEach(row => {
            if (!matchedRows.has(row.__index)) {
                skipped += 1;
                skippedRows.push(formatSkippedScoreRow(row, 'No matching pairing'));
            }
        });

        return { pairings: pairingsWithResults, imported, skipped, skippedRows };
    };

    const getImportedRowPlayerIds = (rowsForRound) => {
        const ids = new Set();
        rowsForRound.forEach(row => {
            if (row.whiteId) ids.add(String(row.whiteId));
            if (row.blackId) ids.add(String(row.blackId));
        });
        return ids;
    };

    const createPairingsFromRows = (roundNumber, rowsForRound, { markMissingPlayersAsSkips = false } = {}) => {
        let imported = 0;
        let skipped = 0;
        const skippedRows = [];
        const importPlayerGroupLookup = buildPlayerGroupLookup(players);
        const importedPlayerIds = getImportedRowPlayerIds(rowsForRound);
        const sortedRows = [...rowsForRound].sort((a, b) => {
            const aBoard = parseInt(a.board, 10);
            const bBoard = parseInt(b.board, 10);
            if (Number.isFinite(aBoard) && Number.isFinite(bBoard)) return aBoard - bBoard;
            return a.__index - b.__index;
        });

        const pairings = sortedRows.map((row, index) => {
            const result = scoreResultFromRow(row);
            if (!row.whiteId || !result) {
                skipped += 1;
                skippedRows.push(formatSkippedScoreRow(row, !row.whiteId ? 'Missing player ID' : 'No valid result'));
                return null;
            }

            imported += 1;
            return {
                id: `r${roundNumber}-p${index + 1}`,
                whiteId: row.whiteId,
                blackId: row.blackId || null,
                isBye: !row.blackId,
                group: importPlayerGroupLookup[row.whiteId] || importPlayerGroupLookup[row.blackId] || '',
                result
            };
        }).filter(Boolean);

        if (markMissingPlayersAsSkips && importedPlayerIds.size > 0) {
            const usedIds = getRoundPlayerIds({ pairings });
            players.forEach(player => {
                const playerId = String(player.playerUniqueId);
                if (!playerId || importedPlayerIds.has(playerId) || usedIds.has(playerId)) return;
                pairings.push({
                    id: `r${roundNumber}-p${pairings.length + 1}`,
                    whiteId: playerId,
                    blackId: null,
                    isBye: true,
                    isSkip: true,
                    group: importPlayerGroupLookup[playerId] || '',
                    result: '0-0',
                });
            });
        }

        return { pairings, imported, skipped, skippedRows };
    };

    const createRoundFromRows = (roundNumber, rowsForRound) => {
        const created = createPairingsFromRows(roundNumber, rowsForRound, { markMissingPlayersAsSkips: true });

        return {
            round: {
                roundNumber,
                pairings: created.pairings,
                status: 'in-progress',
                timestamp: createRoundTimestamp(),
                options: { imported: true }
            },
            imported: created.imported,
            skipped: created.skipped,
            skippedRows: created.skippedRows
        };
    };

    const handleScoreImportDecision = () => {
        const rows = getScoreImportRows();
        const roundNumbers = [...new Set(rows.map(row => row.roundNumber).filter(Boolean))].sort((a, b) => a - b);
        const configuredRounds = tournamentConfig?.numRounds || 0;
        const maxImportedRound = Math.max(0, ...roundNumbers);

        if (roundNumbers.length > 1 || maxImportedRound > configuredRounds) {
            setScoreRoundOptions({
                ...DEFAULT_SCORE_ROUND_OPTIONS,
                importAllRounds: true,
                selectedRoundNumbers: roundNumbers,
                roundLimitAction: maxImportedRound > configuredRounds ? 'cap' : DEFAULT_SCORE_ROUND_OPTIONS.roundLimitAction
            });
            setScoreImportPhase('round-options');
            return;
        }

        applyScoreImport({ importAllRounds: false, overwritePrevious: true });
    };

    const applyScoreImport = ({ importAllRounds = false, overwritePrevious = false, selectedRoundNumbers = [], roundLimitAction = 'cap' } = {}) => {
        if (!currentRound || !scoreRawData) {
            resetScoreImportState();
            return;
        }

        const rows = getScoreImportRows();
        const configuredRounds = tournamentConfig?.numRounds || 0;
        const importedRoundNumbers = [...new Set(rows.map(row => row.roundNumber).filter(Boolean))];
        const maxImportedRound = Math.max(0, ...importedRoundNumbers);
        const selectedRoundSet = new Set(selectedRoundNumbers);
        const hasSelectedRounds = selectedRoundSet.size > 0;
        const multiRoundImport = importAllRounds || hasSelectedRounds;
        const selectedMaxRound = hasSelectedRounds ? Math.max(...selectedRoundSet) : maxImportedRound;
        const shouldIncreaseRounds = multiRoundImport && roundLimitAction === 'increase' && selectedMaxRound > configuredRounds;
        const validPlayers = players.filter(hasPlayerName);
        const maxRounds = getMaximumRoundCountForMode(validPlayers, tournamentConfig);

        if (shouldIncreaseRounds && selectedMaxRound > maxRounds) {
            showAlert(
                'Score Import Blocked',
                isGroupPairingMode(tournamentConfig)
                    ? `By Group pairing supports at most ${maxRounds} round${maxRounds !== 1 ? 's' : ''} with the current groups.`
                    : `This tournament has ${validPlayers.length} active players, so the round count cannot be greater than ${maxRounds}.`
            );
            return;
        }

        const cappedRows = multiRoundImport && roundLimitAction === 'cap' && configuredRounds > 0
            ? rows.filter(row => !row.roundNumber || row.roundNumber <= configuredRounds)
            : rows;
        const effectiveRows = hasSelectedRounds
            ? cappedRows.filter(row => row.roundNumber && selectedRoundSet.has(row.roundNumber))
            : cappedRows;
        let imported = 0;
        let skipped = 0;
        let updatedRounds;
        const importedRounds = new Set();
        const skippedRows = [];
        const cappedIndexes = new Set(cappedRows.map(row => row.__index));
        const effectiveIndexes = new Set(effectiveRows.map(row => row.__index));

        rows.forEach(row => {
            if (!cappedIndexes.has(row.__index)) {
                skipped += 1;
                skippedRows.push(formatSkippedScoreRow(row, `Round exceeds configured limit (${configuredRounds})`));
            } else if (!effectiveIndexes.has(row.__index)) {
                skipped += 1;
                skippedRows.push(formatSkippedScoreRow(row, hasSelectedRounds ? 'Round not selected' : 'Not included in import'));
            }
        });

        if (multiRoundImport) {
            const rowsByRound = new Map();
            effectiveRows.forEach(row => {
                if (!row.roundNumber) {
                    skipped += 1;
                    skippedRows.push(formatSkippedScoreRow(row, 'Missing round number'));
                    return;
                }
                if (!rowsByRound.has(row.roundNumber)) rowsByRound.set(row.roundNumber, []);
                rowsByRound.get(row.roundNumber).push(row);
            });

            updatedRounds = rounds.map((round, roundIdx) => {
                const roundNumber = round.roundNumber || roundIdx + 1;
                const rowsForRound = rowsByRound.get(roundNumber);
                if (!rowsForRound) return round;
                if (roundIdx < currentRoundIdx && !overwritePrevious) return round;

                const applied = rowsForRound.some(row => row.whiteId)
                    ? createPairingsFromRows(roundNumber, rowsForRound, { markMissingPlayersAsSkips: true })
                    : applyRowsToPairings(round.pairings, rowsForRound);
                imported += applied.imported;
                skipped += applied.skipped;
                skippedRows.push(...applied.skippedRows);
                if (applied.imported > 0) importedRounds.add(roundNumber);
                return { ...round, pairings: applied.pairings };
            });

            const existingRoundNumbers = new Set(updatedRounds.map((round, idx) => round.roundNumber || idx + 1));
            const missingRoundNumbers = [...rowsByRound.keys()]
                .filter(roundNumber => !existingRoundNumbers.has(roundNumber))
                .sort((a, b) => a - b);

            missingRoundNumbers.forEach(roundNumber => {
                const created = createRoundFromRows(roundNumber, rowsByRound.get(roundNumber));
                imported += created.imported;
                skipped += created.skipped;
                skippedRows.push(...created.skippedRows);
                if (created.imported > 0) importedRounds.add(roundNumber);
                if (created.round.pairings.length > 0) updatedRounds.push(created.round);
            });

            updatedRounds.sort((a, b) => a.roundNumber - b.roundNumber);
        } else {
            const currentRoundNumber = currentRound.roundNumber || currentRoundIdx + 1;
            const rowsForCurrentRound = effectiveRows.some(row => row.roundNumber)
                ? effectiveRows.filter(row => row.roundNumber === currentRoundNumber)
                : effectiveRows;
            const currentRoundIndexes = new Set(rowsForCurrentRound.map(row => row.__index));
            effectiveRows.forEach(row => {
                if (row.roundNumber && !currentRoundIndexes.has(row.__index)) {
                    skipped += 1;
                    skippedRows.push(formatSkippedScoreRow(row, `Not for current round (${currentRoundNumber})`));
                }
            });

            updatedRounds = rounds.map((round, roundIdx) => {
                if (roundIdx !== currentRoundIdx) return round;

                const applied = rowsForCurrentRound.some(row => row.whiteId)
                    ? createPairingsFromRows(currentRoundNumber, rowsForCurrentRound, { markMissingPlayersAsSkips: true })
                    : applyRowsToPairings(round.pairings, rowsForCurrentRound);
                imported += applied.imported;
                skipped += applied.skipped;
                skippedRows.push(...applied.skippedRows);
                if (applied.imported > 0) importedRounds.add(currentRoundNumber);
                return { ...round, pairings: applied.pairings };
            });
        }

        if (shouldIncreaseRounds) {
            updateTournamentConfig({
                ...tournamentConfig,
                numRounds: selectedMaxRound
            });
        }
        updateRounds(updatedRounds);
        setScoreImportOpen(false);
        resetScoreImportState();
        const importedRoundLabel = importedRounds.size
            ? ` Imported round${importedRounds.size !== 1 ? 's' : ''}: ${[...importedRounds].sort((a, b) => a - b).join(', ')}.`
            : '';
        showAlert(
            'Scores imported',
            `Imported ${imported} result${imported !== 1 ? 's' : ''}${skipped ? ` and skipped ${skipped} row${skipped !== 1 ? 's' : ''}` : ''}.${importedRoundLabel}`,
            skippedRows
        );
    };

    const handleExportTrf = async () => {
        try {
            const latestPlayers = await loadPlayers(activeTournamentId);
            setPlayers(latestPlayers);

            if (!latestPlayers.length) {
                showAlert('TRF Export Failed', 'Add players before exporting a TRF file.');
                return;
            }

            const tournamentName = tournamentConfig?.name || 'Tournament';
            const safeName = tournamentName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'tournament';

            if (isGroupPairingMode(tournamentConfig)) {
                const blankGroupPlayers = getBlankGroupPlayers(latestPlayers);
                if (blankGroupPlayers.length) {
                    showAlert(
                        'TRF Export Failed',
                        'Every player must have a Group before exporting grouped TRF files.',
                        blankGroupPlayers.map(player => ({ line: player.playerUniqueId, reason: `${player.name || 'Unnamed'} has no group.` }))
                    );
                    return;
                }

                const zip = new JSZip();
                const playerGroupLookup = buildPlayerGroupLookup(latestPlayers);
                [...getGroupedPlayers(latestPlayers).entries()]
                    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
                    .forEach(([group, groupPlayers]) => {
                        const groupRounds = filterRoundsForGroup(rounds, group, playerGroupLookup);
                        const groupSafeName = String(group)
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, '-')
                            .replace(/^-+|-+$/g, '') || 'group';
                        zip.file(`${safeName}-${groupSafeName}.trf`, exportTournamentTrf(
                            groupPlayers,
                            groupRounds,
                            tournamentConfig,
                            `${tournamentName} - ${group}`
                        ));
                    });

                const blob = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(blob);
                Object.assign(document.createElement('a'), { href: url, download: `${safeName}-groups-trf.zip` }).click();
                URL.revokeObjectURL(url);
                return;
            }

            const trf = exportTournamentTrf(latestPlayers, rounds, tournamentConfig, tournamentName);
            const url = URL.createObjectURL(new Blob([trf], { type: 'text/plain;charset=utf-8' }));
            Object.assign(document.createElement('a'), { href: url, download: `${safeName}.trf` }).click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export TRF:', error);
            showAlert('TRF Export Failed', error?.message || 'Could not export this tournament as TRF.');
        }
    };

    const nextRound = () => {
        if (currentRoundIdx < rounds.length - 1) {
            setCurrentRoundIdx(prev => prev + 1);
        }
    };

    const prevRound = () => {
        if (currentRoundIdx > 0) {
            setCurrentRoundIdx(prev => prev - 1);
        }
    };

    const handleRoundSelectorWheel = (event) => {
        const direction = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
            ? Math.sign(event.deltaY)
            : Math.sign(event.deltaX);

        if (direction === 0) return;

        event.preventDefault();
        event.stopPropagation();
        if (rounds.length <= 1) return;

        setCurrentRoundIdx(prev => {
            const next = prev + direction;
            return Math.min(Math.max(next, 0), rounds.length - 1);
        });
    };

    useEffect(() => {
        const selector = roundSelectorRef.current;
        if (!selector) return;

        selector.addEventListener('wheel', handleRoundSelectorWheel, { passive: false });

        return () => {
            selector.removeEventListener('wheel', handleRoundSelectorWheel);
        };
    }, [handleRoundSelectorWheel]);

    const showAlert = (title, description, details = []) => {
        setModal({ open: true, title, description, details, onConfirm: () => setModal(prev => ({ ...prev, open: false })), isAlert: true, variant: 'primary', confirmText: 'OK' });
    };

    const showConfirm = (title, description, onConfirm, variant = 'primary', confirmText = 'Confirm') => {
        setModal({ open: true, title, description, details: [], onConfirm: () => { onConfirm(); setModal(prev => ({ ...prev, open: false })); }, isAlert: false, variant, confirmText });
    };

    const saveTournamentConfig = async (nextConfig) => {
        const normalizedConfig = rounds.length > 0
            ? { ...nextConfig, pairingMode: tournamentConfig?.pairingMode || 'all' }
            : nextConfig;
        const nextRoundCount = Number(normalizedConfig.numRounds) || 1;
        let latestPlayers;
        try {
            latestPlayers = await loadPlayers(activeTournamentId);
        } catch {
            showAlert('Tournament Setup Blocked', 'Could not load players to validate the round count.');
            return false;
        }

        setPlayers(latestPlayers);
        const activePlayers = getActivePairablePlayers(latestPlayers, getTournamentForfeitSet(rounds));
        const roundCountWarning = getRoundCountWarningForPlayers(activePlayers, nextRoundCount, normalizedConfig);
        if (roundCountWarning) return { warning: roundCountWarning };

        if (rounds.length > nextRoundCount) {
            const deletedRounds = rounds.length - nextRoundCount;

            showConfirm(
                "Delete Higher Round Results?",
                `Reducing the tournament to ${nextRoundCount} round${nextRoundCount !== 1 ? 's' : ''} will delete round ${nextRoundCount + 1} and all later round results (${deletedRounds} round${deletedRounds !== 1 ? 's' : ''}). This action cannot be undone.`,
                () => {
                    const keptRounds = rounds.slice(0, nextRoundCount);
                    updateTournamentConfig(normalizedConfig);
                    updateRounds(keptRounds);
                    setCurrentRoundIdx(keptRounds.length ? keptRounds.length - 1 : 0);
                    setShowConfigModal(false);
                },
                'error',
                'Delete Results'
            );

            return false;
        }

        updateTournamentConfig(normalizedConfig);
        return true;
    };

    const playerScores = useMemo(() => {
        const scores = {};
        // Process rounds up to currentRoundIdx
        rounds.slice(0, currentRoundIdx).forEach(r => {
            r.pairings.forEach(p => {
                const result = p.result;
                if (!result) return;

                const wId = p.whiteId;
                const bId = p.blackId;

                if (p.isTournamentForfeit) return;

                if (p.isBye && !p.isSkip && wId) {
                    scores[wId] = (scores[wId] || 0) + 1;
                    return;
                }

                if (wId) scores[wId] = (scores[wId] || 0) + (result === '1-0' || result === '1-0f' ? 1 : result === '0.5-0.5' ? 0.5 : 0);
                if (bId) scores[bId] = (scores[bId] || 0) + (result === '0-1' || result === '0-1f' ? 1 : result === '0.5-0.5' ? 0.5 : 0);
            });
        });
        return scores;
    }, [rounds, currentRoundIdx]);

    const PlayerInfo = ({ player, side }) => {
        if (!player) return null;

        return (
            <Tooltip>
                <Tooltip.Trigger
                    element={(attrs) => (
                        <button
                            {...attrs}
                            type="button"
                            onClick={() => setSelectedPlayer(player)}
                            className={`flex max-w-full items-center gap-1.5 cursor-pointer min-w-0 text-left ${side === 'black' ? 'flex-row-reverse text-right' : ''}`}
                        >
                            <div className="flex flex-col min-w-0 overflow-hidden">
                                <span className="font-bold text-surface-900-100 text-xs truncate leading-tight">{player.name || 'Unknown'}</span>
                            </div>
                        </button>
                    )}
                />
                <Portal>
                    <Tooltip.Positioner>
                        <Tooltip.Content className="card p-3 shadow-xl border border-surface-200-800 bg-surface-100-900 text-surface-900-100 min-w-48 z-[200]">
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 pb-2 border-b border-surface-200-800">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shadow-inner ${side === 'black' ? 'bg-surface-950 text-white' : 'bg-white text-black border border-gray-200'}`}>
                                        <User size={20} />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="font-bold text-base leading-tight">{player.name}</span>
                                        <span className="text-xs text-primary-500 font-bold uppercase tracking-wider">Rating: {player.rating || 'Unrated'}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                    {player.group && (
                                        <div className="flex flex-col">
                                            <span className="text-[9px] text-surface-500 uppercase font-bold">Group</span>
                                            <span className="text-xs font-medium flex items-center gap-1">
                                                <Users size={10} className="text-surface-400" />
                                                {player.group}
                                            </span>
                                        </div>
                                    )}
                                    {player.title && (
                                        <div className="flex flex-col">
                                            <span className="text-[9px] text-surface-500 uppercase font-bold">Title</span>
                                            <span className="text-xs font-medium flex items-center gap-1">
                                                <GraduationCap size={10} className="text-surface-400" />
                                                {player.title}
                                            </span>
                                        </div>
                                    )}
                                    {player.club && (
                                        <div className="flex flex-col col-span-2">
                                            <span className="text-[9px] text-surface-500 uppercase font-bold">Club</span>
                                            <span className="text-xs font-medium flex items-center gap-1">
                                                <Building2 size={10} className="text-surface-400" />
                                                {player.club}
                                            </span>
                                        </div>
                                    )}
                                    {player.federation && (
                                        <div className="flex flex-col col-span-2">
                                            <span className="text-[9px] text-surface-500 uppercase font-bold">Federation</span>
                                            <span className="text-xs font-medium flex items-center gap-1">
                                                <Globe size={10} className="text-surface-400" />
                                                {player.federation}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <Tooltip.Arrow className="[--arrow-size:--spacing(2)] [--arrow-background:var(--color-surface-100-900)]">
                                <Tooltip.ArrowTip className="border-t border-l border-surface-200-800" />
                            </Tooltip.Arrow>
                        </Tooltip.Content>
                    </Tooltip.Positioner>
                </Portal>
            </Tooltip>
        );
    };

    const handleDeleteRounds = ({ mode, selectedRoundIndexes }) => {
        const indexesToDelete = mode === 'all'
            ? rounds.map((_, index) => index)
            : selectedRoundIndexes;

        if (!indexesToDelete.length) {
            showAlert("No Rounds Selected", "Choose at least one round to delete.");
            return;
        }

        const deleteSet = new Set(indexesToDelete);
        const description = mode === 'all'
            ? "Delete all rounds from this tournament? Tournament configuration and players will be kept."
            : `Delete ${indexesToDelete.length} selected round${indexesToDelete.length !== 1 ? 's' : ''}?`;

        showConfirm(
            "Delete Rounds?",
            `${description} This action cannot be undone.`,
            async () => {
                try {
                    const remainingRounds = rounds
                        .filter((_, index) => !deleteSet.has(index))
                        .map((round, index) => ({
                            ...round,
                            roundNumber: index + 1,
                            pairings: round.pairings.map((pairing, pairingIndex) => ({
                                ...pairing,
                                id: `r${index + 1}-p${pairingIndex + 1}`
                            }))
                        }));

                    updateRounds(remainingRounds);
                    setCurrentRoundIdx(remainingRounds.length ? remainingRounds.length - 1 : 0);
                    setShowSetupModal(false);
                } catch (error) {
                    console.error("Failed to delete rounds:", error);
                    showAlert("Error", "Failed to delete rounds. Please try again.");
                }
            },
            'error',
            mode === 'all' ? 'Delete All Rounds' : 'Delete Selected'
        );
    };

    const handleKeyDown = (e, pairingId, rowIndex) => {
        const keyMap = {
            '1': '1-0',
            '2': '0.5-0.5',
            '3': '0-1',
            '4': '1-0f',
            '5': '0-1f',
            '6': '0-0'
        };

        if (keyMap[e.key]) {
            updateResult(pairingId, keyMap[e.key]);

            // Move focus to next row
            const nextRow = e.currentTarget.nextElementSibling;
            if (nextRow) {
                nextRow.focus();
            }
        } else if (e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault(); // Prevent page scroll
            e.currentTarget.nextElementSibling?.focus();
        } else if (e.key === 'ArrowDown') {
            e.currentTarget.nextElementSibling?.focus();
        } else if (e.key === 'ArrowUp') {
            e.currentTarget.previousElementSibling?.focus();
        }
    };

    const playerMap = useMemo(() => {
        return players.reduce((acc, p) => {
            acc[p.playerUniqueId] = p;
            return acc;
        }, {});
    }, [players]);
    const playerGroupLookup = useMemo(() => buildPlayerGroupLookup(players), [players]);
    const currentRoundSections = useMemo(
        () => getRoundGroupSections(currentRound?.pairings || [], playerGroupLookup, isGroupPairingMode(tournamentConfig)),
        [currentRound, playerGroupLookup, tournamentConfig]
    );
    const groupPairingMode = isGroupPairingMode(tournamentConfig);
    const validPlayers = players.filter(hasPlayerName);
    const activePairablePlayers = getActivePairablePlayers(players, nextRoundForfeitedPlayerIds);
    const hasEnoughValidPlayerNames = validPlayers.length >= 2;
    const setupMaxRoundCount = Math.max(1, getMaximumRoundCount(validPlayers.length));
    const setupDefaultRoundCount = Math.min(5, setupMaxRoundCount);
    const firstRoundSetupWarning = tournamentConfig && rounds.length === 0
        ? getRoundCountWarningForPlayers(activePairablePlayers, Number(tournamentConfig.numRounds) || 0, tournamentConfig)
        : null;
    const getConfigRoundCountWarning = (nextConfig) => getRoundCountWarningForPlayers(
        activePairablePlayers,
        Number(nextConfig?.numRounds) || 1,
        nextConfig
    );
    const confirmationModal = (
        <ConfirmationModal
            open={modal.open}
            onOpenChange={(open) => setModal(prev => ({ ...prev, open }))}
            title={modal.title}
            description={modal.description}
            onConfirm={modal.onConfirm}
            isAlert={modal.isAlert}
            variant={modal.variant}
            confirmText={modal.confirmText}
            details={modal.details}
        />
    );
    const isPairingGroupOpen = (sectionKey) => openPairingGroups[sectionKey] ?? true;
    const togglePairingGroup = (sectionKey) => {
        setOpenPairingGroups(prev => ({
            ...prev,
            [sectionKey]: !(prev[sectionKey] ?? true),
        }));
    };
    const scoreImportRows = getScoreImportRows();
    const scoreImportRoundNumbers = [...new Set(scoreImportRows.map(row => row.roundNumber).filter(Boolean))].sort((a, b) => a - b);
    const maxScoreImportRound = Math.max(0, ...scoreImportRoundNumbers);
    const configuredScoreRounds = tournamentConfig?.numRounds || 0;
    const scoreImportExceedsConfig = maxScoreImportRound > configuredScoreRounds;
    const pendingForfeitChangeCount = pendingForfeitPlayers.length + pendingManualForfeitPlayers.length + pendingReturnPlayers.length;
    const pairingTableHead = (
        <thead className="bg-surface-50-950 border-b border-surface-200-800">
            <tr>
                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-10">Bd</th>
                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-10">ID</th>
                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[9px] text-surface-500">White Name</th>
                <th className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-9">Fed</th>
                <th className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-9">Pts</th>
                <th className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-20">Result</th>
                <th className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-9">Pts</th>
                <th className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-9">Fed</th>
                <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wider text-[9px] text-surface-500">Black Name</th>
                <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-10">ID</th>
            </tr>
        </thead>
    );
    const renderPairingRows = (rows) => rows.map(({ pairing, index: idx, groupIndex }) => {
        const whitePlayer = playerMap[pairing.whiteId];
        const blackPlayer = playerMap[pairing.blackId];
        const boardNumber = groupPairingMode ? groupIndex + 1 : idx + 1;

        return (
            <tr
                key={pairing.id}
                tabIndex={0}
                onKeyDown={(e) => handleKeyDown(e, pairing.id, idx)}
                className="hover:bg-surface-200-800/30 transition-colors focus:bg-primary-500/10 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary-500 outline-none cursor-pointer"
            >
                <td className="px-2 py-1.5 font-mono text-surface-500 text-[10px]">
                    <div className="flex items-center gap-1.5">
                        <span>{boardNumber}</span>
                        {pairing.manual && (
                            <span
                                className="rounded bg-primary-500/10 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400"
                                title="Manually paired"
                            >
                                M
                            </span>
                        )}
                    </div>
                </td>
                <td className="px-2 py-1.5 text-[10px] font-mono text-surface-400">
                    {pairing.whiteId}
                </td>
                <td className="px-2 py-1.5">
                    <PlayerInfo player={whitePlayer} side="white" />
                </td>
                <td className="px-2 py-1.5 text-center">
                    <span className="text-[9px] font-bold text-surface-400 uppercase">{whitePlayer?.federation || '-'}</span>
                </td>
                <td className="px-2 py-1.5 text-center">
                    <span className="font-mono font-bold text-primary-500 text-xs">
                        {playerScores[pairing.whiteId] || 0}
                    </span>
                </td>
                <td className="px-2 py-1.5">
                    <select
                        value={getPairingResult(pairing)}
                        onChange={(e) => updateResult(pairing.id, e.target.value)}
                        disabled={pairing.isTournamentForfeit}
                        className="w-full bg-surface-50-950 border border-surface-200-800 rounded px-1 py-0.5 text-center font-bold text-[11px] outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {RESULT_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </td>
                <td className="px-2 py-1.5 text-center">
                    <span className="font-mono font-bold text-primary-500 text-xs">
                        {pairing.isBye ? '-' : (playerScores[pairing.blackId] || 0)}
                    </span>
                </td>
                <td className="px-2 py-1.5 text-center">
                    <span className="text-[9px] font-bold text-surface-400 uppercase">{pairing.isBye ? '-' : (blackPlayer?.federation || '-')}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                    {pairing.isBye ? (
                        <div className="flex flex-col items-end pr-1">
                            <span className={`font-bold uppercase tracking-widest italic text-[11px] ${pairing.isTournamentForfeit ? 'text-error-500' : pairing.isSkip ? 'text-warning-500' : 'text-primary-500'}`}>
                                {pairing.isTournamentForfeit ? 'FORFEIT' : pairing.isSkip ? 'SKIP' : 'BYE'}
                            </span>
                        </div>
                    ) : (
                        <PlayerInfo player={blackPlayer} side="black" />
                    )}
                </td>
                <td className="px-2 py-1.5 text-right text-[10px] font-mono text-surface-400">
                    {pairing.isBye ? '-' : pairing.blackId}
                </td>
            </tr>
        );
    });

    if (isLoadingConfig) {
        return (
            <div className="flex items-center justify-center py-24">
                <div className="w-8 h-8 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            </div>
        );
    }

    if (!tournamentConfig) {
        return (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
                <div className="p-4 bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-sm text-center max-w-sm">
                    <Settings className="mx-auto mb-3 text-surface-400" size={32} />
                    <h3 className="text-lg font-bold mb-2">Tournament Setup Required</h3>
                    <p className="text-sm text-surface-600-400 mb-4">You need to configure the tournament before starting the first round.</p>
                    <button
                        onClick={() => setShowConfigModal(true)}
                        disabled={!hasEnoughValidPlayerNames}
                        title={!hasEnoughValidPlayerNames ? 'Add at least two player names before setting up the tournament' : undefined}
                        className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Setup Tournament
                    </button>
                    {!hasEnoughValidPlayerNames && (
                        <p className="mt-2 text-xs font-medium text-warning-600-400">
                            Add at least two player names before setting up the tournament.
                        </p>
                    )}
                </div>
                <TournamentConfigModal
                    open={showConfigModal}
                    onClose={() => setShowConfigModal(false)}
                    config={tournamentConfig}
                    onSave={saveTournamentConfig}
                    lockPairingMode={rounds.length > 0}
                    defaultNumRounds={setupDefaultRoundCount}
                    maxNumRounds={setupMaxRoundCount}
                    getRoundCountWarning={getConfigRoundCountWarning}
                />
                {confirmationModal}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Swords className="text-primary-500" size={24} />
                        Rounds
                    </h2>
                    {rounds.length > 0 && (
                        <div
                            ref={roundSelectorRef}
                            className="flex items-center bg-surface-100-900 border border-surface-200-800 rounded-lg p-1"
                            title="Scroll to change rounds"
                        >
                            <button
                                onClick={prevRound}
                                disabled={currentRoundIdx === 0}
                                className="p-1.5 hover:bg-surface-200-800 rounded transition-colors disabled:opacity-30"
                            >
                                <ChevronLeft size={18} />
                            </button>
                            <div className="px-4 text-sm font-bold min-w-16 text-center select-none">
                                {currentRoundIdx + 1} of {tournamentConfig.numRounds}
                            </div>
                            <button
                                onClick={nextRound}
                                disabled={currentRoundIdx === rounds.length - 1}
                                className="p-1.5 hover:bg-surface-200-800 rounded transition-colors disabled:opacity-30"
                            >
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex gap-2">
                    {currentRound && (
                        <Dialog
                            open={scoreImportOpen}
                            onOpenChange={({ open }) => {
                                setScoreImportOpen(open);
                                if (!open) resetScoreImportState();
                            }}
                        >
                            <Dialog.Trigger className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer">
                                <Upload size={14} />
                                Import Scores
                            </Dialog.Trigger>
                            <Portal>
                                <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
                                <Dialog.Positioner className="fixed inset-0 z-50 flex items-center justify-center p-4">
                                    <Dialog.Content className={`bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full min-w-0 max-h-[90vh] overflow-y-auto overflow-x-hidden space-y-4 shadow-xl transition-all ${scoreImportPhase === 'mapping' ? 'max-w-2xl' : 'max-w-lg'}`}>
                                        {scoreImportPhase === 'input' ? (
                                            <>
                                                <Dialog.Title className="text-base font-semibold">Import Scores</Dialog.Title>
                                                <Dialog.Description className="text-sm text-surface-600-400">
                                                    Supports Excel (.xlsx, .xls), CSV, and semicolon-delimited files.
                                                    You will map columns on the next step.
                                                </Dialog.Description>

                                                <label className="flex items-center gap-3 px-3 py-2.5 border border-dashed border-surface-300-700 rounded-lg cursor-pointer hover:bg-surface-50-950 transition-colors">
                                                    <FileUp size={18} className="text-surface-500-400 shrink-0" />
                                                    <span className="text-sm truncate">
                                                        {scoreFileName
                                                            ? <span className="text-primary-600-400 font-medium">{scoreFileName}</span>
                                                            : <span className="text-surface-500-400">Choose file — .xlsx, .xls, .csv, .txt</span>
                                                        }
                                                    </span>
                                                    <input
                                                        ref={scoreFileInputRef}
                                                        type="file"
                                                        accept=".xlsx,.xls,.csv,.txt,.tsv"
                                                        className="hidden"
                                                        onChange={handleScoreFileSelect}
                                                    />
                                                </label>

                                                <div className="space-y-1">
                                                    <p className="text-xs text-surface-500-400">or paste text directly</p>
                                                    <textarea
                                                        className="w-full h-32 bg-surface-50-950 border border-surface-200-800 rounded p-2 font-mono text-xs outline-none resize-none focus:ring-1 focus:ring-primary-500"
                                                        placeholder={"Round,Board,White ID,Black ID,White Score,Black Score\n1,1,4,8,1,0\n1,2,2,6,0.5,0.5\n2,1,4,2,0,1"}
                                                        value={scoreImportText}
                                                        onChange={e => { setScoreImportText(e.target.value); setScoreFileName(''); }}
                                                    />
                                                </div>

                                                <div className="flex justify-between">
                                                    <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                                        Cancel
                                                    </Dialog.CloseTrigger>
                                                    <button
                                                        className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded preset-filled disabled:opacity-40"
                                                        disabled={!scoreImportText.trim()}
                                                        onClick={() => {
                                                            const data = parseScoreRawData(scoreImportText);
                                                            if (data) advanceToScoreMapping(data);
                                                        }}
                                                    >
                                                        Map columns
                                                        <ArrowRight size={14} />
                                                    </button>
                                                </div>
                                            </>
                                        ) : scoreImportPhase === 'mapping' ? (
                                            <>
                                                <Dialog.Title className="text-base font-semibold">Map score columns</Dialog.Title>
                                                <Dialog.Description className="text-sm text-surface-600-400">
                                                    {scoreRawData?.rows.length} rows detected from <span className="font-medium">{scoreFileName || 'pasted text'}</span>.
                                                    Map Round for multi-round files. Map a Result column, or map White score and Black score.
                                                </Dialog.Description>

                                                <div className="overflow-y-auto max-h-80 border border-surface-200-800 rounded-lg">
                                                    <table className="w-full text-sm">
                                                        <thead className="bg-surface-100-900 border-b border-surface-200-800 sticky top-0">
                                                            <tr>
                                                                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400 w-36">Source column</th>
                                                                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400">Sample</th>
                                                                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400 w-36">Maps to</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {scoreRawData?.headers.map((header, i) => {
                                                                const sample = scoreRawData.rows
                                                                    .slice(0, 3)
                                                                    .map(r => r[i])
                                                                    .filter(Boolean)
                                                                    .join(', ');
                                                                return (
                                                                    <tr key={i} className="border-b border-surface-200-800 last:border-0">
                                                                        <td className="px-3 py-2 font-medium truncate max-w-36">{header}</td>
                                                                        <td className="px-3 py-2 text-xs text-surface-600-400 truncate max-w-48">
                                                                            {sample.length > 50 ? sample.slice(0, 50) + '...' : sample || '-'}
                                                                        </td>
                                                                        <td className="px-3 py-2">
                                                                            <select
                                                                                className="w-full text-sm bg-surface-50-950 border border-surface-200-800 rounded px-2 py-1 outline-none cursor-pointer"
                                                                                value={scoreColumnMap[i] ?? ''}
                                                                                onChange={e => setScoreColumnMap(prev => nextUniqueScoreColumnMap(prev, i, e.target.value))}
                                                                            >
                                                                                {SCORE_TARGET_OPTIONS.map(opt => (
                                                                                    <option key={opt.value} value={opt.value}>{scoreMappingOptionLabel(opt, scoreColumnMap)}</option>
                                                                                ))}
                                                                            </select>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                <div className="flex justify-between items-center">
                                                    <button
                                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded preset-tonal"
                                                        onClick={() => setScoreImportPhase('input')}
                                                    >
                                                        <ArrowLeft size={14} />
                                                        Back
                                                    </button>
                                                    <div className="flex gap-2">
                                                        <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                                            Cancel
                                                        </Dialog.CloseTrigger>
                                                        <button
                                                            className="px-4 py-1.5 text-sm rounded preset-filled cursor-pointer"
                                                            onClick={handleScoreImportDecision}
                                                        >
                                                            Import
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <Dialog.Title className="text-base font-semibold">Multi-round import</Dialog.Title>
                                                <Dialog.Description className="text-sm text-surface-600-400">
                                                    The mapped data contains round {scoreImportRoundNumbers.join(', ')}. Choose which rounds should be imported.
                                                </Dialog.Description>

                                                <div className="space-y-3">
                                                    <label className="flex items-start gap-3 p-3 rounded-lg bg-surface-50-950 border border-surface-200-800 cursor-pointer hover:bg-surface-100-900 transition-colors">
                                                        <input
                                                            type="checkbox"
                                                            checked={scoreRoundOptions.overwritePrevious}
                                                            onChange={(e) => setScoreRoundOptions(prev => ({ ...prev, overwritePrevious: e.target.checked }))}
                                                            className="mt-1 accent-primary-500"
                                                        />
                                                        <div>
                                                            <p className="text-sm font-medium">Overwrite previous round scores</p>
                                                            <p className="text-xs text-surface-600-400 mt-0.5">
                                                                Update score results in rounds before the currently selected round when those rounds appear in the import file.
                                                            </p>
                                                        </div>
                                                    </label>

                                                    <div className="space-y-2">
                                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                            <p className="text-sm font-medium">Rounds to import</p>
                                                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                                                                <button
                                                                    type="button"
                                                                    className="text-xs text-primary-600-400 hover:underline whitespace-nowrap"
                                                                    onClick={() => setScoreRoundOptions(prev => ({
                                                                        ...prev,
                                                                        importAllRounds: true,
                                                                        selectedRoundNumbers: [currentRound.roundNumber || currentRoundIdx + 1]
                                                                    }))}
                                                                >
                                                                    Current round
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="text-xs text-primary-600-400 hover:underline whitespace-nowrap"
                                                                    onClick={() => setScoreRoundOptions(prev => ({ ...prev, importAllRounds: true, selectedRoundNumbers: scoreImportRoundNumbers }))}
                                                                >
                                                                    Select all
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="text-xs text-surface-500-400 hover:underline whitespace-nowrap"
                                                                    onClick={() => setScoreRoundOptions(prev => ({ ...prev, selectedRoundNumbers: [] }))}
                                                                >
                                                                    Clear
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="bg-surface-50-950 border border-surface-200-800 rounded-lg divide-y divide-surface-200-800 max-h-48 overflow-y-auto">
                                                            {scoreImportRoundNumbers.map(roundNumber => {
                                                                const rowCount = scoreImportRows.filter(row => row.roundNumber === roundNumber).length;
                                                                const checked = scoreRoundOptions.selectedRoundNumbers.includes(roundNumber);
                                                                return (
                                                                    <label key={roundNumber} className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer hover:bg-surface-100-900 transition-colors">
                                                                        <div>
                                                                            <p className="text-sm font-medium">Round {roundNumber}</p>
                                                                            <p className="text-xs text-surface-600-400">{rowCount} row{rowCount !== 1 ? 's' : ''} detected</p>
                                                                        </div>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={checked}
                                                                            onChange={() => setScoreRoundOptions(prev => ({
                                                                                ...prev,
                                                                                importAllRounds: true,
                                                                                selectedRoundNumbers: checked
                                                                                    ? prev.selectedRoundNumbers.filter(value => value !== roundNumber)
                                                                                    : [...prev.selectedRoundNumbers, roundNumber].sort((a, b) => a - b)
                                                                            }))}
                                                                            className="accent-primary-500"
                                                                        />
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                        <p className="text-xs text-surface-600-400">
                                                            Missing selected rounds can be created when the file includes player IDs and scores.
                                                        </p>
                                                    </div>

                                                    {scoreImportExceedsConfig && (
                                                        <div className="space-y-2 p-3 rounded-lg bg-warning-500/10 border border-warning-500/30">
                                                            <p className="text-sm font-medium text-warning-700-300">
                                                                Imported data reaches round {maxScoreImportRound}, but this tournament is set to {configuredScoreRounds} round{configuredScoreRounds !== 1 ? 's' : ''}.
                                                            </p>
                                                            <label className="flex items-start gap-3 cursor-pointer">
                                                                <input
                                                                    type="radio"
                                                                    name="score-round-limit"
                                                                    value="increase"
                                                                    checked={scoreRoundOptions.roundLimitAction === 'increase'}
                                                                    onChange={() => setScoreRoundOptions(prev => ({ ...prev, roundLimitAction: 'increase', importAllRounds: true }))}
                                                                    className="mt-1 accent-primary-500"
                                                                />
                                                                <div>
                                                                    <p className="text-sm font-medium">Increase tournament rounds</p>
                                                                    <p className="text-xs text-surface-600-400 mt-0.5">
                                                                        Set tournament rounds to {maxScoreImportRound} and import all mapped rounds.
                                                                    </p>
                                                                </div>
                                                            </label>
                                                            <label className="flex items-start gap-3 cursor-pointer">
                                                                <input
                                                                    type="radio"
                                                                    name="score-round-limit"
                                                                    value="cap"
                                                                    checked={scoreRoundOptions.roundLimitAction === 'cap'}
                                                                    onChange={() => setScoreRoundOptions(prev => ({ ...prev, roundLimitAction: 'cap' }))}
                                                                    className="mt-1 accent-primary-500"
                                                                />
                                                                <div>
                                                                    <p className="text-sm font-medium">Import up to current round setting</p>
                                                                    <p className="text-xs text-surface-600-400 mt-0.5">
                                                                        Ignore imported rows after round {configuredScoreRounds}.
                                                                    </p>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex justify-between items-center">
                                                    <button
                                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded preset-tonal"
                                                        onClick={() => setScoreImportPhase('mapping')}
                                                    >
                                                        <ArrowLeft size={14} />
                                                        Back
                                                    </button>
                                                    <div className="flex gap-2">
                                                        <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                                            Cancel
                                                        </Dialog.CloseTrigger>
                                                        <button
                                                            className="px-4 py-1.5 text-sm rounded preset-filled cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                                            disabled={scoreRoundOptions.selectedRoundNumbers.length === 0}
                                                            onClick={() => applyScoreImport(scoreRoundOptions)}
                                                        >
                                                            Apply Import
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </Dialog.Content>
                                </Dialog.Positioner>
                            </Portal>
                        </Dialog>
                    )}
                    <button
                        onClick={handleExportTrf}
                        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer"
                        title="Export TRF"
                    >
                        <Download size={14} />
                        Export TRF
                    </button>
                    <button
                        onClick={() => setShowConfigModal(true)}
                        className="p-2 hover:bg-surface-200-800 rounded-lg transition-colors text-surface-500 hover:text-primary-500"
                        title="Tournament Settings"
                    >
                        <Settings size={20} />
                    </button>
                    {tournamentConfig && rounds.length > 0 && (
                        <button
                            onClick={() => {
                                setRoundModalMode('settings');
                                setShowSetupModal(true);
                            }}
                            className="p-2 hover:bg-surface-200-800 rounded-lg transition-colors text-surface-500 hover:text-primary-500"
                            title="Round Settings"
                        >
                            <Swords size={20} />
                        </button>
                    )}
                    {isLatestRound && (
                        <div className="relative group flex items-center">
                            {!isRoundComplete && rounds.length > 0 && (
                                <div className="absolute top-full mt-2 right-0 px-3 py-1 bg-error-500/10 text-error-500 text-[10px] font-bold uppercase tracking-tight rounded-md border border-error-500/20 flex items-center gap-1.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg backdrop-blur-md">
                                    <AlertTriangle size={10} />
                                    Complete all results first
                                </div>
                            )}
                            
                            {pairingBusy ? (
                                <div className="flex flex-col items-end gap-1 min-w-48">
                                    <div className="flex justify-between w-full text-[10px] font-bold uppercase tracking-widest text-primary-500">
                                        <span>{isManualPairing ? 'Manual' : 'Engine'} {pairingProgress < 90 ? 'Initializing' : 'Pairing'}</span>
                                        <span>{pairingProgress}%</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-surface-200-800 rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-primary-500 transition-all duration-300 ease-out"
                                            style={{ width: `${pairingProgress}%` }}
                                        />
                                    </div>
                                </div>
                            ) : rounds.length === tournamentConfig.numRounds ? (
                                <button
                                    onClick={() => setActiveTab('standings')}
                                    disabled={!isRoundComplete}
                                    className="flex items-center gap-2 px-4 py-2 bg-success-500 text-white rounded-lg hover:bg-success-600 transition-colors text-sm font-bold shadow-lg shadow-success-500/20 disabled:opacity-50"
                                >
                                    <CheckCircle2 size={16} />
                                    View Standings
                                </button>
                            ) : (
                                <div className="flex items-center gap-2">
                                    {isRoundComplete && (
                                        <button
                                            onClick={() => openManualPairing('create')}
                                            disabled={pairingBusy || (!isRoundComplete && rounds.length > 0)}
                                            className="flex items-center gap-2 px-4 py-2 rounded preset-tonal text-sm font-bold disabled:opacity-50"
                                        >
                                            <Swords size={16} />
                                            Manual Pairing
                                        </button>
                                    )}
                                    <button
                                        onClick={openRoundSetup}
                                        disabled={pairingBusy || (!isRoundComplete && rounds.length > 0)}
                                        className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-bold shadow-lg shadow-primary-500/20 disabled:opacity-50"
                                    >
                                        <Play size={16} />
                                        {rounds.length === 0 ? 'Start Tournament' : 'Next Round'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {!currentRound ? (
                <div className="py-24 text-center space-y-4 bg-surface-50-950 border border-dashed border-surface-200-800 rounded-2xl">
                    <div className="w-16 h-16 bg-primary-500/10 rounded-full flex items-center justify-center mx-auto">
                        <Swords className="text-primary-500" size={32} />
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-lg font-bold">Ready to Pair</h3>
                        <p className="text-sm text-surface-600-400">Click the button above to generate pairings for Round 1.</p>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4 text-sm">
                        <div className="text-surface-600-400">
                            {currentRound.pairings.length} boards paired
                        </div>
                        {isLatestRound && (
                            <div className="flex items-center gap-2">
                                {rounds.length < tournamentConfig.numRounds && (
                                    <button
                                        onClick={openForfeitModal}
                                        disabled={pairingBusy}
                                        className="relative flex items-center gap-1.5 px-3 py-1.5 rounded preset-tonal text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Pre-assign forfeits and returns"
                                    >
                                        <UserX size={14} />
                                        Forfeits
                                        {pendingForfeitChangeCount > 0 && (
                                            <span className="ml-0.5 rounded bg-error-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                                                {pendingForfeitChangeCount}
                                            </span>
                                        )}
                                    </button>
                                )}
                                <button
                                    onClick={() => openManualPairing('edit')}
                                    disabled={pairingBusy}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded preset-tonal text-xs font-bold disabled:opacity-50"
                                >
                                    <Swords size={14} />
                                    Change Pairing
                                </button>
                            </div>
                        )}
                    </div>

                    {groupPairingMode ? (
                        <div className="space-y-2">
                            {currentRoundSections.map((section) => {
                                const isOpen = isPairingGroupOpen(section.key);
                                return (
                                    <div key={section.key} className="border border-surface-200-800 rounded-xl overflow-hidden bg-surface-100-900 shadow-sm">
                                        <button
                                            type="button"
                                            onClick={() => togglePairingGroup(section.key)}
                                            className="flex w-full items-center justify-between gap-3 bg-surface-50-950/80 px-3 py-2 text-left hover:bg-surface-200-800/50 transition-colors"
                                            aria-expanded={isOpen}
                                        >
                                            <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary-500">
                                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                Group {section.group || 'Unassigned'}
                                            </span>
                                            <span className="text-[10px] font-mono text-surface-500">
                                                {section.pairings.length} board{section.pairings.length !== 1 ? 's' : ''}
                                            </span>
                                        </button>
                                        {isOpen && (
                                            <table className="w-full table-fixed text-sm">
                                                {pairingTableHead}
                                                <tbody className="divide-y divide-surface-200-800">
                                                    {renderPairingRows(section.pairings)}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="border border-surface-200-800 rounded-xl overflow-hidden bg-surface-100-900 shadow-sm">
                            <table className="w-full table-fixed text-sm">
                                {pairingTableHead}
                                <tbody className="divide-y divide-surface-200-800">
                                    {renderPairingRows(currentRoundSections[0]?.pairings || [])}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            <TournamentConfigModal
                open={showConfigModal}
                onClose={() => setShowConfigModal(false)}
                config={tournamentConfig}
                onSave={saveTournamentConfig}
                lockPairingMode={rounds.length > 0}
                defaultNumRounds={setupDefaultRoundCount}
                maxNumRounds={Math.max(20, setupMaxRoundCount)}
                getRoundCountWarning={getConfigRoundCountWarning}
            />

            {showForfeitModal && (
                <Portal>
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" onClick={() => setShowForfeitModal(false)} />
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                        <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-2xl space-y-5 shadow-xl pointer-events-auto max-h-[90vh] overflow-y-auto">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-bold flex items-center gap-2">
                                        <UserX className="text-error-500" size={20} />
                                        Pre-assign forfeits
                                    </h2>
                                    <p className="mt-1 text-xs text-surface-600-400">
                                        Changes apply when round {rounds.length + 1} is generated.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowForfeitModal(false)}
                                    className="p-1 hover:bg-surface-200-800 rounded transition-colors"
                                    aria-label="Close forfeit setup"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {(pendingForfeitPlayers.length > 0 || pendingReturnPlayers.length > 0) && (
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={clearPreRoundForfeitAssignments}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded preset-tonal text-xs font-bold"
                                    >
                                        <X size={13} />
                                        Clear pending changes
                                    </button>
                                </div>
                            )}

                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-3">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500">Forfeit next round</div>
                                    <div className="flex gap-2">
                                        <select
                                            value={selectedForfeitPlayerId}
                                            onChange={(event) => setSelectedForfeitPlayerId(event.target.value)}
                                            disabled={nextRoundForfeitCandidates.length === 0}
                                            className="min-w-0 flex-1 bg-surface-50-950 border border-surface-200-800 rounded px-2.5 py-2 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
                                        >
                                            <option value="">{nextRoundForfeitCandidates.length ? 'Player to forfeit' : 'No available players'}</option>
                                            {nextRoundForfeitCandidates.map(player => (
                                                <option key={player.playerUniqueId} value={String(player.playerUniqueId)}>
                                                    #{player.playerUniqueId} {player.name || 'Unnamed'}
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            onClick={addPendingForfeitPlayer}
                                            disabled={!selectedForfeitPlayerId}
                                            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded preset-tonal text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <UserX size={14} />
                                            Forfeit
                                        </button>
                                    </div>
                                    <div className="space-y-2">
                                        {pendingForfeitPlayers.map(player => (
                                            <div key={player.playerUniqueId} className="flex items-center justify-between gap-3 rounded border border-error-500/20 bg-error-500/5 px-2 py-1.5 text-xs">
                                                <span className="min-w-0 truncate font-medium">{player.name || 'Unnamed'}</span>
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <span className="font-mono text-surface-600-400">#{player.playerUniqueId}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removePendingForfeitPlayer(player.playerUniqueId)}
                                                        className="p-0.5 rounded text-surface-400 hover:text-error-500 transition-colors"
                                                        aria-label={`Remove ${player.name || `player ${player.playerUniqueId}`} from pending forfeits`}
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {pendingManualForfeitPlayers.map(player => (
                                            <div key={`manual-${player.playerUniqueId}`} className="flex items-center justify-between gap-3 rounded border border-error-500/20 bg-error-500/5 px-2 py-1.5 text-xs">
                                                <span className="min-w-0 truncate font-medium">{player.name || 'Unnamed'}</span>
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <span className="rounded bg-primary-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400">
                                                        Manual pairing
                                                    </span>
                                                    <span className="font-mono text-surface-600-400">#{player.playerUniqueId}</span>
                                                </div>
                                            </div>
                                        ))}
                                        {pendingForfeitPlayers.length === 0 && pendingManualForfeitPlayers.length === 0 && (
                                            <div className="rounded border border-surface-200-800 bg-surface-50-950 px-3 py-2 text-xs text-surface-500">
                                                No pending forfeits.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500">Return to pairings</div>
                                    <div className="flex gap-2">
                                        <select
                                            value={selectedReturnPlayerId}
                                            onChange={(event) => setSelectedReturnPlayerId(event.target.value)}
                                            disabled={forfeitReturnCandidates.length === 0}
                                            className="min-w-0 flex-1 bg-surface-50-950 border border-surface-200-800 rounded px-2.5 py-2 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
                                        >
                                            <option value="">{forfeitReturnCandidates.length ? 'Player to return' : 'No forfeited players'}</option>
                                            {forfeitReturnCandidates.map(player => (
                                                <option key={player.playerUniqueId} value={String(player.playerUniqueId)}>
                                                    #{player.playerUniqueId} {player.name || 'Unnamed'}
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            onClick={addPendingReturnPlayer}
                                            disabled={!selectedReturnPlayerId}
                                            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded preset-tonal text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <RotateCcw size={14} />
                                            Return
                                        </button>
                                    </div>
                                    <div className="space-y-2">
                                        {pendingReturnPlayers.map(player => (
                                            <div key={player.playerUniqueId} className="flex items-center justify-between gap-3 rounded border border-success-500/20 bg-success-500/5 px-2 py-1.5 text-xs">
                                                <span className="min-w-0 truncate font-medium">{player.name || 'Unnamed'}</span>
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <span className="font-mono text-surface-600-400">#{player.playerUniqueId}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removePendingReturnPlayer(player.playerUniqueId)}
                                                        className="p-0.5 rounded text-surface-400 hover:text-error-500 transition-colors"
                                                        aria-label={`Remove ${player.name || `player ${player.playerUniqueId}`} from pending returns`}
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {pendingReturnPlayers.length === 0 && (
                                            <div className="rounded border border-surface-200-800 bg-surface-50-950 px-3 py-2 text-xs text-surface-500">
                                                No pending returns.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowForfeitModal(false)}
                                    className="px-4 py-2 text-sm rounded preset-tonal cursor-pointer"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>
                </Portal>
            )}

            <RoundSetupModal
                open={showSetupModal}
                onClose={handleRoundSetupClose}
                onStart={handleRoundSetupStart}
                roundNumber={roundModalMode === 'manual-options' ? manualTargetRoundNumber : rounds.length + 1}
                rounds={rounds}
                canStart={roundModalMode === 'manual-options' || (roundModalMode === 'setup' && isLatestRound && isRoundComplete && rounds.length < tournamentConfig.numRounds)}
                showDelete={roundModalMode === 'settings'}
                excludedPlayers={nextRoundExcludedPlayers}
                unassignedPlayers={currentRoundUnassignedPlayers}
                lockingPlayers={roundModalMode === 'setup' || roundModalMode === 'manual-options' ? nextRoundLockingPlayers : []}
                validationWarning={roundModalMode === 'setup' ? firstRoundSetupWarning : null}
                onDeleteRounds={handleDeleteRounds}
            />

            <ManualPairingModal
                key={`${showManualPairingModal}-${manualPairingMode}-${manualTargetRoundNumber}`}
                open={showManualPairingModal}
                mode={manualPairingMode}
                roundNumber={manualTargetRoundNumber}
                players={players}
                unlockedPlayerIds={unlockedMidTournamentPlayerIds}
                pairingMode={tournamentConfig?.pairingMode || 'all'}
                playerScores={manualPlayerScores}
                initialBoards={manualInitialBoards}
                previousOpponentSet={getPreviousOpponentSet(manualPreviousRounds)}
                previousByeSet={getPlayersWithBye(manualPreviousRounds)}
                forfeitedPlayerIds={forfeitedPlayerIds}
                isSaving={isManualPairing}
                validationWarning={manualPairingMode !== 'edit' ? firstRoundSetupWarning : null}
                onClose={() => setShowManualPairingModal(false)}
                onSave={stageManualPairingSave}
            />

            <PlayerRoundHistoryModal
                open={Boolean(selectedPlayer)}
                player={selectedPlayer}
                rounds={rounds}
                players={players}
                onClose={() => setSelectedPlayer(null)}
            />

            {confirmationModal}
        </div>
    );
}
