"use client";

import { useState, useEffect } from 'react';
import { Dialog, Portal } from '@skeletonlabs/skeleton-react';
import { Settings, X, Check, GripVertical } from 'lucide-react';
import ScrollLock from '@/app/component/ScrollLock';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const TIEBREAK_OPTIONS = [
    { id: 'bh', label: 'Buchholz (BH)', description: 'Sum of opponents\' scores' },
    { id: 'bh_cut1', label: 'Buchholz Cut 1', description: 'Buchholz minus the lowest opponent score' },
    { id: 'sb', label: 'Sonneborn-Berger (SB)', description: 'Sum of scores of defeated opponents plus half of drawn' },
    { id: 'wins', label: 'Number of Wins', description: 'Total games won' },
    { id: 'wins_black', label: 'Wins as Black', description: 'Number of games won with black pieces' },
    { id: 'games_black', label: 'Games as Black', description: 'Number of rounds played with black pieces' },
    { id: 'direct', label: 'Direct Encounter', description: 'Result between tied players' },
    { id: 'progressive', label: 'Progressive Score', description: 'Sum of cumulative scores after each round' },
];

export default function TournamentConfigModal({ open, onClose, config, onSave }) {
    const [numRounds, setNumRounds] = useState(5);
    const [tiebreakOrder, setTiebreakOrder] = useState(TIEBREAK_OPTIONS.map(opt => opt.id));
    const [activeTiebreaks, setActiveTiebreaks] = useState(['bh', 'sb', 'wins']);

    useEffect(() => {
        if (config) {
            setNumRounds(config.numRounds || 5);
            const savedTiebreaks = config.tiebreaks || ['bh', 'sb', 'wins'];
            setActiveTiebreaks(savedTiebreaks);

            // Ensure all options are in the order list, but prioritize saved order
            const savedOrder = [...savedTiebreaks];
            TIEBREAK_OPTIONS.forEach(opt => {
                if (!savedOrder.includes(opt.id)) savedOrder.push(opt.id);
            });
            setTiebreakOrder(savedOrder);
        }
    }, [config, open]);

    const sensors = useSensors(useSensor(PointerSensor));

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (active.id !== over.id) {
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

    const handleSave = () => {
        // Only save active tiebreaks in the order they appear in tiebreakOrder
        const finalTiebreaks = tiebreakOrder.filter(id => activeTiebreaks.includes(id));
        onSave({
            numRounds,
            tiebreaks: finalTiebreaks
        });
        onClose();
    };

    if (!open) return null;

    return (
        <Portal>
            <ScrollLock />
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" onClick={onClose} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-sm space-y-6 shadow-xl pointer-events-auto">
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
                                max="20"
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary-500 transition-all font-mono"
                                value={numRounds}
                                onChange={(e) => setNumRounds(parseInt(e.target.value) || 1)}
                            />
                        </label>

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
                            className="px-6 py-2 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors font-bold shadow-lg shadow-primary-500/20"
                        >
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
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
