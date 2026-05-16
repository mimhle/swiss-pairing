"use client";

import { useState, useEffect } from 'react';
import { Dialog, Portal } from '@skeletonlabs/skeleton-react';
import { AlertTriangle, Settings, X, Check, GripVertical } from 'lucide-react';
import ScrollLock from '@/components/utility/ScrollLock';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const TIEBREAK_OPTIONS = [
    { id: 'bh', label: 'Buchholz (BH)', description: 'Sum of opponents\' scores' },
    { id: 'bh_cut1', label: 'Buchholz Cut 1', description: 'Buchholz minus the lowest opponent score' },
    { id: 'bh_virtual_cut1', label: 'Buchholz Virtual Cut 1', description: 'Unplayed games count as virtual opponents, then the lowest score is excluded' },
    { id: 'sb', label: 'Sonneborn-Berger (SB)', description: 'Sum of scores of defeated opponents plus half of drawn' },
    { id: 'wins', label: 'Number of Wins', description: 'Total games won' },
    { id: 'wins_black', label: 'Wins as Black', description: 'Number of games won with black pieces' },
    { id: 'games_black', label: 'Games as Black', description: 'Number of rounds played with black pieces' },
    { id: 'direct', label: 'Direct Encounter', description: 'Result between tied players' },
    { id: 'progressive', label: 'Progressive Score', description: 'Sum of cumulative scores after each round' },
];

