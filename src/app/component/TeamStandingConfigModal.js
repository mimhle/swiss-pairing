"use client";

import { useEffect, useState } from 'react';
import { Portal } from '@skeletonlabs/skeleton-react';
import { Check, GripVertical, Settings, X } from 'lucide-react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ScrollLock from '@/app/component/ScrollLock';
import { DEFAULT_TEAM_STANDING_OPTIONS, normalizeTeamStandingOptions } from '@/app/utilities/standingsLogic';

const TEAM_RANK_OPTIONS = [
    { id: 'individualRank', label: 'Individual Rank Sum', description: 'Lower total rank of counted players wins' },
    { id: 'score', label: 'Score', description: 'Higher total score of counted players wins' },
    { id: 'count', label: 'Player Count', description: 'Higher number of team players wins' },
    { id: 'topRank', label: 'Top Rank', description: 'Lower best individual rank wins' },
];

export default function TeamStandingConfigModal({ open, onClose, config, onSave }) {
    const [teamSource, setTeamSource] = useState(DEFAULT_TEAM_STANDING_OPTIONS.source);
    const [minPlayerCount, setMinPlayerCount] = useState(DEFAULT_TEAM_STANDING_OPTIONS.minPlayerCount);
    const [countMode, setCountMode] = useState(DEFAULT_TEAM_STANDING_OPTIONS.countMode);
    const [useGhostPlayers, setUseGhostPlayers] = useState(DEFAULT_TEAM_STANDING_OPTIONS.useGhostPlayers);
    const [rankOrder, setRankOrder] = useState(TEAM_RANK_OPTIONS.map(opt => opt.id));
    const [activeCriteria, setActiveCriteria] = useState(DEFAULT_TEAM_STANDING_OPTIONS.rankOrder);
    const sensors = useSensors(useSensor(PointerSensor));

    useEffect(() => {
        if (!open) return;

        const options = normalizeTeamStandingOptions(config?.teamStandingOptions);
        const completeRankOrder = [...options.rankOrder];
        TEAM_RANK_OPTIONS.forEach(opt => {
            if (!completeRankOrder.includes(opt.id)) completeRankOrder.push(opt.id);
        });

        setTeamSource(options.source);
        setMinPlayerCount(options.minPlayerCount);
        setCountMode(options.countMode);
        setUseGhostPlayers(options.useGhostPlayers);
        setActiveCriteria(options.rankOrder);
        setRankOrder(completeRankOrder);
    }, [config, open]);

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setRankOrder((items) => {
                const oldIndex = items.indexOf(active.id);
                const newIndex = items.indexOf(over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const handleToggleCriterion = (id) => {
        setActiveCriteria(prev =>
            prev.includes(id)
                ? prev.filter(item => item !== id)
                : [...prev, id]
        );
    };

    const handleSave = () => {
        const finalRankOrder = rankOrder.filter(id => activeCriteria.includes(id));
        onSave({
            source: teamSource,
            minPlayerCount: Math.max(1, Number(minPlayerCount) || DEFAULT_TEAM_STANDING_OPTIONS.minPlayerCount),
            countMode,
            useGhostPlayers,
            rankOrder: finalRankOrder.length ? finalRankOrder : DEFAULT_TEAM_STANDING_OPTIONS.rankOrder
        });
        onClose();
    };

    if (!open) return null;

    return (
        <Portal>
            <ScrollLock />
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" onClick={onClose} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-6 shadow-xl pointer-events-auto">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <Settings className="text-primary-500" size={20} />
                            Team Standing Calculation
                        </h2>
                        <button onClick={onClose} className="p-1 hover:bg-surface-200-800 rounded transition-colors" aria-label="Close team standing settings">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className="flex flex-col gap-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-surface-500">Team From</span>
                                <select
                                    className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary-500 transition-all"
                                    value={teamSource}
                                    onChange={(e) => setTeamSource(e.target.value)}
                                >
                                    <option value="federation">Federation</option>
                                    <option value="club">Club</option>
                                </select>
                            </label>

                            <label className="flex flex-col gap-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-surface-500">Counted Players</span>
                                <input
                                    type="number"
                                    min="1"
                                    className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary-500 transition-all font-mono"
                                    value={minPlayerCount}
                                    onChange={(e) => setMinPlayerCount(parseInt(e.target.value, 10) || 1)}
                                />
                            </label>
                        </div>

                        <div className="space-y-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-surface-500">Count Mode</span>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setCountMode('exact')}
                                    className={`rounded-md border px-3 py-2 text-left transition-colors ${countMode === 'exact' ? 'border-primary-500 bg-primary-500/10 text-primary-500' : 'border-surface-200-800 bg-surface-50-950 text-surface-600-400 hover:text-surface-900-100'}`}
                                >
                                    <span className="block text-xs font-bold">Exact</span>
                                    <span className="block text-[10px] leading-tight">Hide teams below the counted player count</span>
                                </button>
                                <button
                                    onClick={() => setCountMode('maximum')}
                                    className={`rounded-md border px-3 py-2 text-left transition-colors ${countMode === 'maximum' ? 'border-primary-500 bg-primary-500/10 text-primary-500' : 'border-surface-200-800 bg-surface-50-950 text-surface-600-400 hover:text-surface-900-100'}`}
                                >
                                    <span className="block text-xs font-bold">Maximum</span>
                                    <span className="block text-[10px] leading-tight">Fill missing slots with ghost players</span>
                                </button>
                            </div>
                        </div>

                        {countMode === 'maximum' && (
                            <label className="flex items-start gap-2 rounded-md border border-surface-200-800 bg-surface-50-950 px-3 py-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useGhostPlayers}
                                    onChange={(e) => setUseGhostPlayers(e.target.checked)}
                                    className="mt-0.5 cursor-pointer accent-primary-500"
                                />
                                <span className="min-w-0">
                                    <span className="block text-xs font-bold text-surface-900-100">Count with ghost players</span>
                                    <span className="block text-[10px] leading-tight text-surface-500">
                                        Missing slots count as 0 points with worst rank. When off, incomplete teams stay below complete teams by player count.
                                    </span>
                                </span>
                            </label>
                        )}

                        <div className="space-y-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-surface-500">Rank Priority</span>
                            <div className="bg-surface-50-950 border border-surface-200-800 rounded-lg overflow-hidden">
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                    <SortableContext items={rankOrder} strategy={verticalListSortingStrategy}>
                                        <div className="divide-y divide-surface-200-800">
                                            {rankOrder.map((id) => {
                                                const opt = TEAM_RANK_OPTIONS.find(o => o.id === id);
                                                return (
                                                    <SortableRankCriterion
                                                        key={id}
                                                        id={id}
                                                        label={opt.label}
                                                        description={opt.description}
                                                        active={activeCriteria.includes(id)}
                                                        onToggle={() => handleToggleCriterion(id)}
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

function SortableRankCriterion({ id, label, description, active, onToggle }) {
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
                className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${active ? 'bg-primary-500 border-primary-500 text-white' : 'border-surface-400-600'}`}
                aria-label={`${active ? 'Disable' : 'Enable'} ${label}`}
            >
                {active && <Check size={10} />}
            </button>

            <div className="min-w-0">
                <div className={`text-xs font-medium ${active ? 'text-surface-900-100' : 'text-surface-400'}`}>
                    {label}
                </div>
                <div className="text-[10px] text-surface-500 truncate">
                    {description}
                </div>
            </div>
        </div>
    );
}
