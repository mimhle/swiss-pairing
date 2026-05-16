"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Portal } from '@skeletonlabs/skeleton-react';
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowDown, ArrowLeftRight, ArrowUp, GripVertical, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import ScrollLock from '@/components/utility/ScrollLock';

const emptyBoard = (group = '') => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    whiteId: null,
    blackId: null,
    byeId: null,
    forfeitId: null,
    isSkip: false,
    group,
});

const normalizeId = (id) => id === null || id === undefined || id === '' ? null : String(id);

function getUnpairedSlotLabel(boards, targetIndex) {
    const trueByeIndex = boards.findIndex(board => board.byeId && !board.isSkip);
    if (trueByeIndex !== -1) {
        return targetIndex === trueByeIndex ? 'Bye' : 'Skip';
    }

    const firstOpenIndex = boards.findIndex(board => !board.byeId);
    return targetIndex === firstOpenIndex ? 'Bye' : 'Skip';
}

function isBoardPopulated(board) {
    return Boolean(board.whiteId && board.blackId);
}

function isBoardEmpty(board) {
    return !board.whiteId && !board.blackId;
}

function appendBoardWhenAllPopulated(boards, group = '') {
    return boards.length > 0 && boards.every(isBoardPopulated)
        ? [...boards, emptyBoard(group)]
        : boards;
}

function ensureGroupHasEmptyBoard(boards, group, getBoardGroup) {
    if (!group) return boards;
    const hasGroupEmptyBoard = boards.some(board => getBoardGroup(board) === group && isBoardEmpty(board));
    if (hasGroupEmptyBoard) return boards;

    const ungroupedEmptyIndex = boards.findIndex(board => !board.group && isBoardEmpty(board));
    if (ungroupedEmptyIndex !== -1) {
        return boards.map((board, index) => index === ungroupedEmptyIndex ? { ...board, group } : board);
    }

    return [...boards, emptyBoard(group)];
}

function appendBoardWhenGroupPopulated(boards, group, getBoardGroup) {
    if (!group) return boards;
    const groupBoards = boards.filter(board => getBoardGroup(board) === group);
    return groupBoards.length > 0 && groupBoards.every(isBoardPopulated)
        ? [...boards, emptyBoard(group)]
        : boards;
}

function initialRegularBoards(initialBoards) {
    const regularBoards = initialBoards
        .filter(board => !board.byeId && !board.forfeitId)
            .map(board => ({
            id: board.id || emptyBoard().id,
            whiteId: normalizeId(board.whiteId),
            blackId: normalizeId(board.blackId),
            group: String(board.group || '').trim(),
            manual: Boolean(board.manual),
        }));
    return regularBoards.length ? regularBoards : [emptyBoard()];
}

function uniqueNormalizedIds(ids) {
    return [...new Set(ids.map(normalizeId).filter(Boolean))];
}

function initialSpecialAssignments(initialBoards, forfeitedPlayerIds) {
    return {
        byeIds: initialBoards
            .filter(board => board.byeId && !board.isSkip && !board.forfeitId)
            .map(board => normalizeId(board.byeId))
            .filter(Boolean),
        skipIds: initialBoards
            .filter(board => board.byeId && board.isSkip && !board.forfeitId)
            .map(board => normalizeId(board.byeId))
            .filter(Boolean),
        forfeitIds: uniqueNormalizedIds([
            ...initialBoards
                .filter(board => board.forfeitId)
                .map(board => board.forfeitId),
            ...forfeitedPlayerIds,
        ]),
    };
}

function playerLabel(player) {
    if (!player) return 'Empty';
    return `${player.playerUniqueId}. ${player.name || 'Unnamed'}`;
}

function PlayerCard({ player, score, compact = false }) {
    return (
        <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[10px] text-surface-500 shrink-0">#{player.playerUniqueId}</span>
                <span className="font-bold text-sm truncate">{player.name || 'Unnamed'}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] uppercase text-surface-500 font-bold">
                <span>{score || 0} pts</span>
                <span>Rtg {player.rating || 0}</span>
                {!compact && <span className="truncate">{player.federation || player.club || '-'}</span>}
            </div>
        </div>
    );
}

function DraggablePlayer({ player, score, compact = false, onClick }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `player-${player.playerUniqueId}`,
        data: { playerId: String(player.playerUniqueId) },
    });

    const style = {
        opacity: isDragging ? 0.45 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onClick={onClick}
            className="flex items-center gap-2 rounded border border-surface-200-800 bg-surface-100-900 px-2 py-2 cursor-grab active:cursor-grabbing hover:border-primary-500/60 transition-colors"
        >
            <GripVertical size={14} className="text-surface-400 shrink-0" />
            <PlayerCard player={player} score={score} compact={compact} />
        </div>
    );
}

