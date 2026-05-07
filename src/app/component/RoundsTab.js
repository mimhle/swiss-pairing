"use client";

import { useState, useEffect, useMemo, Fragment } from 'react';
import { useTournament } from '@/app/context/TournamentContext';
import { Swords, Play, Settings, ChevronRight, ChevronLeft, AlertTriangle, CheckCircle2, User, Info, Building2, Globe, GraduationCap, Users, Trash2 } from 'lucide-react';
import { Tooltip, Portal } from '@skeletonlabs/skeleton-react';
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

                if (wId) scores[wId] = (scores[wId] || 0) + (result === '1-0' || result === '1-0f' ? 1 : result === '0.5-0.5' ? 0.5 : 0);
                if (bId) scores[bId] = (scores[bId] || 0) + (result === '0-1' || result === '0-1f' ? 1 : result === '0.5-0.5' ? 0.5 : 0);
                if (p.isBye && wId) scores[wId] = (scores[wId] || 0) + 1;
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