export default function TournamentConfigModal({ open, onClose, config, onSave, lockPairingMode = false, defaultNumRounds = 5, maxNumRounds = 20, getRoundCountWarning }) {
    const [numRounds, setNumRounds] = useState(5);
    const [pairingMode, setPairingMode] = useState('all');
    const [tiebreakOrder, setTiebreakOrder] = useState(TIEBREAK_OPTIONS.map(opt => opt.id));
    const [activeTiebreaks, setActiveTiebreaks] = useState(['bh', 'sb', 'wins']);
    const [saveWarning, setSaveWarning] = useState(null);

    useEffect(() => {
        if (config) {
            setNumRounds(config.numRounds || 5);
            setPairingMode(config.pairingMode === 'group' ? 'group' : 'all');
            const savedTiebreaks = config.tiebreaks || ['bh', 'sb', 'wins'];
            setActiveTiebreaks(savedTiebreaks);

            // Ensure all options are in the order list, but prioritize saved order
            const savedOrder = [...savedTiebreaks];
            TIEBREAK_OPTIONS.forEach(opt => {
                if (!savedOrder.includes(opt.id)) savedOrder.push(opt.id);
            });
            setTiebreakOrder(savedOrder);
        } else {
            setNumRounds(defaultNumRounds);
            setPairingMode('all');
            setActiveTiebreaks(['bh', 'sb', 'wins']);
            setTiebreakOrder(TIEBREAK_OPTIONS.map(opt => opt.id));
        }
    }, [config, defaultNumRounds, open]);

    useEffect(() => {
        setSaveWarning(null);
    }, [numRounds, pairingMode, open]);

    const sensors = useSensors(useSensor(PointerSensor));

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setTiebreakOrder((items) => {
                const oldIndex = items.indexOf(active.id);
                const newIndex = items.indexOf(over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const handleToggleTiebreak = (id) => {
        setActiveTiebreaks(prev =>
            prev.includes(id)
                ? prev.filter(t => t !== id)
                : [...prev, id]
        );
    };

    const handleSave = async () => {
        if (inlineWarning) {
            setSaveWarning(inlineWarning);
            return;
        }

        // Only save active tiebreaks in the order they appear in tiebreakOrder
        const finalTiebreaks = tiebreakOrder.filter(id => activeTiebreaks.includes(id));
        const shouldClose = await onSave({
            ...(config || {}),
            numRounds: Number(numRounds) || 1,
            pairingMode,
            tiebreaks: finalTiebreaks,
        });

        if (shouldClose?.warning) {
            setSaveWarning(shouldClose.warning);
            return;
        }

        if (shouldClose !== false) onClose();
    };

    if (!open) return null;

    const inlineWarning = saveWarning || getRoundCountWarning?.({
        ...(config || {}),
        numRounds: Number(numRounds) || 1,
        pairingMode,
    });

    return (
        <Portal>
            <ScrollLock />
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" onClick={onClose} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-6 shadow-xl pointer-events-auto">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <Settings className="text-primary-500" size={20} />
                            Tournament Configuration
                        </h2>
                        <button onClick={onClose} className="p-1 hover:bg-surface-200-800 rounded transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <label className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-surface-500">Number of Rounds</span>
                            <input
                                type="number"
                                min="1"
                                max={maxNumRounds}
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary-500 transition-all font-mono"
                                value={numRounds}
                                onChange={(e) => setNumRounds(parseInt(e.target.value) || 1)}
                            />
                        </label>

                        {inlineWarning && (
                            <InlineWarning warning={inlineWarning} />
                        )}

                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-surface-500">Pairing Mode</span>
                                {lockPairingMode && (
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-surface-500">Locked after round 1</span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPairingMode('all')}
                                    disabled={lockPairingMode}
                                    className={`rounded border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${pairingMode === 'all'
                                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                                        : 'border-surface-200-800 bg-surface-50-950 hover:bg-surface-100-900'
                                    }`}
                                >
                                    <span className="block text-sm font-bold">All players</span>
                                    <span className="block text-[10px] text-surface-500">One pairing pool and one standings table.</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPairingMode('group')}
                                    disabled={lockPairingMode}
                                    className={`rounded border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${pairingMode === 'group'
                                        ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                                        : 'border-surface-200-800 bg-surface-50-950 hover:bg-surface-100-900'
                                    }`}
                                >
                                    <span className="block text-sm font-bold">By Group</span>
                                    <span className="block text-[10px] text-surface-500">Pair and rank each Group separately.</span>
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-surface-500">Tiebreaks & Priority</span>
                            <div className="bg-surface-50-950 border border-surface-200-800 rounded-lg overflow-hidden">
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                    <SortableContext items={tiebreakOrder} strategy={verticalListSortingStrategy}>
                                        <div className="divide-y divide-surface-200-800">
                                            {tiebreakOrder.map((id) => {
                                                const opt = TIEBREAK_OPTIONS.find(o => o.id === id);
                                                return (
                                                    <SortableTiebreakItem
                                                        key={id}
                                                        id={id}
                                                        label={opt.label}
                                                        active={activeTiebreaks.includes(id)}
                                                        onToggle={() => handleToggleTiebreak(id)}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            </div>
                            <p className="text-[9px] text-surface-500 uppercase text-center">Drag to reorder priority</p>
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
                            onClick={handleSave}
                            disabled={Boolean(inlineWarning)}
                            className="px-6 py-2 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors font-bold shadow-lg shadow-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
}

function InlineWarning({ warning }) {
    return (
        <div className="space-y-2 rounded-lg border border-warning-500/30 bg-warning-500/10 p-3">
            <div className="flex items-start gap-2 text-sm font-semibold text-warning-700 dark:text-warning-400">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{warning.message}</span>
            </div>
            {warning.details?.length > 0 && (
                <div className="space-y-1 pl-6">
                    {warning.details.map((detail, index) => (
                        <div key={`${detail.line || index}-${detail.reason}`} className="flex items-start gap-2 text-xs text-surface-700-300">
                            {detail.line !== undefined && (
                                <span className="shrink-0 font-mono text-surface-500">{detail.line}</span>
                            )}
                            <span>{detail.reason}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function SortableTiebreakItem({ id, label, active, onToggle }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 100 : 'auto',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-2 px-3 py-2 bg-surface-100-900 group ${isDragging ? 'opacity-50 ring-2 ring-primary-500 ring-inset' : ''}`}
        >
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-surface-400 hover:text-primary-500 transition-colors">
                <GripVertical size={14} />
            </div>

            <button
                onClick={onToggle}
                className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${active ? 'bg-primary-500 border-primary-500 text-white' : 'border-surface-400-600'
                    }`}
            >
                {active && <Check size={10} />}
            </button>

            <span className={`text-xs font-medium ${active ? 'text-surface-900-100' : 'text-surface-400'}`}>
                {label}
            </span>
        </div>
    );
}