function DragPreview({ player, score }) {
    if (!player) return null;

    return (
        <div className="flex items-center gap-2 rounded border border-primary-500 bg-surface-100-900 px-2 py-2 shadow-2xl shadow-black/30 w-64 cursor-grabbing">
            <GripVertical size={14} className="text-primary-500 shrink-0" />
            <PlayerCard player={player} score={score} />
        </div>
    );
}

function DroppableArea({ id, children, className = '', ...props }) {
    const { isOver, setNodeRef } = useDroppable({ id });

    return (
        <div
            ref={setNodeRef}
            className={`${className} ${isOver ? 'ring-2 ring-primary-500 ring-inset bg-primary-500/10' : ''}`}
            {...props}
        >
            {children}
        </div>
    );
}

function BoardSlot({ id, label, player, score, isEmpty, tone = 'surface', onClear }) {
    return (
        <DroppableArea
            id={id}
            data-manual-slot-id={isEmpty ? id : undefined}
            className={`min-h-16 rounded border border-dashed px-3 py-2 transition-colors ${
                player
                    ? 'border-surface-300-700 bg-surface-50-950'
                    : tone === 'forfeit'
                        ? 'border-error-500/40 bg-error-500/5'
                    : tone === 'bye'
                        ? 'border-warning-500/40 bg-warning-500/5'
                        : 'border-surface-300-700 bg-surface-50-950/70'
            }`}
        >
            <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-surface-500">{label}</span>
                {player && (
                    <button
                        onClick={onClear}
                        className="p-0.5 rounded text-surface-400 hover:text-error-500 transition-colors"
                        aria-label={`Clear ${label}`}
                    >
                        <X size={12} />
                    </button>
                )}
            </div>
            {player ? (
                <DraggablePlayer player={player} score={score} compact onClick={onClear} />
            ) : (
                <div className="text-xs text-surface-400">
                    {tone === 'bye' || tone === 'forfeit' ? `Drop for ${label.toLowerCase()}` : 'Drop player'}
                </div>
            )}
        </DroppableArea>
    );
}

function SpecialDropZone({ id, label, tone }) {
    return (
        <DroppableArea
            id={id}
            className={`min-h-14 rounded border border-dashed px-3 py-2 transition-colors ${
                tone === 'forfeit'
                    ? 'border-error-500/40 bg-error-500/5'
                    : 'border-warning-500/40 bg-warning-500/5'
            }`}
        >
            <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500 mb-1">{label}</div>
            <div className="text-xs text-surface-400">Drop player</div>
        </DroppableArea>
    );
}

