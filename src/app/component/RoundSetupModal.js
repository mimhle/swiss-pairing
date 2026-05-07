"use client";

import { useState } from 'react';
import { Portal } from '@skeletonlabs/skeleton-react';
import { Play, X, Shield, Palette } from 'lucide-react';
import ScrollLock from '@/app/component/ScrollLock';

export default function RoundSetupModal({ open, onClose, onStart, roundNumber }) {
    const [startingColor, setStartingColor] = useState('white');
    const [protectClub, setProtectClub] = useState(false);

    if (!open) return null;

    return (
        <Portal>
            <ScrollLock />
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" onClick={onClose} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-sm space-y-6 shadow-xl pointer-events-auto">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <Play className="text-primary-500" size={20} />
                            Round {roundNumber} Setup
                        </h2>
                        <button onClick={onClose} className="p-1 hover:bg-surface-200-800 rounded transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="space-y-5">
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
                                                ? 'bg-white text-black border-white shadow-lg shadow-white/10'
                                                : 'bg-surface-800 text-surface-400 border-surface-700 hover:border-surface-500'
                                            }`}
                                    >
                                        <div className="w-3 h-3 rounded-full bg-white border border-gray-300" />
                                        White
                                    </button>
                                    <button
                                        onClick={() => setStartingColor('black')}
                                        className={`flex-1 py-3 rounded-lg border transition-all font-medium text-sm flex items-center justify-center gap-2 ${startingColor === 'black'
                                                ? 'bg-surface-950 text-white border-white shadow-lg shadow-black/10'
                                                : 'bg-surface-800 text-surface-400 border-surface-700 hover:border-surface-500'
                                            }`}
                                    >
                                        <div className="w-3 h-3 rounded-full bg-black border border-gray-600" />
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
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm rounded preset-tonal cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => onStart({ startingColor, protectClub })}
                            className="px-6 py-2 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors font-medium shadow-lg shadow-primary-500/20 flex items-center gap-2"
                        >
                            <Play size={14} />
                            Generate Pairings
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
}
