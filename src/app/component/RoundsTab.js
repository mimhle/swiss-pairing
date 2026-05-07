"use client";

import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import * as XLSX from 'xlsx';
import { useTournament } from '@/app/context/TournamentContext';
import { Swords, Play, Settings, ChevronRight, ChevronLeft, AlertTriangle, CheckCircle2, User, Info, Building2, Globe, GraduationCap, Users, Trash2, Upload, FileUp, ArrowRight, ArrowLeft } from 'lucide-react';
import { Dialog, Tooltip, Portal } from '@skeletonlabs/skeleton-react';
import TournamentConfigModal from './TournamentConfigModal';
import RoundSetupModal from './RoundSetupModal';
import ConfirmationModal from './ConfirmationModal';
import { generatePairings } from '@/app/utilities/pairingEngine';
import { loadPlayers, deleteTournamentConfig, deleteRounds } from './tournamentStore';

const RESULT_OPTIONS = [
    { value: '', label: 'Pending' },
    { value: '1-0', label: '1 - 0' },
    { value: '0-1', label: '0 - 1' },
    { value: '0.5-0.5', label: '½ - ½' },
    { value: '1-0f', label: '+ : -' },
    { value: '0-1f', label: '- : +' },
    { value: '0-0', label: '0 - 0' },
];

const SCORE_TARGET_OPTIONS = [
    { value: '', label: 'Ignore' },
    { value: 'round', label: 'Round' },
    { value: 'board', label: 'Board' },
    { value: 'whiteId', label: 'White ID' },
    { value: 'blackId', label: 'Black ID' },
    { value: 'whiteScore', label: 'White score' },
    { value: 'blackScore', label: 'Black score' },
    { value: 'result', label: 'Result' },
];

const SCORE_HEADER_MAP = new Map([
    ['round', 'round'],
    ['rd', 'round'],
    ['r', 'round'],
    ['vong', 'round'],
    ['vòng', 'round'],
    ['bd', 'board'],
    ['board', 'board'],
    ['ban', 'board'],
    ['bàn', 'board'],
    ['white id', 'whiteId'],
    ['whiteid', 'whiteId'],
    ['white', 'whiteId'],
    ['w id', 'whiteId'],
    ['id white', 'whiteId'],
    ['black id', 'blackId'],
    ['blackid', 'blackId'],
    ['black', 'blackId'],
    ['b id', 'blackId'],
    ['id black', 'blackId'],
    ['white score', 'whiteScore'],
    ['white points', 'whiteScore'],
    ['w score', 'whiteScore'],
    ['w pts', 'whiteScore'],
    ['score white', 'whiteScore'],
    ['diem trang', 'whiteScore'],
    ['điểm trắng', 'whiteScore'],
    ['black score', 'blackScore'],
    ['black points', 'blackScore'],
    ['b score', 'blackScore'],
    ['b pts', 'blackScore'],
    ['score black', 'blackScore'],
    ['diem den', 'blackScore'],
    ['điểm đen', 'blackScore'],
    ['result', 'result'],
    ['results', 'result'],
    ['score', 'result'],
    ['kq', 'result'],
    ['ket qua', 'result'],
    ['kết quả', 'result'],
]);