function SpecialAssignmentColumn({ title, tone, playerIds, dropId, playerMap, playerScores, onClear }) {
    return (
        <div className="rounded border border-surface-200-800 bg-surface-100-900 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500">{title}</div>
                <span className="text-[10px] font-mono text-surface-500">{playerIds.length}</span>
            </div>
            <div className="space-y-2">
                {playerIds.map(playerId => playerMap[playerId] && (
                    <div key={`${title}-${playerId}`} className="flex items-start gap-2 rounded border border-surface-200-800 bg-surface-50-950 p-2">
                        <div className="min-w-0 flex-1">
                            <DraggablePlayer player={playerMap[playerId]} score={playerScores[playerId] || 0} compact />
                        </div>
                        <button
                            onClick={() => onClear(playerId)}
                            className="mt-1 p-0.5 rounded text-surface-400 hover:text-error-500 transition-colors"
                            aria-label={`Clear ${title}`}
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
                <SpecialDropZone id={dropId} label={title} tone={tone} />
            </div>
        </div>
    );
}

function ByeAssignmentColumn({ playerIds, playerMap, playerScores, onClear }) {
    return (
        <SpecialAssignmentColumn
            title="Bye"
            tone="bye"
            playerIds={playerIds}
            dropId="special:bye"
            playerMap={playerMap}
            playerScores={playerScores}
            onClear={onClear}
        />
    );
}

function SortableBoard({
    board,
    index,
    displayIndex = index,
    displayBoardCount,
    warnings,
    playerMap,
    playerScores,
    onClearSlot,
    onMove,
    onRemove,
    onSwapColors,
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: board.id,
        data: { type: 'board' },
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`rounded-lg border border-surface-200-800 bg-surface-50-950/60 p-3 space-y-3 ${isDragging ? 'ring-2 ring-primary-500 ring-inset' : ''}`}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <button
                        {...attributes}
                        {...listeners}
                        className="p-1.5 rounded cursor-grab active:cursor-grabbing text-surface-400 hover:text-primary-500 hover:bg-surface-200-800 transition-colors"
                        aria-label={`Drag board ${displayIndex + 1}`}
                    >
                        <GripVertical size={15} />
                    </button>
                    <div className="flex items-center gap-2">
                        <div className="font-bold text-sm">Board {displayIndex + 1}</div>
                        {board.manual && (
                            <span
                                className="rounded bg-primary-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400"
                                title="Manually paired"
                            >
                                M
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onMove(index, -1)}
                        disabled={displayIndex === 0}
                        className="p-1.5 rounded hover:bg-surface-200-800 disabled:opacity-30 transition-colors"
                        title="Move board up"
                        aria-label={`Move board ${displayIndex + 1} up`}
                    >
                        <ArrowUp size={15} />
                    </button>
                    <button
                        onClick={() => onMove(index, 1)}
                        disabled={displayIndex === displayBoardCount - 1}
                        className="p-1.5 rounded hover:bg-surface-200-800 disabled:opacity-30 transition-colors"
                        title="Move board down"
                        aria-label={`Move board ${displayIndex + 1} down`}
                    >
                        <ArrowDown size={15} />
                    </button>
                    <button
                        onClick={() => onSwapColors(board.id)}
                        className="p-1.5 rounded hover:bg-surface-200-800 transition-colors"
                        title="Swap colors"
                    >
                        <ArrowLeftRight size={15} />
                    </button>
                    <button
                        onClick={() => onRemove(board.id)}
                        className="p-1.5 rounded hover:bg-error-500/10 text-surface-500 hover:text-error-500 transition-colors"
                        title="Remove board"
                    >
                        <Trash2 size={15} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <BoardSlot
                    id={`slot:${board.id}:white`}
                    label="White"
                    player={playerMap[board.whiteId]}
                    score={playerScores[board.whiteId] || 0}
                    isEmpty={!board.whiteId}
                    onClear={() => onClearSlot(board.id, 'whiteId')}
                />
                <BoardSlot
                    id={`slot:${board.id}:black`}
                    label="Black"
                    player={playerMap[board.blackId]}
                    score={playerScores[board.blackId] || 0}
                    isEmpty={!board.blackId}
                    onClear={() => onClearSlot(board.id, 'blackId')}
                />
            </div>

            {warnings.length > 0 && (
                <div className="flex items-start gap-2 rounded border border-error-500/30 bg-error-500/10 px-3 py-2 text-xs text-error-600 dark:text-error-400">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <div className="space-y-1">
                        {warnings.map((warning, warningIndex) => (
                            <div key={warningIndex}>{warning}</div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function ManualPairingModal({
    open,
    mode = 'create',
    roundNumber,
    players = [],
    pairingMode = 'all',
    playerScores = {},
    initialBoards = [],
    previousOpponentSet = new Set(),
    previousByeSet = new Set(),
    forfeitedPlayerIds = new Set(),
    isSaving = false,
    validationWarning = null,
    onClose,
    onSave,
}) {
    const [boards, setBoards] = useState(() => initialRegularBoards(initialBoards));
    const initialSpecial = useMemo(
        () => initialSpecialAssignments(initialBoards, forfeitedPlayerIds),
        [forfeitedPlayerIds, initialBoards]
    );
    const [specialAssignments, setSpecialAssignments] = useState(() => initialSpecial);
    const [activePlayerId, setActivePlayerId] = useState(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

    const playerMap = useMemo(() => {
        return players.reduce((acc, player) => {
            acc[String(player.playerUniqueId)] = player;
            return acc;
        }, {});
    }, [players]);
    const isGroupMode = pairingMode === 'group';
    const groupOptions = useMemo(() => {
        if (!isGroupMode) return [];
        return [...new Set(players.map(player => String(player.group || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }, [isGroupMode, players]);
    const [selectedGroup, setSelectedGroup] = useState('');

    useEffect(() => {
        if (!isGroupMode) return;
        if (groupOptions.length && !groupOptions.includes(selectedGroup)) {
            setSelectedGroup(groupOptions[0]);
        }
    }, [groupOptions, isGroupMode, selectedGroup]);

    const getPlayerGroup = useCallback((playerId) => String(playerMap[playerId]?.group || '').trim(), [playerMap]);
    const getBoardGroup = useCallback((board) => {
        const boardGroup = String(board.group || '').trim();
        if (boardGroup) return boardGroup;
        return getPlayerGroup(board.whiteId) || getPlayerGroup(board.blackId);
    }, [getPlayerGroup]);

    useEffect(() => {
        if (!isGroupMode || !selectedGroup) return;
        setBoards(prev => ensureGroupHasEmptyBoard(prev, selectedGroup, getBoardGroup));
    }, [getBoardGroup, isGroupMode, selectedGroup]);

    const assignedIds = useMemo(() => {
        const ids = new Set();
        boards.forEach(board => {
            [board.whiteId, board.blackId].filter(Boolean).forEach(id => ids.add(String(id)));
        });
        [...specialAssignments.byeIds, ...specialAssignments.skipIds, ...specialAssignments.forfeitIds]
            .filter(Boolean)
            .forEach(id => ids.add(String(id)));
        return ids;
    }, [boards, specialAssignments]);

    const availablePlayers = useMemo(() => {
        return players
            .filter(player => !assignedIds.has(String(player.playerUniqueId)) && !forfeitedPlayerIds.has(String(player.playerUniqueId)))
            .sort((a, b) => {
                if (isGroupMode) {
                    const groupCompare = String(a.group || '').trim().localeCompare(String(b.group || '').trim(), undefined, { numeric: true });
                    if (groupCompare) return groupCompare;
                }
                const scoreDiff = (playerScores[b.playerUniqueId] || 0) - (playerScores[a.playerUniqueId] || 0);
                if (scoreDiff) return scoreDiff;
                const ratingDiff = (parseInt(b.rating, 10) || 0) - (parseInt(a.rating, 10) || 0);
                if (ratingDiff) return ratingDiff;
                return Number(a.playerUniqueId) - Number(b.playerUniqueId);
            });
    }, [assignedIds, forfeitedPlayerIds, isGroupMode, playerScores, players]);
    const focusedAvailablePlayers = useMemo(() => {
        if (!isGroupMode || !selectedGroup) return availablePlayers;
        return availablePlayers.filter(player => String(player.group || '').trim() === selectedGroup);
    }, [availablePlayers, isGroupMode, selectedGroup]);
    const visibleBoardEntries = useMemo(() => {
        const entries = boards.map((board, index) => ({ board, index }));
        if (!isGroupMode || !selectedGroup) return entries;
        return entries.filter(({ board }) => getBoardGroup(board) === selectedGroup);
    }, [boards, getBoardGroup, isGroupMode, selectedGroup]);
    const getVisibleSpecialIds = useCallback((playerIds) => {
        if (!isGroupMode || !selectedGroup) return playerIds;
        return playerIds.filter(playerId => getPlayerGroup(playerId) === selectedGroup);
    }, [getPlayerGroup, isGroupMode, selectedGroup]);
    const visibleByeIds = useMemo(
        () => getVisibleSpecialIds(specialAssignments.byeIds),
        [getVisibleSpecialIds, specialAssignments.byeIds]
    );
    const visibleSkipIds = useMemo(
        () => getVisibleSpecialIds(specialAssignments.skipIds),
        [getVisibleSpecialIds, specialAssignments.skipIds]
    );
    const visibleForfeitIds = useMemo(
        () => getVisibleSpecialIds(specialAssignments.forfeitIds),
        [getVisibleSpecialIds, specialAssignments.forfeitIds]
    );

    const manualSkipCount = specialAssignments.skipIds.length;
    const manualForfeitCount = specialAssignments.forfeitIds.length;

    const boardWarnings = useMemo(() => {
        return boards.reduce((acc, board) => {
            const warnings = [];
            if (board.whiteId && board.blackId) {
                const key = [String(board.whiteId), String(board.blackId)].sort().join('|');
                if (previousOpponentSet.has(key)) {
                    warnings.push(`${playerLabel(playerMap[board.whiteId])} and ${playerLabel(playerMap[board.blackId])} already played.`);
                }
                if (isGroupMode) {
                    const whiteGroup = String(playerMap[board.whiteId]?.group || '').trim();
                    const blackGroup = String(playerMap[board.blackId]?.group || '').trim();
                    if (whiteGroup !== blackGroup) {
                        warnings.push(`${playerLabel(playerMap[board.whiteId])} and ${playerLabel(playerMap[board.blackId])} are in different groups.`);
                    }
                }
            }
            if (warnings.length) acc[board.id] = warnings;
            return acc;
        }, {});
    }, [boards, isGroupMode, playerMap, previousOpponentSet]);

    const specialWarnings = useMemo(() => {
        return specialAssignments.byeIds
            .filter(playerId => previousByeSet.has(String(playerId)))
            .map(playerId => `${playerLabel(playerMap[playerId])} already received a bye.`);
    }, [playerMap, previousByeSet, specialAssignments.byeIds]);

    const remainderWarnings = useMemo(() => {
        if (availablePlayers.length === 2) {
            const [first, second] = availablePlayers;
            const key = [String(first.playerUniqueId), String(second.playerUniqueId)].sort().join('|');
            if (previousOpponentSet.has(key)) {
                return [`${playerLabel(first)} and ${playerLabel(second)} already played. Move one player into a manual board, bye, skip, or forfeit before saving.`];
            }
        }

        if (availablePlayers.length === 1 && previousByeSet.has(String(availablePlayers[0].playerUniqueId))) {
            return [`${playerLabel(availablePlayers[0])} would receive a second bye. Resolve this manually before saving.`];
        }

        return [];
    }, [availablePlayers, previousByeSet, previousOpponentSet]);

    const manualWarningCount = useMemo(() => {
        return Object.values(boardWarnings).reduce((count, warnings) => count + warnings.length, 0) +
            specialWarnings.length;
    }, [boardWarnings, specialWarnings]);
    const blockingWarningCount = manualWarningCount + remainderWarnings.length;
    const hasManualWarnings = manualWarningCount > 0;
    const hasValidationWarning = Boolean(validationWarning);
    const hasBlockingWarnings = blockingWarningCount > 0;

    const clearPlayerFromBoards = (items, playerId) => {
        const id = String(playerId);
        return items.map(board => ({
            ...board,
            whiteId: board.whiteId === id ? null : board.whiteId,
            blackId: board.blackId === id ? null : board.blackId,
        }));
    };

    const clearPlayerFromSpecial = (special, playerId) => {
        const id = String(playerId);
        return {
            byeIds: special.byeIds.filter(candidate => candidate !== id),
            skipIds: special.skipIds.filter(candidate => candidate !== id),
            forfeitIds: special.forfeitIds.filter(candidate => candidate !== id),
        };
    };

    const clearSpecialPlayer = (playerId) => {
        setSpecialAssignments(prev => clearPlayerFromSpecial(prev, playerId));
    };

    const buildSaveBoards = () => [
        ...boards.filter(board => board.whiteId || board.blackId || board.byeId || board.forfeitId),
        ...specialAssignments.byeIds.map(playerId => ({ id: `special-bye-${playerId}`, byeId: playerId, isSkip: false })),
        ...specialAssignments.skipIds.map(playerId => ({ id: `special-skip-${playerId}`, byeId: playerId, isSkip: true })),
        ...specialAssignments.forfeitIds.map(playerId => ({ id: `special-forfeit-${playerId}`, forfeitId: playerId })),
    ];

    const handleDragStart = ({ active }) => {
        const playerId = String(active.data.current?.playerId || '').trim();
        setActivePlayerId(playerId || null);
    };

    const assignPlayerToBoardSlot = (playerId, slotId) => {
        const [prefix, boardId, slot] = String(slotId).split(':');
        if (prefix !== 'slot' || !boardId || !slot) return;

        setBoards(prev => {
            const cleared = clearPlayerFromBoards(prev, playerId);
            const nextBoards = cleared.map(board => {
                if (board.id !== boardId) return board;
                return {
                    ...board,
                    [slot === 'white' ? 'whiteId' : 'blackId']: playerId,
                    group: board.group || getPlayerGroup(playerId),
                };
            });
            if (!isGroupMode) return appendBoardWhenAllPopulated(nextBoards);
            return appendBoardWhenGroupPopulated(nextBoards, selectedGroup || getPlayerGroup(playerId), getBoardGroup);
        });
        clearSpecialPlayer(playerId);
    };

    const findClosestEmptySlotId = (sourceElement) => {
        const openBoards = boards
            .filter(board => !isGroupMode || !selectedGroup || getBoardGroup(board) === selectedGroup)
            .map(board => ({
                board,
                emptySlotIds: [
                    ...(!board.whiteId ? [`slot:${board.id}:white`] : []),
                    ...(!board.blackId ? [`slot:${board.id}:black`] : []),
                ],
            }))
            .filter(({ emptySlotIds }) => emptySlotIds.length);
        if (!openBoards.length) return null;

        const partiallyFilledBoards = openBoards.filter(({ emptySlotIds }) => emptySlotIds.length === 1);
        const candidateSlotIds = partiallyFilledBoards.length
            ? partiallyFilledBoards.map(({ emptySlotIds }) => emptySlotIds[0])
            : openBoards.flatMap(({ emptySlotIds }) => emptySlotIds);

        if (typeof document === 'undefined' || !sourceElement) {
            return candidateSlotIds[0];
        }

        const sourceRect = sourceElement.getBoundingClientRect();
        const sourceCenter = {
            x: sourceRect.left + sourceRect.width / 2,
            y: sourceRect.top + sourceRect.height / 2,
        };

        const emptySlotIdSet = new Set(candidateSlotIds);
        const closestVisibleSlotId = Array.from(document.querySelectorAll('[data-manual-slot-id]'))
            .filter(slotElement => emptySlotIdSet.has(slotElement.dataset.manualSlotId))
            .reduce((closest, slotElement) => {
                const slotRect = slotElement.getBoundingClientRect();
                const slotCenter = {
                    x: slotRect.left + slotRect.width / 2,
                    y: slotRect.top + slotRect.height / 2,
                };
                const distance = Math.hypot(sourceCenter.x - slotCenter.x, sourceCenter.y - slotCenter.y);
                return !closest || distance < closest.distance
                    ? { id: slotElement.dataset.manualSlotId, distance }
                    : closest;
            }, null)?.id || null;

        return closestVisibleSlotId || candidateSlotIds[0];
    };

    const handleAvailablePlayerClick = (event, playerId) => {
        const targetSlotId = findClosestEmptySlotId(event.currentTarget);
        if (!targetSlotId) return;
        assignPlayerToBoardSlot(String(playerId), targetSlotId);
    };

    const handleDragEnd = ({ active, over }) => {
        setActivePlayerId(null);
        if (!over) return;

        if (active.data.current?.type === 'board') {
            if (active.id === over.id) return;
            setBoards(prev => {
                const oldIndex = prev.findIndex(board => board.id === active.id);
                const newIndex = prev.findIndex(board => board.id === over.id);
                if (oldIndex === -1 || newIndex === -1) return prev;
                return arrayMove(prev, oldIndex, newIndex);
            });
            return;
        }

        const playerId = String(active.data.current?.playerId || '').trim();
        if (!playerId) return;

        if (over.id === 'available') {
            setBoards(prev => clearPlayerFromBoards(prev, playerId));
            clearSpecialPlayer(playerId);
            return;
        }

        const [dropPrefix, dropKind] = String(over.id).split(':');
        if (dropPrefix === 'special') {
            setBoards(prev => clearPlayerFromBoards(prev, playerId));
            setSpecialAssignments(prev => {
                const cleared = clearPlayerFromSpecial(prev, playerId);
                if (dropKind === 'bye') {
                    const playerGroup = getPlayerGroup(playerId);
                    const replacedByeIds = isGroupMode
                        ? cleared.byeIds.filter(candidate => getPlayerGroup(candidate) === playerGroup)
                        : cleared.byeIds;
                    const remainingByeIds = cleared.byeIds.filter(candidate => !replacedByeIds.includes(candidate));
                    return {
                        ...cleared,
                        byeIds: [...remainingByeIds, playerId],
                        skipIds: uniqueNormalizedIds([...cleared.skipIds, ...replacedByeIds]),
                    };
                }
                if (dropKind === 'skip') {
                    return { ...cleared, skipIds: uniqueNormalizedIds([...cleared.skipIds, playerId]) };
                }
                return { ...cleared, forfeitIds: uniqueNormalizedIds([...cleared.forfeitIds, playerId]) };
            });
            return;
        }

        const [prefix, boardId, slot] = String(over.id).split(':');
        if (prefix !== 'slot' || !boardId || !slot) return;

        assignPlayerToBoardSlot(playerId, over.id);
    };

    const clearSlot = (boardId, slot) => {
        setBoards(prev => prev.map(board => board.id === boardId
            ? { ...board, [slot]: null, ...(slot === 'byeId' ? { isSkip: false } : {}) }
            : board
        ));
    };

    const swapColors = (boardId) => {
        setBoards(prev => prev.map(board => board.id === boardId
            ? { ...board, whiteId: board.blackId, blackId: board.whiteId }
            : board
        ));
    };

    const removeBoard = (boardId) => {
        setBoards(prev => prev.length > 1 ? prev.filter(board => board.id !== boardId) : [emptyBoard()]);
    };

    const moveBoard = (index, direction) => {
        setBoards(prev => {
            const visibleIndexes = isGroupMode && selectedGroup
                ? prev
                    .map((board, boardIndex) => ({ board, boardIndex }))
                    .filter(({ board }) => getBoardGroup(board) === selectedGroup)
                    .map(({ boardIndex }) => boardIndex)
                : prev.map((_, boardIndex) => boardIndex);
            const visibleIndex = visibleIndexes.indexOf(index);
            if (visibleIndex === -1) return prev;
            const nextIndex = visibleIndexes[visibleIndex + direction];
            if (nextIndex < 0 || nextIndex >= prev.length) return prev;
            return arrayMove(prev, index, nextIndex);
        });
    };

    const addBoard = () => {
        setBoards(prev => [...prev, emptyBoard(isGroupMode ? selectedGroup : '')]);
    };

    const resetAssignments = () => {
        setBoards([emptyBoard(isGroupMode ? selectedGroup : '')]);
        setSpecialAssignments(initialSpecial);
    };

    const activePlayer = activePlayerId ? playerMap[activePlayerId] : null;

    if (!open) return null;

    return (
        <Portal>
            <ScrollLock />
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" onClick={onClose} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg shadow-xl pointer-events-auto w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-surface-200-800">
                        <div>
                            <h2 className="text-lg font-bold">{mode === 'edit' ? 'Change Pairing' : 'Manual Pairing'}</h2>
                            <p className="text-xs text-surface-500">Round {roundNumber}</p>
                        </div>
                        <button onClick={onClose} className="p-1.5 hover:bg-surface-200-800 rounded transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <DndContext
                        sensors={sensors}
                        onDragStart={handleDragStart}
                        onDragCancel={() => setActivePlayerId(null)}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] min-h-0 overflow-hidden">
                            <DroppableArea id="available" className="border-b lg:border-b-0 lg:border-r border-surface-200-800 p-4 min-h-0 overflow-y-auto">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-surface-500">Available</h3>
                                    <span className="text-xs font-mono text-surface-500">{focusedAvailablePlayers.length}</span>
                                </div>
                                {isGroupMode && groupOptions.length > 0 && (
                                    <label className="mb-3 block">
                                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-surface-500">Group</span>
                                        <select
                                            value={selectedGroup}
                                            onChange={(event) => setSelectedGroup(event.target.value)}
                                            className="w-full rounded border border-surface-300-700 bg-surface-50-950 px-3 py-2 text-sm outline-none focus:border-primary-500"
                                        >
                                            {groupOptions.map(group => (
                                                <option key={group} value={group}>Group {group}</option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                                <div className="space-y-2">
                                    {focusedAvailablePlayers.length ? focusedAvailablePlayers.map(player => (
                                        <div key={player.playerUniqueId} className="space-y-1">
                                            {isGroupMode && (
                                                <div className="text-[9px] font-bold uppercase tracking-wider text-surface-500">
                                                    {player.group}
                                                </div>
                                            )}
                                            <DraggablePlayer
                                                player={player}
                                                score={playerScores[player.playerUniqueId] || 0}
                                                onClick={(event) => handleAvailablePlayerClick(event, player.playerUniqueId)}
                                            />
                                        </div>
                                    )) : (
                                        <div className="rounded border border-dashed border-surface-300-700 px-3 py-8 text-center text-xs text-surface-500">
                                            {availablePlayers.length ? 'No available players in this group' : 'All players assigned'}
                                        </div>
                                    )}
                                    {remainderWarnings.length > 0 && (
                                        <div className="flex items-start gap-2 rounded border border-error-500/30 bg-error-500/10 px-3 py-2 text-xs text-error-600 dark:text-error-400">
                                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                            <div className="space-y-1">
                                                {remainderWarnings.map((warning, warningIndex) => (
                                                    <div key={warningIndex}>{warning}</div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </DroppableArea>

                            <div className="p-4 min-h-0 overflow-y-auto">
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-surface-500">Manual Boards</h3>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={resetAssignments}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded preset-tonal text-xs font-medium"
                                            title="Move all players back to Available"
                                        >
                                            <RotateCcw size={14} />
                                            Reset
                                        </button>
                                        <button
                                            onClick={addBoard}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded preset-tonal text-xs font-medium"
                                        >
                                            <Plus size={14} />
                                            Board
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <SortableContext items={visibleBoardEntries.map(({ board }) => board.id)} strategy={verticalListSortingStrategy}>
                                        {visibleBoardEntries.map(({ board, index }, displayIndex) => (
                                            <SortableBoard
                                                key={board.id}
                                                board={board}
                                                index={index}
                                                displayIndex={displayIndex}
                                                displayBoardCount={visibleBoardEntries.length}
                                                warnings={boardWarnings[board.id] || []}
                                                playerMap={playerMap}
                                                playerScores={playerScores}
                                                onClearSlot={clearSlot}
                                                onMove={moveBoard}
                                                onRemove={removeBoard}
                                                onSwapColors={swapColors}
                                            />
                                        ))}
                                    </SortableContext>
                                    {visibleBoardEntries.length === 0 && (
                                        <div className="rounded border border-dashed border-surface-300-700 px-3 py-8 text-center text-xs text-surface-500">
                                            No boards in this group
                                        </div>
                                    )}
                                </div>

                                <div className="mt-5 rounded-lg border border-surface-200-800 bg-surface-50-950/60 p-3">
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                        <h3 className="text-xs font-bold uppercase tracking-wider text-surface-500">Bye / Skip / Forfeit</h3>
                                        <span className="text-[10px] text-surface-500 uppercase font-bold">Special assignments</span>
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                        <ByeAssignmentColumn
                                            playerIds={visibleByeIds}
                                            playerMap={playerMap}
                                            playerScores={playerScores}
                                            onClear={clearSpecialPlayer}
                                        />
                                        <SpecialAssignmentColumn
                                            title="Skip"
                                            tone="bye"
                                            playerIds={visibleSkipIds}
                                            dropId="special:skip"
                                            playerMap={playerMap}
                                            playerScores={playerScores}
                                            onClear={clearSpecialPlayer}
                                        />
                                        <SpecialAssignmentColumn
                                            title="Forfeit"
                                            tone="forfeit"
                                            playerIds={visibleForfeitIds}
                                            dropId="special:forfeit"
                                            playerMap={playerMap}
                                            playerScores={playerScores}
                                            onClear={clearSpecialPlayer}
                                        />
                                    </div>
                                    {specialWarnings.length > 0 && (
                                        <div className="mt-3 flex items-start gap-2 rounded border border-error-500/30 bg-error-500/10 px-3 py-2 text-xs text-error-600 dark:text-error-400">
                                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                            <div className="space-y-1">
                                                {specialWarnings.map((warning, warningIndex) => (
                                                    <div key={warningIndex}>{warning}</div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
                            <DragPreview player={activePlayer} score={playerScores[activePlayerId] || 0} />
                        </DragOverlay>
                    </DndContext>

                    <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-surface-200-800">
                        <p className={`text-xs ${hasValidationWarning || hasBlockingWarnings ? 'text-error-600 dark:text-error-400 font-medium' : 'text-surface-500'}`}>
                            {hasValidationWarning
                                ? validationWarning.message
                                : hasManualWarnings
                                ? `Resolve ${manualWarningCount} manual pairing warning${manualWarningCount !== 1 ? 's' : ''} before saving.`
                                : remainderWarnings.length > 0
                                    ? `Resolve ${remainderWarnings.length} remainder warning${remainderWarnings.length !== 1 ? 's' : ''} before pairing the rest, or leave them unassigned.`
                                : manualForfeitCount > 0
                                    ? `${manualForfeitCount} tournament forfeit${manualForfeitCount !== 1 ? 's' : ''} selected.`
                                    : manualSkipCount > 0
                                        ? `${manualSkipCount} manual skip${manualSkipCount !== 1 ? 's' : ''} selected.`
                                        : mode === 'edit'
                                            ? 'Save the changed board list.'
                                            : 'Choose whether unassigned players should be paired automatically.'}
                        </p>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <button onClick={onClose} className="px-4 py-2 text-sm rounded preset-tonal cursor-pointer">
                                Cancel
                            </button>
                            <button
                                onClick={() => onSave(buildSaveBoards(), { pairRest: false })}
                                disabled={isSaving || hasValidationWarning || hasManualWarnings}
                                title={hasValidationWarning ? validationWarning.message : hasManualWarnings ? 'Resolve manual pairing warnings before saving' : undefined}
                                className="flex items-center gap-2 px-4 py-2 text-sm rounded preset-tonal disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                            >
                                <Save size={15} />
                                Save and Leave Rest Unassigned
                            </button>
                            <button
                                onClick={() => onSave(buildSaveBoards(), { pairRest: true })}
                                disabled={isSaving || hasValidationWarning || hasBlockingWarnings}
                                title={hasValidationWarning ? validationWarning.message : hasBlockingWarnings ? 'Resolve pairing warnings before saving' : undefined}
                                className="flex items-center gap-2 px-5 py-2 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                            >
                                <Save size={15} />
                                {isSaving ? 'Saving...' : 'Save and Pair the Rest'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </Portal>
    );
}
