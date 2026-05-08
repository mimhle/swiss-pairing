"use client";

import { useEffect, useState } from 'react';
import { Portal } from '@skeletonlabs/skeleton-react';
import { AlertTriangle, Play, X, Shield, Palette, Trash2, UserX } from 'lucide-react';
import ScrollLock from '@/components/utility/ScrollLock';

export default function RoundSetupModal({ open, onClose, onStart, roundNumber, rounds = [], canStart = true, showDelete = true, excludedPlayers = [], unassignedPlayers = [], onDeleteRounds }) {
    const [startingColor, setStartingColor] = useState('white');
    const [protectClub, setProtectClub] = useState(false);
    const [deleteMode, setDeleteMode] = useState('selected');
    const [selectedRoundIndexes, setSelectedRoundIndexes] = useState([]);

    useEffect(() => {
        if (!open) {
            setDeleteMode('selected');
            setSelectedRoundIndexes([]);
        }
    }, [open]);

    useEffect(() => {
        setSelectedRoundIndexes(prev => prev.filter(index => index < rounds.length));
    }, [rounds.length]);

    const toggleRound = (roundIndex) => {
        setSelectedRoundIndexes(prev => {
            const firstSelected = Math.min(...prev);
            if (prev.includes(roundIndex) && roundIndex === firstSelected) return [];
            return rounds.map((_, index) => index).filter(index => index >= roundIndex);
        });
    };

    const selectedCount = deleteMode === 'all' ? rounds.length : selectedRoundIndexes.length;

    if (!open) return null;

    return (
        <Portal>
            <ScrollLock />
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" onClick={onClose} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-md space-y-6 shadow-xl pointer-events-auto max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <Play className="text-primary-500" size={20} />
                            Round Settings
                        </h2>
                        <button onClick={onClose} className="p-1 hover:bg-surface-200-800 rounded transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    {canStart && (
                        <div className="space-y-5">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-surface-500">
                                Round {roundNumber} Setup
                            </h3>
                            {unassignedPlayers.length > 0 && (
                                <div className="space-y-2 rounded-lg border border-warning-500/30 bg-warning-500/10 p-3">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-warning-700 dark:text-warning-400">
                                        <AlertTriangle size={14} />
                                        Unassigned Players Will Be Skipped
                                    </div>
                                    <p className="text-xs text-surface-700-300">
                                        These players are not assigned in the current round. When this next round is generated, they will be added to the current round as SKIP with a 0-0 result.
                                    </p>
                                    <div className="space-y-1">
                                        {unassignedPlayers.map(player => {
                                            const playerId = player.playerUniqueId ?? player.id;
                                            return (
                                                <div key={playerId} className="flex items-center justify-between gap-3 text-xs">
                                                    <span className="min-w-0 truncate font-medium">{player.name || 'Unnamed'}</span>
                                                    <span className="shrink-0 font-mono text-surface-600-400">#{playerId}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {roundNumber === 1 && (
                                <div className="space-y-3">
                                    <span className="text-sm font-semibold uppercase tracking-wider text-surface-500 flex items-center gap-2">
                                        <Palette size={14} />
                                        Top Seed Starting Color
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setStartingColor('white')}
                                            className={`flex-1 py-3 rounded-lg border transition-all font-medium text-sm flex items-center justify-center gap-2 ${startingColor === 'white'
                                                    ? 'bg-primary-500/10 text-primary-700 dark:text-primary-300 border-primary-500 ring-1 ring-primary-500/40'
                                                    : 'bg-surface-50-950 text-surface-700-300 border-surface-200-800 hover:border-primary-500/50'
                                                }`}
                                        >
                                            <span className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${startingColor === 'white'
                                                    ? 'border-primary-500 bg-primary-500 text-white'
                                                    : 'border-surface-300-700 bg-surface-100-900 text-surface-700-300'
                                                }`}>
                                                W
                                            </span>
                                            White
                                        </button>
                                        <button
                                            onClick={() => setStartingColor('black')}
                                            className={`flex-1 py-3 rounded-lg border transition-all font-medium text-sm flex items-center justify-center gap-2 ${startingColor === 'black'
                                                    ? 'bg-primary-500/10 text-primary-700 dark:text-primary-300 border-primary-500 ring-1 ring-primary-500/40'
                                                    : 'bg-surface-50-950 text-surface-700-300 border-surface-200-800 hover:border-primary-500/50'
                                                }`}
                                        >
                                            <span className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${startingColor === 'black'
                                                    ? 'border-primary-500 bg-primary-500 text-white'
                                                    : 'border-surface-300-700 bg-surface-100-900 text-surface-700-300'
                                                }`}>
                                                B
                                            </span>
                                            Black
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-3">
                                <span className="text-sm font-semibold uppercase tracking-wider text-surface-500 flex items-center gap-2">
                                    <Shield size={14} />
                                    Pairing Protections
                                </span>
                                <label className="flex items-start gap-3 p-3 rounded-lg bg-surface-50-950 border border-surface-200-800 cursor-pointer hover:bg-surface-100-900 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={protectClub}
                                        onChange={(e) => setProtectClub(e.target.checked)}
                                        className="mt-1 accent-primary-500"
                                    />
                                    <div>
                                        <p className="text-sm font-medium">Protect Club/Fed</p>
                                        <p className="text-xs text-surface-600-400">Avoid pairing players from the same club or federation if possible.</p>
                                    </div>
                                </label>
                            </div>

                            {excludedPlayers.length > 0 && (
                                <div className="space-y-2 rounded-lg border border-warning-500/30 bg-warning-500/10 p-3">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-warning-700 dark:text-warning-400">
                                        <UserX size={14} />
                                        Not Matched Next Round
                                    </div>
                                    <div className="space-y-1">
                                        {excludedPlayers.map(player => {
                                            const playerId = player.playerUniqueId ?? player.id;
                                            return (
                                            <div key={playerId} className="flex items-center justify-between gap-3 text-xs">
                                                <span className="min-w-0 truncate font-medium">{player.name || 'Unnamed'}</span>
                                                <span className="shrink-0 font-mono text-surface-600-400">#{playerId}</span>
                                            </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {showDelete && rounds.length > 0 && (
                        <div className="space-y-4 border-t border-surface-200-800 pt-5">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-error-600 dark:text-error-500 flex items-center gap-2">
                                <Trash2 size={14} />
                                Delete Rounds
                            </h3>

                            <div className="grid gap-2 sm:grid-cols-2">
                                <label className="flex items-start gap-3 p-3 rounded-lg bg-surface-50-950 border border-surface-200-800 cursor-pointer hover:bg-surface-100-900 transition-colors">
                                    <input
                                        type="radio"
                                        name="delete-round-mode"
                                        checked={deleteMode === 'selected'}
                                        onChange={() => setDeleteMode('selected')}
                                        className="mt-1 accent-primary-500"
                                    />
                                    <div>
                                        <p className="text-sm font-medium">Selected rounds</p>
                                        <p className="text-xs text-surface-600-400">Delete only checked rounds.</p>
                                    </div>
                                </label>
                                <label className="flex items-start gap-3 p-3 rounded-lg bg-error-500/10 border border-error-500/30 cursor-pointer hover:bg-error-500/15 transition-colors">
                                    <input
                                        type="radio"
                                        name="delete-round-mode"
                                        checked={deleteMode === 'all'}
                                        onChange={() => setDeleteMode('all')}
                                        className="mt-1 accent-error-500"
                                    />
                                    <div>
                                        <p className="text-sm font-medium text-error-600 dark:text-error-400">All rounds</p>
                                        <p className="text-xs text-surface-600-400">Keep players and tournament setup.</p>
                                    </div>
                                </label>
                            </div>

                            {deleteMode === 'selected' && (
                                <div className="bg-surface-50-950 border border-surface-200-800 rounded-lg divide-y divide-surface-200-800 max-h-44 overflow-y-auto">
                                    {rounds.map((round, index) => (
                                        <label key={round.roundNumber || index} className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer hover:bg-surface-100-900 transition-colors">
                                            <div>
                                                <p className="text-sm font-medium">Round {round.roundNumber || index + 1}</p>
                                                <p className="text-xs text-surface-600-400">{round.pairings.length} board{round.pairings.length !== 1 ? 's' : ''}</p>
                                            </div>
                                            <input
                                                type="checkbox"
                                                checked={selectedRoundIndexes.includes(index)}
                                                onChange={() => toggleRound(index)}
                                                className="accent-error-500"
                                            />
                                        </label>
                                    ))}
                                </div>
                            )}

                            <button
                                onClick={() => {
                                    onDeleteRounds?.({ mode: deleteMode, selectedRoundIndexes });
                                    setSelectedRoundIndexes([]);
                                    setDeleteMode('selected');
                                }}
                                disabled={selectedCount === 0}
                                className="flex items-center justify-center gap-1.5 w-full px-4 py-2 text-sm rounded preset-filled-error cursor-pointer font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Trash2 size={16} />
                                {deleteMode === 'all' ? 'Delete All Rounds' : `Delete Selected${selectedCount ? ` (${selectedCount})` : ''}`}
                            </button>
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm rounded preset-tonal cursor-pointer"
                        >
                            Close
                        </button>
                        {canStart && (
                            <button
                                onClick={() => onStart({ startingColor, protectClub })}
                                className="px-6 py-2 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors font-medium shadow-lg shadow-primary-500/20 flex items-center gap-2"
                            >
                                <Play size={14} />
                                Generate Pairings
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </Portal>
    );
}