const DEFAULT_SCORE_ROUND_OPTIONS = {
    overwritePrevious: false,
    importAllRounds: false,
    roundLimitAction: 'cap',
};

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
        const key = header.toLowerCase().trim();
        const field = SCORE_HEADER_MAP.get(key) ?? '';
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
    if (['+-', '+:-', '1-0f'].includes(normalized)) return '1-0f';
    if (['-+', '-:+', '0-1f'].includes(normalized)) return '0-1f';
    if (['0-0', '0:0'].includes(normalized)) return '0-0';
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
    return importedResult || resultFromScores(whiteScore, blackScore);
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
    const [modal, setModal] = useState({ open: false, title: '', description: '', onConfirm: null, isAlert: false, variant: 'primary', confirmText: 'Confirm' });
    const [currentRoundIdx, setCurrentRoundIdx] = useState(0);
    const [isPairing, setIsPairing] = useState(false);
    const [pairingProgress, setPairingProgress] = useState(0);
    const [players, setPlayers] = useState([]);
    const [scoreImportPhase, setScoreImportPhase] = useState('input');
    const [scoreRawData, setScoreRawData] = useState(null);
    const [scoreColumnMap, setScoreColumnMap] = useState({});
    const [scoreImportText, setScoreImportText] = useState('');
    const [scoreFileName, setScoreFileName] = useState('');
    const [scoreImportOpen, setScoreImportOpen] = useState(false);
    const [scoreRoundOptions, setScoreRoundOptions] = useState(DEFAULT_SCORE_ROUND_OPTIONS);
    const scoreFileInputRef = useRef(null);

    // Load players for lookup
    useEffect(() => {
        if (activeTournamentId && activeTab === 'rounds') {
            loadPlayers(activeTournamentId).then(setPlayers);
        }
    }, [activeTournamentId, activeTab]);

    // If no config exists, open config modal automatically
    useEffect(() => {
        if (!isLoadingConfig && !tournamentConfig && activeTournamentId) {
            setShowConfigModal(true);
        }
    }, [isLoadingConfig, tournamentConfig, activeTournamentId]);

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
        return currentRound.pairings.every(p => p.result !== '');
    }, [currentRound]);

    const handleStartPairing = async (options) => {
        setIsPairing(true);
        setShowSetupModal(false);

        try {
            // 1. Get current players
            const latestPlayers = await loadPlayers(activeTournamentId);
            setPlayers(latestPlayers); // Sync local state for lookup

            // 2. Generate pairings
            const tournamentName = tournamentConfig?.name || "Tournament";
            const newPairings = await generatePairings(
                latestPlayers, 
                options, 
                rounds, 
                tournamentConfig, 
                tournamentName,
                (p) => setPairingProgress(p)
            );

            // 3. Add new round
            const newRound = {
                roundNumber: rounds.length + 1,
                pairings: newPairings.map((p, idx) => ({
                    ...p,
                    id: `r${rounds.length + 1}-p${idx + 1}`,
                    result: ''
                })),
                status: 'in-progress',
                timestamp: Date.now(),
                options
            };

            updateRounds([...rounds, newRound]);
        } catch (error) {
            console.error("Pairing failed:", error);
        } finally {
            setIsPairing(false);
        }
    };

    const updateResult = (pairingId, result) => {
        const updatedRounds = rounds.map((r, rIdx) => {
            if (rIdx === currentRoundIdx) {
                return {
                    ...r,
                    pairings: r.pairings.map(p =>
                        p.id === pairingId ? { ...p, result } : p
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
            const values = { __index: index };
            Object.entries(scoreColumnMap).forEach(([idxStr, field]) => {
                if (!field) return;
                values[field] = String(row[parseInt(idxStr, 10)] ?? '').trim();
            });
            values.roundNumber = parseImportedRound(values.round);
            return values;
        });
    };

    const applyRowsToPairings = (pairings, rowsForRound) => {
        const byBoard = new Map();
        const byPlayers = new Map();

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
                skipped += 1;
                return pairing;
            }

            const result = scoreResultFromRow(row);
            if (!result) {
                skipped += 1;
                return pairing;
            }

            imported += 1;
            return { ...pairing, result };
        });

        return { pairings: pairingsWithResults, imported, skipped };
    };

    const createRoundFromRows = (roundNumber, rowsForRound) => {
        let imported = 0;
        let skipped = 0;
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
                return null;
            }

            imported += 1;
            return {
                id: `r${roundNumber}-p${index + 1}`,
                whiteId: row.whiteId,
                blackId: row.blackId || null,
                isBye: !row.blackId,
                result
            };
        }).filter(Boolean);

        return {
            round: {
                roundNumber,
                pairings,
                status: 'in-progress',
                timestamp: Date.now(),
                options: { imported: true }
            },
            imported,
            skipped
        };
    };

    const handleScoreImportDecision = () => {
        const rows = getScoreImportRows();
        const roundNumbers = [...new Set(rows.map(row => row.roundNumber).filter(Boolean))];
        const configuredRounds = tournamentConfig?.numRounds || 0;
        const maxImportedRound = Math.max(0, ...roundNumbers);

        if (roundNumbers.length > 1 || maxImportedRound > configuredRounds) {
            setScoreRoundOptions({
                ...DEFAULT_SCORE_ROUND_OPTIONS,
                importAllRounds: maxImportedRound > configuredRounds
            });
            setScoreImportPhase('round-options');
            return;
        }

        applyScoreImport({ importAllRounds: false, overwritePrevious: true });
    };

    const applyScoreImport = ({ importAllRounds = false, overwritePrevious = false, roundLimitAction = 'cap' } = {}) => {
        if (!currentRound || !scoreRawData) {
            resetScoreImportState();
            return;
        }

        const rows = getScoreImportRows();
        const configuredRounds = tournamentConfig?.numRounds || 0;
        const importedRoundNumbers = [...new Set(rows.map(row => row.roundNumber).filter(Boolean))];
        const maxImportedRound = Math.max(0, ...importedRoundNumbers);
        const shouldIncreaseRounds = importAllRounds && roundLimitAction === 'increase' && maxImportedRound > configuredRounds;
        const effectiveRows = importAllRounds && roundLimitAction === 'cap' && configuredRounds > 0
            ? rows.filter(row => !row.roundNumber || row.roundNumber <= configuredRounds)
            : rows;
        let imported = 0;
        let skipped = rows.length - effectiveRows.length;
        let updatedRounds;

        if (importAllRounds) {
            const rowsByRound = new Map();
            effectiveRows.forEach(row => {
                if (!row.roundNumber) {
                    skipped += 1;
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

                const applied = applyRowsToPairings(round.pairings, rowsForRound);
                imported += applied.imported;
                skipped += applied.skipped;
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
                if (created.round.pairings.length > 0) updatedRounds.push(created.round);
            });

            updatedRounds.sort((a, b) => a.roundNumber - b.roundNumber);
        } else {
            const currentRoundNumber = currentRound.roundNumber || currentRoundIdx + 1;
            const rowsForCurrentRound = effectiveRows.some(row => row.roundNumber)
                ? effectiveRows.filter(row => row.roundNumber === currentRoundNumber)
                : effectiveRows;

            updatedRounds = rounds.map((round, roundIdx) => {
                if (roundIdx !== currentRoundIdx) return round;

                const applied = applyRowsToPairings(round.pairings, rowsForCurrentRound);
                imported += applied.imported;
                skipped += applied.skipped;
                return { ...round, pairings: applied.pairings };
            });
        }

        if (shouldIncreaseRounds) {
            updateTournamentConfig({
                ...tournamentConfig,
                numRounds: maxImportedRound
            });
        }
        updateRounds(updatedRounds);
        setScoreImportOpen(false);
        resetScoreImportState();
        showAlert(
            'Scores imported',
            `Imported ${imported} result${imported !== 1 ? 's' : ''}${skipped ? ` and skipped ${skipped} row${skipped !== 1 ? 's' : ''}` : ''}.`
        );
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

    const showAlert = (title, description) => {
        setModal({ open: true, title, description, onConfirm: () => setModal(prev => ({ ...prev, open: false })), isAlert: true, variant: 'primary', confirmText: 'OK' });
    };

    const showConfirm = (title, description, onConfirm, variant = 'primary', confirmText = 'Confirm') => {
        setModal({ open: true, title, description, onConfirm: () => { onConfirm(); setModal(prev => ({ ...prev, open: false })); }, isAlert: false, variant, confirmText });
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

                if (p.isBye && wId) {
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
                        <div {...attrs} className={`flex items-center gap-2 cursor-help min-w-0 ${side === 'black' ? 'flex-row-reverse text-right' : ''}`}>
                            <div className="flex flex-col min-w-0 overflow-hidden">
                                <span className="font-bold text-surface-900-100 text-sm truncate">{player.name || 'Unknown'}</span>
                                <span className="text-[9px] text-surface-500 uppercase font-bold tracking-tight">Rtg: {player.rating || '0'}</span>
                            </div>
                        </div>
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

    const handleResetTournament = async () => {
        showConfirm(
            "Reset Tournament?",
            "Are you sure you want to reset this tournament? This will delete ALL rounds and the configuration. This action cannot be undone.",
            async () => {
                try {
                    await deleteTournamentConfig(activeTournamentId);
                    await deleteRounds(activeTournamentId);

                    // Update local state via context
                    updateTournamentConfig(null);
                    updateRounds([]);
                    setCurrentRoundIdx(0);

                    // Re-fetch players just in case
                    const updatedPlayers = await loadPlayers(activeTournamentId);
                    setPlayers(updatedPlayers);
                } catch (error) {
                    console.error("Failed to reset tournament:", error);
                    showAlert("Error", "Failed to reset tournament. Please try again.");
                }
            },
            'error',
            'Reset Tournament'
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
    const scoreImportRows = getScoreImportRows();
    const scoreImportRoundNumbers = [...new Set(scoreImportRows.map(row => row.roundNumber).filter(Boolean))];
    const maxScoreImportRound = Math.max(0, ...scoreImportRoundNumbers);
    const configuredScoreRounds = tournamentConfig?.numRounds || 0;
    const scoreImportExceedsConfig = maxScoreImportRound > configuredScoreRounds;

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
                        className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
                    >
                        Setup Tournament
                    </button>
                </div>
                <TournamentConfigModal
                    open={showConfigModal}
                    onClose={() => setShowConfigModal(false)}
                    config={tournamentConfig}
                    onSave={updateTournamentConfig}
                />
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
                        <div className="flex items-center bg-surface-100-900 border border-surface-200-800 rounded-lg p-1">
                            <button
                                onClick={prevRound}
                                disabled={currentRoundIdx === 0}
                                className="p-1.5 hover:bg-surface-200-800 rounded transition-colors disabled:opacity-30"
                            >
                                <ChevronLeft size={18} />
                            </button>
                            <div className="px-4 text-sm font-bold min-w-24 text-center">
                                Round {currentRoundIdx + 1} of {tournamentConfig.numRounds}
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
                                    <Dialog.Content className={`bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full space-y-4 shadow-xl transition-all ${scoreImportPhase === 'mapping' ? 'max-w-2xl' : 'max-w-lg'}`}>
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
                                                    The mapped data contains more than one round. Choose how much of the imported score data should be applied.
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

                                                    <label className="flex items-start gap-3 p-3 rounded-lg bg-surface-50-950 border border-surface-200-800 cursor-pointer hover:bg-surface-100-900 transition-colors">
                                                        <input
                                                            type="checkbox"
                                                            checked={scoreRoundOptions.importAllRounds}
                                                            onChange={(e) => setScoreRoundOptions(prev => ({ ...prev, importAllRounds: e.target.checked }))}
                                                            className="mt-1 accent-primary-500"
                                                        />
                                                        <div>
                                                            <p className="text-sm font-medium">Use import data for all rounds</p>
                                                            <p className="text-xs text-surface-600-400 mt-0.5">
                                                                Apply every mapped round and create missing rounds when the file includes player IDs and scores.
                                                            </p>
                                                        </div>
                                                    </label>

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
                                                            className="px-4 py-1.5 text-sm rounded preset-filled cursor-pointer"
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
                        onClick={() => setShowConfigModal(true)}
                        className="p-2 hover:bg-surface-200-800 rounded-lg transition-colors text-surface-500 hover:text-primary-500"
                        title="Tournament Settings"
                    >
                        <Settings size={20} />
                    </button>
                    {tournamentConfig && (
                        <button
                            onClick={handleResetTournament}
                            className="p-2 hover:bg-error-500/10 rounded-lg transition-colors text-surface-500 hover:text-error-500"
                            title="Reset Tournament"
                        >
                            <Trash2 size={20} />
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
                            
                            {isPairing ? (
                                <div className="flex flex-col items-end gap-1 min-w-48">
                                    <div className="flex justify-between w-full text-[10px] font-bold uppercase tracking-widest text-primary-500">
                                        <span>Engine {pairingProgress < 90 ? 'Initializing' : 'Pairing'}</span>
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
                                <button
                                    onClick={() => setShowSetupModal(true)}
                                    disabled={isPairing || (!isRoundComplete && rounds.length > 0)}
                                    className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-bold shadow-lg shadow-primary-500/20 disabled:opacity-50"
                                >
                                    <Play size={16} />
                                    {rounds.length === 0 ? 'Start Tournament' : 'Next Round'}
                                </button>
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
                    <div className="flex items-center gap-4 text-sm">
                        <div className="text-surface-600-400">
                            {currentRound.pairings.length} boards paired
                        </div>
                    </div>

                    <div className="border border-surface-200-800 rounded-xl overflow-hidden bg-surface-100-900 shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="bg-surface-50-950 border-b border-surface-200-800">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-10">Bd</th>
                                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-10">ID</th>
                                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-[10px] text-surface-500">White Name</th>
                                    <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-10">Fed</th>
                                    <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-10">Pts</th>
                                    <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-24">Result</th>
                                    <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-10">Pts</th>
                                    <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-10">Fed</th>
                                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-[10px] text-surface-500">Black Name</th>
                                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-10">ID</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-200-800">
                                {currentRound.pairings.map((pairing, idx) => {
                                    const whitePlayer = playerMap[pairing.whiteId];
                                    const blackPlayer = playerMap[pairing.blackId];

                                    return (
                                        <tr
                                            key={pairing.id}
                                            tabIndex={0}
                                            onKeyDown={(e) => handleKeyDown(e, pairing.id, idx)}
                                            className="hover:bg-surface-200-800/30 transition-colors focus:bg-primary-500/10 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary-500 outline-none cursor-pointer"
                                        >
                                            <td className="px-3 py-2 font-mono text-surface-500 text-[11px]">
                                                {idx + 1}
                                            </td>
                                            <td className="px-3 py-2 text-[11px] font-mono text-surface-400">
                                                {pairing.whiteId}
                                            </td>
                                            <td className="px-3 py-2">
                                                <PlayerInfo player={whitePlayer} side="white" />
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="text-[10px] font-bold text-surface-400 uppercase">{whitePlayer?.federation || '-'}</span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="font-mono font-bold text-primary-500 text-sm">
                                                    {playerScores[pairing.whiteId] || 0}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <select
                                                    value={pairing.result}
                                                    onChange={(e) => updateResult(pairing.id, e.target.value)}
                                                    className="w-full bg-surface-50-950 border border-surface-200-800 rounded px-1.5 py-1 text-center font-bold text-xs outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
                                                >
                                                    {RESULT_OPTIONS.map(opt => (
                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="font-mono font-bold text-primary-500 text-sm">
                                                    {pairing.isBye ? '-' : (playerScores[pairing.blackId] || 0)}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="text-[10px] font-bold text-surface-400 uppercase">{pairing.isBye ? '-' : (blackPlayer?.federation || '-')}</span>
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                {pairing.isBye ? (
                                                    <div className="flex flex-col items-end pr-2">
                                                        <span className="font-bold text-primary-500 uppercase tracking-widest italic text-xs">BYE</span>
                                                    </div>
                                                ) : (
                                                    <PlayerInfo player={blackPlayer} side="black" />
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-right text-[11px] font-mono text-surface-400">
                                                {pairing.isBye ? '-' : pairing.blackId}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <TournamentConfigModal
                open={showConfigModal}
                onClose={() => setShowConfigModal(false)}
                config={tournamentConfig}
                onSave={updateTournamentConfig}
            />

            <RoundSetupModal
                open={showSetupModal}
                onClose={() => setShowSetupModal(false)}
                onStart={handleStartPairing}
                roundNumber={rounds.length + 1}
            />

            <ConfirmationModal
                open={modal.open}
                onOpenChange={(open) => setModal(prev => ({ ...prev, open }))}
                title={modal.title}
                description={modal.description}
                onConfirm={modal.onConfirm}
                isAlert={modal.isAlert}
                variant={modal.variant}
                confirmText={modal.confirmText}
            />
        </div>
    );
}
