"use client";

import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, Menu, Portal, Tooltip } from '@skeletonlabs/skeleton-react';
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, CreditCard, FileDown, FileUp, Filter, GripVertical, Play, Plus, Redo2, Settings, Trash, Trash2, Undo2, Upload, X } from 'lucide-react';
import { loadPlayers, savePlayers, loadClubFedMapping, saveClubFedMapping } from '@/app/component/indexedDbPlayers';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import GeneratePlayerCardModal from '@/app/component/GeneratePlayerCardModal';
import ScrollLock from '@/app/component/ScrollLock';
import { useTournament } from '@/app/context/TournamentContext';

// ─── Column definitions ──────────────────────────────────────────────────────

const COLUMNS = [
    { key: 'playerUniqueId', label: 'Id', editable: false, className: 'w-14' },
    { key: 'name', label: 'Name', editable: true, type: 'text', className: 'min-w-36' },
    { key: 'gender', label: 'Gender', editable: true, type: 'text', className: 'w-20' },
    { key: 'group', label: 'Group', editable: true, type: 'text', className: 'w-20' },
    { key: 'rating', label: 'Rating', editable: true, type: 'text', className: 'w-20' },
    { key: 'title', label: 'Title', editable: true, type: 'text', className: 'w-16' },
    { key: 'federation', label: 'Federation', editable: true, type: 'text', className: 'w-24' },
    { key: 'fideId', label: 'FIDE Id', editable: true, type: 'text', className: 'w-24' },
    { key: 'club', label: 'Club', editable: true, type: 'text', className: 'min-w-32' },
    { key: 'teamUniqueId', label: 'Team Id', editable: true, type: 'text', className: 'w-20' },
    { key: 'type', label: 'Type', editable: true, type: 'text', className: 'w-20' },
];

const EDITABLE_KEYS = COLUMNS.filter(c => c.editable).map(c => c.key);
const EDITABLE_COL_IDX = Object.fromEntries(COLUMNS.filter(c => c.editable).map((c, i) => [c.key, i]));

const TARGET_OPTIONS = [
    { value: '', label: 'Ignore' },
    ...EDITABLE_KEYS.map(key => ({
        value: key,
        label: COLUMNS.find(c => c.key === key)?.label ?? key,
    })),
];

const emptyPlayer = (id) => {
    const p = { playerUniqueId: id };
    EDITABLE_KEYS.forEach(k => { p[k] = ''; });
    return p;
};

const normalizePlayers = (savedPlayers) => {
    if (!Array.isArray(savedPlayers)) return [];
    return savedPlayers.map((p, i) => ({
        ...emptyPlayer(i + 1),
        ...p,
        playerUniqueId: i + 1,
    }));
};

// ─── Import parsing ──────────────────────────────────────────────────────────

// Vietnamese header → internal field key.
// '__natrating' is a sentinel used in suggestMapping to handle Rat QG fallback.
const VI_MAP = new Map([
    ['số', null],
    ['tên', 'name'],
    ['cấp', 'title'],
    ['số id', null],
    ['rat qg', '__natrating'],
    ['rat qt', 'rating'],
    ['ns', null],
    ['lđ', 'federation'],
    ['phái', 'gender'],
    ['loại', 'type'],
    ['nhóm', 'group'],
    ['csố', 'teamUniqueId'],
    ['clb', 'club'],
    ['số fide', 'fideId'],
    ['nguồn', null],
    ['điểm', null],
    ['hs1', null], ['hs2', null], ['hs3', null], ['hs4', null], ['hs5', null],
    ['hạng', null],
    ['họ', null],
    ['học vị', null],
]);

const EN_MAP = new Map([
    ['name', 'name'],
    ['gender', 'gender'],
    ['group', 'group'],
    ['rating', 'rating'],
    ['title', 'title'],
    ['federation', 'federation'],
    ['fideid', 'fideId'],
    ['fide id', 'fideId'],
    ['club', 'club'],
    ['teamuniqueid', 'teamUniqueId'],
    ['team id', 'teamUniqueId'],
    ['type', 'type'],
]);

function parseRawData(text) {
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

function parseExcel(arrayBuffer) {
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

function suggestMapping(headers) {
    const mapping = {};
    const used = new Set();
    const lower = headers.map(h => h.toLowerCase().trim());
    const hasRatQT = lower.includes('rat qt');

    lower.forEach((h, i) => {
        let field = VI_MAP.get(h) ?? EN_MAP.get(h) ?? null;
        if (field === '__natrating') field = hasRatQT ? null : 'rating';
        if (field && !field.startsWith('__') && !used.has(field)) {
            mapping[i] = field;
            used.add(field);
        } else {
            mapping[i] = '';
        }
    });
    return mapping;
}

function applyMapping(rows, columnMap, getNextId) {
    return rows.map(row => {
        const p = emptyPlayer(getNextId());
        Object.entries(columnMap).forEach(([idxStr, field]) => {
            if (!field) return;
            const val = (row[parseInt(idxStr, 10)] ?? '').trim();
            if (field === 'rating') {
                const n = parseInt(val, 10);
                p.rating = n > 0 ? n : '';
            } else if (field in p) {
                p[field] = val;
            }
        });
        return p;
    });
}

// ─── Filters ────────────────────────────────────────────────────────────────

const FILTER_FIELDS = [
    { key: 'group', label: 'Group' },
    { key: 'federation', label: 'Fed' },
    { key: 'gender', label: 'Gender' },
    { key: 'club', label: 'Club' },
];

const EMPTY_FILTERS = Object.fromEntries(FILTER_FIELDS.map(f => [f.key, '']));

// ─── Warning helpers ─────────────────────────────────────────────────────────

const VIET_DIACRITICS = /[àáảãạăắặằẳẵâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i;

const VIET_WORDS = new Set([
    'nguyen', 'tran', 'le', 'pham', 'hoang', 'bui', 'ngo', 'duong', 'vo', 'do',
    'dang', 'vu', 'dinh', 'ha', 'trinh', 'truong', 'luong', 'cao', 'doan', 'thi',
    'van', 'duc', 'minh', 'trung', 'thanh', 'hung', 'tuan', 'son', 'long', 'hai',
    'nam', 'quoc', 'quan', 'phuong', 'huong', 'thuy', 'hien', 'linh', 'lan', 'hong',
    'mai', 'thu', 'trang', 'ngoc', 'nhu', 'tien', 'xuan', 'huy', 'kien', 'lien',
    'binh', 'cuong', 'khanh', 'phong', 'quang', 'dat', 'hieu', 'hiep', 'khoa',
    'dung', 'hoa', 'tam', 'yen', 'chi', 'viet', 'vinh', 'lam', 'bao', 'thao',
    'phuc', 'sang', 'tan', 'thang', 'tin', 'toan', 'trong', 'tung', 'uyen', 'my',
    'nga', 'ninh', 'sinh', 'loi', 'khiem', 'phu', 'tuong', 'tuyen',
]);

const looksLikeVietnameseAscii = (name) => {
    if (!name || VIET_DIACRITICS.test(name)) return false;
    return name.toLowerCase().split(/\s+/).some(w => VIET_WORDS.has(w));
};

// ─── Optimized Editable Cell Input ──────────────────────────────────────────
// Uses local state for typing to avoid triggering full table re-renders
const EditableInput = memo(({ value, playerId, colKey, colType, rowIdx, colIdx, onUpdate, onPaste, onKeyDown, EDITABLE_COL_IDX }) => {
    const [localValue, setLocalValue] = useState(value);

    // Sync external value changes (from paste, etc.)
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleBlur = useCallback(() => {
        const trimmed = localValue?.trim() || "";
        if (trimmed !== value) {
            onUpdate(playerId, colKey, trimmed);
        } else {
            setLocalValue(value); // Reset if no change
        }
    }, [localValue, value, playerId, colKey, onUpdate]);

    return (
        <input
            className="bg-transparent w-full outline-none placeholder:text-surface-400-600"
            type={colType === 'number' ? 'number' : 'text'}
            placeholder="—"
            value={localValue}
            data-row={rowIdx}
            data-col={colIdx}
            onChange={e => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onPaste={e => onPaste(e, playerId, colKey)}
            onKeyDown={e => onKeyDown(e, rowIdx, colIdx)}
        />
    );
}, (prevProps, nextProps) => {
    // Memoization: only re-render if value or keys change
    return prevProps.value === nextProps.value &&
        prevProps.playerId === nextProps.playerId &&
        prevProps.colKey === nextProps.colKey;
});

EditableInput.displayName = 'EditableInput';

const MAPPING_COLS = ['club', 'federation'];

const MappingRow = memo(({ row, idx, onUpdate, onRemove, onPaste, isDuplicate }) => {
    const [localClub, setLocalClub] = useState(row.club);
    const [localFed, setLocalFed] = useState(row.federation);

    // Sync when parent resets the row (e.g. populate from data)
    useEffect(() => { setLocalClub(row.club); }, [row.club]);
    useEffect(() => { setLocalFed(row.federation); }, [row.federation]);

    const commitClub = useCallback(() => {
        const v = localClub?.trim() ?? '';
        if (v !== row.club) onUpdate(idx, 'club', v);
        else setLocalClub(row.club);
    }, [localClub, row.club, idx, onUpdate]);

    const commitFed = useCallback(() => {
        const v = localFed?.trim() ?? '';
        if (v !== row.federation) onUpdate(idx, 'federation', v);
        else setLocalFed(row.federation);
    }, [localFed, row.federation, idx, onUpdate]);

    return (
        <tr className={`border-b border-surface-200-800 last:border-0 hover:bg-surface-50-950 transition-colors ${isDuplicate ? 'bg-warning-500/5' : ''}`}>
            <td className="px-3 py-2">
                <input
                    type="text"
                    value={localClub}
                    onChange={e => setLocalClub(e.target.value)}
                    onBlur={commitClub}
                    onPaste={e => onPaste(e, idx, 'club')}
                    placeholder="—"
                    className="w-full bg-transparent outline-none border-b border-transparent hover:border-surface-300-700 focus:border-primary-500 focus:ring-0 transition-colors px-1"
                />
            </td>
            <td className="px-3 py-2">
                <input
                    type="text"
                    value={localFed}
                    onChange={e => setLocalFed(e.target.value)}
                    onBlur={commitFed}
                    onPaste={e => onPaste(e, idx, 'federation')}
                    placeholder="—"
                    className="w-full bg-transparent outline-none border-b border-transparent hover:border-surface-300-700 focus:border-primary-500 focus:ring-0 transition-colors px-1"
                />
            </td>
            <td className="px-3 py-2 text-center">
                <div className="flex items-center justify-center gap-1">
                    {isDuplicate && (
                        <span className="text-warning-500 inline-flex" title="Duplicate value — resolve before applying">
                            <AlertTriangle size={13} />
                        </span>
                    )}
                    <button
                        onClick={() => onRemove(idx)}
                        className="p-1 rounded text-surface-400-600 hover:text-error-500 transition-colors"
                        aria-label="Remove mapping row"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </td>
        </tr>
    );
}, (prev, next) =>
    prev.row === next.row &&
    prev.idx === next.idx &&
    prev.isDuplicate === next.isDuplicate
);

MappingRow.displayName = 'MappingRow';

// ─── Draggable Row Component ─────────────────────────────────────────────
const DraggableRow = memo(({ player, rowIdx, displayIndex, playerWarnings, COLUMNS, EDITABLE_COL_IDX, updatePlayer, handleCellPaste, handleCellKeyDown, removePlayer }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: player.playerUniqueId });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const warns = playerWarnings[player.playerUniqueId];

    return (
        <tr
            ref={setNodeRef}
            style={style}
            className={`border-b border-surface-200-800 last:border-0 hover:bg-surface-50-950 transition-colors ${warns ? 'bg-warning-500/5' : ''} ${isDragging ? 'bg-primary-500/10' : ''}`}
        >
            <td className="px-2 py-2 text-center cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
                <div className="flex justify-center text-surface-400-600 hover:text-surface-600-400 transition-colors">
                    <GripVertical size={16} />
                </div>
            </td>
            {COLUMNS.map(col => (
                <td key={col.key} className="px-3 py-2">
                    <Menu onSelect={({ value }) => {
                        if (value === 'copy') navigator.clipboard.writeText(String(player[col.key] ?? ''));
                        else if (value === 'cut') {
                            navigator.clipboard.writeText(String(player[col.key] ?? ''));
                            updatePlayer(player.playerUniqueId, col.key, '');
                        }
                        else if (value === 'paste') navigator.clipboard.readText().then(t => updatePlayer(player.playerUniqueId, col.key, t.trim()));
                        else if (value === 'clear') updatePlayer(player.playerUniqueId, col.key, '');
                    }}>
                        <Menu.ContextTrigger element={(attrs) => (
                            <div {...attrs}>
                                {col.editable ? (
                                    <EditableInput
                                        value={col.key === 'playerUniqueId' ? displayIndex : player[col.key]}
                                        playerId={player.playerUniqueId}
                                        colKey={col.key}
                                        colType={col.type}
                                        rowIdx={rowIdx}
                                        colIdx={EDITABLE_COL_IDX[col.key]}
                                        onUpdate={updatePlayer}
                                        onPaste={handleCellPaste}
                                        onKeyDown={handleCellKeyDown}
                                    />
                                ) : (
                                    <span className="text-surface-600-400 tabular-nums select-none">
                                        {col.key === 'playerUniqueId' ? displayIndex : player[col.key]}
                                    </span>
                                )}
                            </div>
                        )} />
                        <Portal>
                            <Menu.Positioner>
                                <Menu.Content className="card p-1 preset-filled-surface-100-900 shadow-lg min-w-36">
                                    <Menu.Item value="copy" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                        <Menu.ItemText>Copy</Menu.ItemText>
                                    </Menu.Item>
                                    {col.editable && <>
                                        <Menu.Item value="cut" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                            <Menu.ItemText>Cut</Menu.ItemText>
                                        </Menu.Item>
                                        <Menu.Item value="paste" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                            <Menu.ItemText>Paste</Menu.ItemText>
                                        </Menu.Item>
                                        <Menu.Separator className="my-1 border-surface-200-800" />
                                        <Menu.Item value="clear" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-error">
                                            <Menu.ItemText>Clear</Menu.ItemText>
                                        </Menu.Item>
                                    </>}
                                </Menu.Content>
                            </Menu.Positioner>
                        </Portal>
                    </Menu>
                </td>
            ))}
            <td className="px-1 py-2 text-center">
                {warns && (
                    <Tooltip openDelay={100} positioning={{ placement: 'top' }}>
                        <Tooltip.Trigger element={(attrs) => (
                            <span {...attrs} className="text-warning-500 cursor-help inline-flex">
                                <AlertTriangle size={13} />
                            </span>
                        )} />
                        <Portal>
                            <Tooltip.Positioner>
                                <Tooltip.Content className="card p-2 text-xs preset-filled-surface-950-50 max-w-48">
                                    {warns.map((w, i) => <div key={i}>{w}</div>)}
                                    <Tooltip.Arrow className="[--arrow-size:--spacing(2)] [--arrow-background:var(--color-surface-950-50)]">
                                        <Tooltip.ArrowTip />
                                    </Tooltip.Arrow>
                                </Tooltip.Content>
                            </Tooltip.Positioner>
                        </Portal>
                    </Tooltip>
                )}
            </td>
            <td className="px-2 py-2">
                <button
                    className="p-1 rounded text-surface-400-600 hover:text-error-500 transition-colors"
                    onClick={() => removePlayer(player.playerUniqueId)}
                    aria-label="Remove player"
                >
                    <Trash2 size={14} />
                </button>
            </td>
        </tr>
    );
}, (prevProps, nextProps) => {
    return prevProps.player === nextProps.player &&
        prevProps.rowIdx === nextProps.rowIdx &&
        prevProps.displayIndex === nextProps.displayIndex &&
        prevProps.playerWarnings === nextProps.playerWarnings;
});

DraggableRow.displayName = 'DraggableRow';

// ─── Component ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 100;

export default function PlayersTab() {
    const { activeTournamentId, isLoaded: isTournamentLoaded } = useTournament();

    const [players, setPlayers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [toastMessage, setToastMessage] = useState('');
    const [toastType, setToastType] = useState(''); // 'error' | 'success'
    const saveTimeoutRef = useRef(null);
    const saveIdleRef = useRef(null);
    const hasLoadedRef = useRef(false);

    // ── Undo / Redo ───────────────────────────────────────────────────────────
    const pastRef = useRef([]); // snapshots before each user mutation
    const futureRef = useRef([]); // snapshots cleared on new action, restored on undo
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    // Mounted flag: ensures undo/redo disabled state matches between SSR and client
    // (Fast Refresh can retain canUndo/canRedo=true in memory while server re-renders fresh)
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const pushHistory = useCallback((snapshot) => {
        pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), snapshot];
        futureRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
    }, []);

    // Wraps every user-initiated setPlayers call so history is captured
    const setPlayersWithHistory = useCallback((updater) => {
        setPlayers(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            pushHistory(prev);
            return next;
        });
    }, [pushHistory]);

    const undo = useCallback(() => {
        if (!pastRef.current.length) return;
        const snapshot = pastRef.current[pastRef.current.length - 1];
        pastRef.current = pastRef.current.slice(0, -1);
        setPlayers(cur => {
            futureRef.current = [cur, ...futureRef.current.slice(0, MAX_HISTORY - 1)];
            setCanRedo(true);
            return snapshot;
        });
        setCanUndo(pastRef.current.length > 0);
    }, []);

    const redo = useCallback(() => {
        if (!futureRef.current.length) return;
        const snapshot = futureRef.current[0];
        futureRef.current = futureRef.current.slice(1);
        setPlayers(cur => {
            pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), cur];
            setCanUndo(true);
            return snapshot;
        });
        setCanRedo(futureRef.current.length > 0);
    }, []);

    // Global keyboard shortcut: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
    useEffect(() => {
        const handler = (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (ctrl && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
            if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [undo, redo]);

    // Drag and drop sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            distance: 8,
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // Import state
    const [importPhase, setImportPhase] = useState('input'); // 'input' | 'mapping'
    const [rawData, setRawData] = useState(null);  // { headers: string[], rows: string[][] }
    const [columnMap, setColumnMap] = useState({});    // { colIndex: fieldKey | '' }
    const [importText, setImportText] = useState('');
    const [fileName, setFileName] = useState('');
    const fileInputRef = useRef(null);
    const tableBodyRef = useRef(null);

    // Action selector state
    const [selectedAction, setSelectedAction] = useState('');
    const [actionField, setActionField] = useState('');
    const [overwriteRating, setOverwriteRating] = useState(false);
    const [overwriteGroup, setOverwriteGroup] = useState(false);

    // Club/Fed mapping modal state
    const [showMappingModal, setShowMappingModal] = useState(false);
    const [clubFedMapping, setClubFedMapping] = useState({});
    const [mappingTableData, setMappingTableData] = useState([]);
    const [mappingDirection, setMappingDirection] = useState('club_to_fed'); // 'club_to_fed' | 'fed_to_club'
    const [mappingOverwrite, setMappingOverwrite] = useState(false);

    // Generate Player Card modal state
    const [showCardModal, setShowCardModal] = useState(false);

    // ── Player handlers ───────────────────────────────────────────────────────
    const updatePlayer = (id, field, value) => {
        setPlayersWithHistory(prev => prev.map(p => p.playerUniqueId === id ? { ...p, [field]: value } : p));
    };

    const addPlayer = () => {
        setPlayersWithHistory(prev => [...prev, emptyPlayer(prev.length + 1)]);
    };

    const handleCellPaste = (e, playerId, colKey) => {
        const text = e.clipboardData.getData('text');
        const rawRows = text.split(/\r?\n/);
        while (rawRows.length && rawRows[rawRows.length - 1] === '') rawRows.pop();
        if (rawRows.length <= 1 && !(rawRows[0] ?? '').includes('\t')) return;
        e.preventDefault();
        const editableCols = COLUMNS.filter(c => c.editable);
        const startColIdx = editableCols.findIndex(c => c.key === colKey);
        const startRowIdx = players.findIndex(p => p.playerUniqueId === playerId);
        const pasteRows = rawRows.map(r => r.split('\t'));
        const rowsNeeded = (startRowIdx + pasteRows.length) - players.length;
        setPlayersWithHistory(prev => {
            const next = [...prev];
            for (let i = 0; i < rowsNeeded; i++) next.push(emptyPlayer(next.length + 1));
            pasteRows.forEach((cells, ri) => {
                const playerIdx = startRowIdx + ri;
                cells.forEach((val, ci) => {
                    const col = editableCols[startColIdx + ci];
                    if (!col) return;
                    next[playerIdx] = { ...next[playerIdx], [col.key]: val.trim() };
                });
            });
            return next;
        });
    };

    const focusCell = (rowIdx, colIdx) => {
        const input = tableBodyRef.current?.querySelector(`input[data-row="${rowIdx}"][data-col="${colIdx}"]`);
        if (!input) return;
        input.focus();
        const len = input.value.length;
        try { input.setSelectionRange(len, len); } catch (_) { }
    };

    const handleCellKeyDown = (e, rowIdx, colIdx) => {
        const maxCol = EDITABLE_KEYS.length - 1;
        const maxRow = visiblePlayers.length - 1;
        switch (e.key) {
            case 'ArrowUp':
                if (rowIdx > 0) { e.preventDefault(); focusCell(rowIdx - 1, colIdx); }
                break;
            case 'ArrowDown':
                if (rowIdx < maxRow) { e.preventDefault(); focusCell(rowIdx + 1, colIdx); }
                break;
            case 'ArrowLeft':
                if (e.target.selectionStart === 0 && colIdx > 0) { e.preventDefault(); focusCell(rowIdx, colIdx - 1); }
                break;
            case 'ArrowRight':
                if (e.target.selectionStart === e.target.value.length && colIdx < maxCol) { e.preventDefault(); focusCell(rowIdx, colIdx + 1); }
                break;
        }
    };

    const mappingSaveTimeoutRef = useRef(null);

    const openMappingModal = async () => {
        // Load persisted mapping from IndexedDB and reconstruct rows
        try {
            const saved = await loadClubFedMapping(activeTournamentId);
            const entries = Object.entries(saved)
                // The saved format stores { club -> { federation } } entries; reconstruct pairs.
                .filter(([key, val]) => val?.federation && key !== val?.federation)
                .map(([club, val]) => ({ club, federation: val.federation }));
            if (entries.length > 0) {
                setMappingTableData(entries);
            } else {
                setMappingTableData([{ club: '', federation: '' }]);
            }
        } catch (_) {
            setMappingTableData([{ club: '', federation: '' }]);
        }
        setShowMappingModal(true);
    };

    const populateColumnFromPlayers = (columnType) => {
        // Get unique values from visible players for the specified column
        const uniqueFromPlayers = [...new Set(
            visiblePlayers
                .map(p => p[columnType]?.trim())
                .filter(Boolean)
        )].sort();

        setMappingTableData(prev => {
            // Collect values already present in this column so we don't create duplicates
            const existingValues = new Set(prev.map(r => r[columnType]).filter(Boolean));
            const newRows = uniqueFromPlayers
                .filter(value => !existingValues.has(value))
                .map(value => ({
                    club: columnType === 'club' ? value : '',
                    federation: columnType === 'federation' ? value : '',
                }));
            // Strip the single blank placeholder row if it's the only thing there
            const base = prev.length === 1 && !prev[0].club && !prev[0].federation ? [] : prev;
            return [...base, ...newRows];
        });
    };

    const updateMappingRow = (index, field, value) => {
        setMappingTableData(prev => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const addMappingRow = () => {
        setMappingTableData(prev => [...prev, { club: '', federation: '' }]);
    };

    const removeMappingRow = (index) => {
        setMappingTableData(prev => prev.filter((_, i) => i !== index));
    };

    const handleMappingPaste = (e, rowIdx, colKey) => {
        const text = e.clipboardData.getData('text');
        const rawRows = text.split(/\r?\n/);
        while (rawRows.length && rawRows[rawRows.length - 1] === '') rawRows.pop();
        // Only intercept multi-cell pastes
        if (rawRows.length <= 1 && !(rawRows[0] ?? '').includes('\t')) return;
        e.preventDefault();
        const startColIdx = MAPPING_COLS.indexOf(colKey);
        const pasteRows = rawRows.map(r => r.split('\t'));
        setMappingTableData(prev => {
            const next = [...prev];
            const rowsNeeded = (rowIdx + pasteRows.length) - next.length;
            for (let i = 0; i < rowsNeeded; i++) next.push({ club: '', federation: '' });
            pasteRows.forEach((cells, ri) => {
                const targetRow = rowIdx + ri;
                const updated = { ...next[targetRow] };
                cells.forEach((val, ci) => {
                    const col = MAPPING_COLS[startColIdx + ci];
                    if (col) updated[col] = val.trim();
                });
                next[targetRow] = updated;
            });
            return next;
        });
    };

    const applyMappingToPlayers = async () => {
        // Build a mapping lookup from club/fed pairs to both values
        // This allows us to fill in missing values based on known pairs
        const clubFedMap = new Map();

        mappingTableData.forEach(row => {
            const key = `${row.club || ''}|${row.federation || ''}`;
            if (row.club || row.federation) {
                clubFedMap.set(key, { club: row.club, federation: row.federation });
            }
        });

        // Also create reverse lookups
        const clubToFed = new Map();
        const fedToClub = new Map();

        mappingTableData.forEach(row => {
            if (row.club && row.federation) {
                clubToFed.set(row.club, row.federation);
                fedToClub.set(row.federation, row.club);
            }
        });

        // Apply mapping to players respecting the chosen direction and overwrite setting
        setPlayersWithHistory(prev => {
            const next = [...prev];
            next.forEach(p => {
                if (mappingDirection === 'club_to_fed' && p.club && clubToFed.has(p.club)) {
                    if (mappingOverwrite || !p.federation) p.federation = clubToFed.get(p.club);
                }
                if (mappingDirection === 'fed_to_club' && p.federation && fedToClub.has(p.federation)) {
                    if (mappingOverwrite || !p.club) p.club = fedToClub.get(p.federation);
                }
            });
            return next;
        });

        // Save the mapping table
        const mappingData = {};
        mappingTableData.forEach(row => {
            if (row.club && row.federation) {
                mappingData[row.club] = { federation: row.federation };
                mappingData[row.federation] = { club: row.club };
            }
        });
        await saveClubFedMapping(mappingData, activeTournamentId);

        setShowMappingModal(false);
    };

    const applyAction = () => {
        if (selectedAction === 'fill_down' && actionField) {
            setPlayersWithHistory(prev => {
                // Get the set of visible player IDs for filtering
                const visibleIds = new Set(visiblePlayers.map(p => p.playerUniqueId));

                let lastValue = '';
                return prev.map(p => {
                    // Only apply action to visible players
                    if (!visibleIds.has(p.playerUniqueId)) {
                        return p;
                    }

                    const val = p[actionField];
                    if (val === '' || val === null || val === undefined) {
                        return { ...p, [actionField]: lastValue };
                    }
                    lastValue = val;
                    return p;
                });
            });
        } else if (selectedAction === 'auto_fill_rating') {
            const start = parseInt(document.getElementById('rating_start')?.value, 10) || 1000;
            const step = parseInt(document.getElementById('rating_step')?.value, 10) || 10;
            setPlayersWithHistory(prev => {
                const next = [...prev];
                for (let i = 0; i < next.length; i++) {
                    const p = next[i];
                    const hasRating = p.rating !== '' && p.rating !== null && p.rating !== undefined;
                    if (overwriteRating || !hasRating) {
                        p.rating = start + Math.floor(i * step);
                    }
                }
                return next;
            });
        } else if (selectedAction === 'auto_fill_group_gender') {
            setPlayersWithHistory(prev => {
                const next = [...prev];
                for (let i = 0; i < next.length; i++) {
                    const p = next[i];
                    if (p.gender) {
                        const hasGroup = p.group !== '' && p.group !== null && p.group !== undefined;
                        if (overwriteGroup || !hasGroup) {
                            p.group = ["nam", "m", "male"].includes((p.gender.toLowerCase())) ? 'm' : 'f';
                        }
                    }
                }
                return next;
            });
        } else if (selectedAction === 'auto_fill_club_fed_mapping') {
            openMappingModal();
        }
    };

    const removePlayer = (id) => {
        setPlayersWithHistory(prev => prev.filter(p => p.playerUniqueId !== id));
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const activeIdx = players.findIndex(p => p.playerUniqueId === active.id);
        const overIdx = players.findIndex(p => p.playerUniqueId === over.id);

        if (activeIdx === -1 || overIdx === -1) return;

        setPlayersWithHistory(prev => arrayMove(prev, activeIdx, overIdx));
    };

    const handleClearAll = () => setPlayersWithHistory([]);

    // ── Export handlers ───────────────────────────────────────────────────────
    const exportExcel = () => {
        const ws = XLSX.utils.json_to_sheet(visiblePlayers.map(p => ({
            Id: p.playerUniqueId,
            Name: p.name,
            Gender: p.gender,
            Group: p.group,
            Rating: p.rating,
            Title: p.title,
            Federation: p.federation,
            'FIDE Id': p.fideId,
            Club: p.club,
            'Team Id': p.teamUniqueId,
            Type: p.type,
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Players');
        XLSX.writeFile(wb, 'players.xlsx');
    };

    const exportCsv = () => {
        const ws = XLSX.utils.json_to_sheet(visiblePlayers.map(p => ({
            Id: p.playerUniqueId,
            Name: p.name,
            Gender: p.gender,
            Group: p.group,
            Rating: p.rating,
            Title: p.title,
            Federation: p.federation,
            'FIDE Id': p.fideId,
            Club: p.club,
            'Team Id': p.teamUniqueId,
            Type: p.type,
        })));
        const url = URL.createObjectURL(new Blob([XLSX.utils.sheet_to_csv(ws)], { type: 'text/csv;charset=utf-8' }));
        Object.assign(document.createElement('a'), { href: url, download: 'players.csv' }).click();
        URL.revokeObjectURL(url);
    };

    const exportXml = () => {
        const e = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const rows = visiblePlayers.map(p => {
            const [lastname = '', ...rest] = (p.name || '').split(' ');
            const attrs = [
                `PlayerUniqueId="${e(p.playerUniqueId)}"`,
                `Lastname="${e(lastname)}"`,
                `Firstname="${e(rest.join(' '))}"`,
                p.rating && `Rtg="${e(p.rating)}"`,
                p.title && `Title="${e(p.title)}"`,
                p.federation && `Federation="${e(p.federation)}"`,
                p.fideId && `FideId="${e(p.fideId)}"`,
                p.club && `Club="${e(p.club)}"`,
                p.gender && `Sex="${e(p.gender)}"`,
                p.group && `Group="${e(p.group)}"`,
                p.teamUniqueId && `TeamUniqueId="${e(p.teamUniqueId)}"`,
                p.type && `Type="${e(p.type)}"`,
            ].filter(Boolean).join(' ');
            return `\t<Player ${attrs}/>`;
        });
        const xml = `<?xml version="1.0" ?>\n<Players>\n${rows.join('\n')}\n</Players>`;
        const url = URL.createObjectURL(new Blob([xml], { type: 'text/xml;charset=utf-8' }));
        Object.assign(document.createElement('a'), { href: url, download: 'players.xml' }).click();
        URL.revokeObjectURL(url);
    };

    // ── Import handlers ───────────────────────────────────────────────────────
    const advanceToMapping = (data) => {
        setRawData(data);
        setColumnMap(suggestMapping(data.headers));
        setImportPhase('mapping');
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setFileName(file.name);
        setImportText('');

        if (/\.(xlsx|xls)$/i.test(file.name)) {
            file.arrayBuffer().then(buf => {
                const data = parseExcel(buf);
                if (data) advanceToMapping(data);
            });
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target.result ?? '';
                setImportText(text);
                const data = parseRawData(text);
                if (data) advanceToMapping(data);
            };
            reader.readAsText(file, 'utf-8');
        }
    };

    const handleNext = () => {
        const data = parseRawData(importText);
        if (data) advanceToMapping(data);
    };

    const resetImportState = () => {
        setImportPhase('input');
        setRawData(null);
        setColumnMap({});
        setImportText('');
        setFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleImport = (mode) => {
        if (!rawData) { resetImportState(); return; }
        if (mode === 'replace') {
            let id = 1;
            setPlayersWithHistory(applyMapping(rawData.rows, columnMap, () => id++));
        } else {
            setPlayersWithHistory(prev => {
                let id = prev.length + 1;
                return [...prev, ...applyMapping(rawData.rows, columnMap, () => id++)];
            });
        }
        resetImportState();
    };

    // ── Settings ──────────────────────────────────────────────────────────────
    const [settings, setSettings] = useState({
        warnDuplicateName: true,
        warnVietnameseNoAccent: true,
    });

    const toggleSetting = (key) =>
        setSettings(prev => ({ ...prev, [key]: !prev[key] }));

    // Per-player warning messages (keyed by playerUniqueId)
    const playerWarnings = (() => {
        const warns = {};
        const nameCounts = {};
        if (settings.warnDuplicateName) {
            players.forEach(p => {
                const k = p.name.trim().toLowerCase();
                if (k) nameCounts[k] = (nameCounts[k] || 0) + 1;
            });
        }
        players.forEach(p => {
            const msgs = [];
            if (settings.warnDuplicateName && nameCounts[p.name.trim().toLowerCase()] > 1)
                msgs.push('Duplicate name');
            if (settings.warnVietnameseNoAccent && looksLikeVietnameseAscii(p.name))
                msgs.push('Vietnamese name may be missing accent marks');
            if (msgs.length) warns[p.playerUniqueId] = msgs;
        });
        return warns;
    })();

    const warningCount = Object.keys(playerWarnings).length;

    // ── Filters ───────────────────────────────────────────────────────────────
    const [filters, setFilters] = useState(EMPTY_FILTERS);

    const uniqueValues = (key) =>
        [...new Set(players.map(p => p[key]).filter(Boolean))].sort();

    const hasActiveFilter = FILTER_FIELDS.some(({ key }) => filters[key]);

    const visiblePlayers = hasActiveFilter
        ? players.filter(p => FILTER_FIELDS.every(({ key }) => !filters[key] || p[key] === filters[key]))
        : players;

    const groupCounts = useMemo(() => {
        const counts = {};
        visiblePlayers.forEach(p => {
            const g = p.group?.trim() || 'Unassigned';
            counts[g] = (counts[g] || 0) + 1;
        });
        return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
    }, [visiblePlayers]);

    useEffect(() => {
        if (!isTournamentLoaded || !activeTournamentId) return;

        let isActive = true;
        hasLoadedRef.current = false;
        setIsLoading(true);

        loadPlayers(activeTournamentId).then(saved => {
            if (!isActive) return;
            const normalized = normalizePlayers(saved);
            setPlayers(normalized);
            // Reset history when switching tournaments
            pastRef.current = [];
            futureRef.current = [];
            setCanUndo(false);
            setCanRedo(false);
            hasLoadedRef.current = true;
            setIsLoading(false);
        });
        return () => { isActive = false; };
    }, [activeTournamentId, isTournamentLoaded]);

    useEffect(() => {
        if (!hasLoadedRef.current) return;
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        if (saveIdleRef.current && window.cancelIdleCallback) window.cancelIdleCallback(saveIdleRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            if (window.requestIdleCallback) {
                saveIdleRef.current = window.requestIdleCallback(() => savePlayers(players, activeTournamentId), { timeout: 1000 });
            } else {
                // Fire save without awaiting - it's fire-and-forget now
                savePlayers(players, activeTournamentId);
            }
        }, 300);
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (saveIdleRef.current && window.cancelIdleCallback) window.cancelIdleCallback(saveIdleRef.current);
            if (saveIdleRef.current && !window.cancelIdleCallback) clearTimeout(saveIdleRef.current);
        };
    }, [players]);

    // Auto-save mapping table to IndexedDB whenever it changes (debounced)
    useEffect(() => {
        if (!showMappingModal) return;
        if (mappingSaveTimeoutRef.current) clearTimeout(mappingSaveTimeoutRef.current);
        mappingSaveTimeoutRef.current = setTimeout(() => {
            const mappingData = {};
            mappingTableData.forEach(row => {
                if (row.club && row.federation) {
                    mappingData[row.club] = { federation: row.federation };
                    mappingData[row.federation] = { club: row.club };
                }
            });
            saveClubFedMapping(mappingData, activeTournamentId);
        }, 500);
        return () => {
            if (mappingSaveTimeoutRef.current) clearTimeout(mappingSaveTimeoutRef.current);
        };
    }, [mappingTableData, showMappingModal]);

    // ── Mapping duplicates ────────────────────────────────────────────────────
    // A row is a duplicate if its non-empty club or federation value appears in another row.
    const mappingDuplicates = useMemo(() => {
        const clubCounts = {};
        const fedCounts = {};
        mappingTableData.forEach(row => {
            if (row.club) clubCounts[row.club] = (clubCounts[row.club] || 0) + 1;
            if (row.federation) fedCounts[row.federation] = (fedCounts[row.federation] || 0) + 1;
        });
        const dupes = new Set();
        mappingTableData.forEach((row, i) => {
            if ((row.club && clubCounts[row.club] > 1) || (row.federation && fedCounts[row.federation] > 1)) {
                dupes.add(i);
            }
        });
        return dupes;
    }, [mappingTableData]);

    // ── Column actions ───────────────────────────────────────────────────────
    const clearColumn = (colKey) => {
        setPlayersWithHistory(prev => prev.map(p => ({ ...p, [colKey]: '' })));
    };

    const applyColumnTemplate = (colKey, template) => {
        try {
            const evalTemplate = new Function('ctx', `
                with(ctx) {
                    return \`${template}\`;
                }
            `);

            const createProxy = (player) => new Proxy(player, {
                has(target, prop) {
                    if (typeof prop !== 'string') return false;
                    if (prop in target) return true;
                    if (prop === 'lastname' || prop === 'firstname') return true;
                    if (prop in globalThis) return false;
                    return true;
                },
                get(target, prop) {
                    if (prop === 'lastname') return (target.name || '').split(' ')[0] || '';
                    if (prop === 'firstname') return (target.name || '').split(' ').slice(1).join(' ') || '';
                    const val = target[prop];
                    return val !== undefined && val !== null ? val : '';
                }
            });

            let errorCount = 0;
            let firstError = null;

            setPlayersWithHistory(prev => prev.map(p => {
                try {
                    const value = evalTemplate(createProxy(p));
                    return { ...p, [colKey]: value || '' };
                } catch (e) {
                    if (e.message?.includes('is not defined')) {
                        return { ...p, [colKey]: '' };
                    }
                    errorCount++;
                    if (!firstError) firstError = e;
                    return p;
                }
            }));

            if (errorCount > 0) {
                setToastType('error');
                const errorMsg = firstError?.message || 'Unknown error';
                setToastMessage(`Template error: ${errorMsg}`);
                setTimeout(() => {
                    setToastMessage('');
                    setToastType('');
                }, 5000);
                return false;
            }
            return true;
        } catch (e) {
            setToastType('error');
            const errorMsg = e?.message || 'Invalid template format';
            setToastMessage(`${errorMsg}. Example: \${name}_\${club}`);
            setTimeout(() => {
                setToastMessage('');
                setToastType('');
            }, 5000);
            return false;
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────
    if (!isTournamentLoaded || isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
                <div className="w-12 h-12 border-4 border-surface-200-800 border-t-primary-500 rounded-full animate-spin"></div>
                <p className="text-surface-600-400 font-medium">Loading data...</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Toast notifications */}
            {toastMessage && (
                <Portal>
                    <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-start gap-2 ${toastType === 'error' ? 'bg-error-500' : 'bg-success-500'} text-white max-w-md`}>
                        {toastType === 'error' && <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
                        <span className="text-sm wrap-break-word">{toastMessage}</span>
                    </div>
                </Portal>
            )}
            {/* Toolbar */}
            <div className="flex justify-between items-center gap-3">
                <div className="flex items-center gap-3 border border-surface-200-800 rounded-lg px-3 py-2.5 bg-surface-50-950">
                    <button
                        className="p-1 rounded preset-tonal transition-opacity disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                        title="Undo (Ctrl+Z)"
                        disabled={!mounted || pastRef.current.length === 0}
                        onClick={undo}
                        aria-label="Undo"
                    >
                        <Undo2 size={14} />
                    </button>
                    <button
                        className="p-1 rounded preset-tonal transition-opacity disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                        title="Redo (Ctrl+Y)"
                        disabled={!mounted || futureRef.current.length === 0}
                        onClick={redo}
                        aria-label="Redo"
                    >
                        <Redo2 size={14} />
                    </button>
                    {players.length > 0 && (
                        <Dialog>
                            <Dialog.Trigger className="flex items-center gap-1.5 text-sm px-2.5 py-1 preset-tonal rounded text-error-500-400 hover:bg-error-500/10 transition-colors cursor-pointer">
                                <Trash size={13} />
                                Clear All
                            </Dialog.Trigger>
                            <Portal>
                                <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" />
                                <Dialog.Positioner className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                                    <Dialog.Content className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
                                        <Dialog.Title className="text-base font-semibold">Clear all players?</Dialog.Title>
                                        <Dialog.Description className="text-sm text-surface-600-400">
                                            This will remove all {players.length} players from the list.
                                        </Dialog.Description>
                                        <div className="flex justify-end gap-2">
                                            <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                                Cancel
                                            </Dialog.CloseTrigger>
                                            <Dialog.CloseTrigger
                                                className="px-4 py-1.5 text-sm rounded bg-error-500 text-white hover:bg-error-600 transition-colors cursor-pointer"
                                                onClick={handleClearAll}
                                            >
                                                Clear All
                                            </Dialog.CloseTrigger>
                                        </div>
                                    </Dialog.Content>
                                </Dialog.Positioner>
                            </Portal>
                        </Dialog>
                    )}
                    {players.length > 0 && (
                        <div className="flex items-center gap-1.5">
                            <select
                                className="text-sm bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1 outline-none cursor-pointer"
                                value={selectedAction}
                                onChange={e => { setSelectedAction(e.target.value); setActionField(''); setOverwriteRating(false); setOverwriteGroup(false); }}
                            >
                                <option value="">Actions...</option>
                                <option value="fill_down">Fill Downward</option>
                                <option value="auto_fill_rating">Auto Fill Rating</option>
                                <option value="auto_fill_group_gender">Fill Group by Gender</option>
                                <option value="auto_fill_club_fed_mapping">Map Club/Fed</option>
                            </select>
                            {selectedAction === 'fill_down' && (
                                <select
                                    className="text-sm bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1 outline-none cursor-pointer"
                                    value={actionField}
                                    onChange={e => setActionField(e.target.value)}
                                >
                                    <option value="">Field...</option>
                                    {COLUMNS.filter(c => c.editable).map(c => (
                                        <option key={c.key} value={c.key}>{c.label}</option>
                                    ))}
                                </select>
                            )}
                            {selectedAction === 'auto_fill_rating' && (
                                <div className="flex gap-1.5 items-center">
                                    <input type="number" placeholder="Start" className="text-sm w-16 bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1 outline-none" id="rating_start" defaultValue="1000" />
                                    <input type="number" placeholder="Step" className="text-sm w-16 bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1 outline-none" id="rating_step" defaultValue="10" />
                                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={overwriteRating}
                                            onChange={e => setOverwriteRating(e.target.checked)}
                                            className="cursor-pointer"
                                        />
                                        <span>Overwrite</span>
                                    </label>
                                </div>
                            )}
                            {selectedAction === 'auto_fill_group_gender' && (
                                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={overwriteGroup}
                                        onChange={e => setOverwriteGroup(e.target.checked)}
                                        className="cursor-pointer"
                                    />
                                    <span>Overwrite</span>
                                </label>
                            )}
                            {selectedAction === 'auto_fill_club_fed_mapping' && (
                                <button
                                    className="text-sm px-2.5 py-1 rounded preset-tonal cursor-pointer"
                                    onClick={openMappingModal}
                                >
                                    Configure Mapping
                                </button>
                            )}
                            {selectedAction === 'auto_fill_team_id' && (
                                <select
                                    className="text-sm bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1 outline-none cursor-pointer"
                                    id="target_team_field"
                                    defaultValue="club"
                                >
                                    <option value="club">From Club</option>
                                    <option value="fed">From Fed</option>
                                </select>
                            )}
                            {selectedAction && (
                                <button
                                    className="text-sm px-2.5 py-1 rounded preset-tonal cursor-pointer disabled:opacity-40"
                                    onClick={applyAction}
                                    disabled={selectedAction === 'fill_down' && !actionField}
                                >
                                    Apply
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex gap-2">
                    {/* Import dialog — two-phase: input → mapping */}
                    <Dialog onOpenChange={({ open }) => { if (!open) resetImportState(); }}>
                        <Dialog.Trigger className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer">
                            <Upload size={14} />
                            Import
                        </Dialog.Trigger>
                        <Portal>
                            <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
                            <Dialog.Positioner className="fixed inset-0 z-50 flex items-center justify-center p-4">
                                <Dialog.Content className={`bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full space-y-4 shadow-xl transition-all ${importPhase === 'mapping' ? 'max-w-2xl' : 'max-w-lg'}`}>

                                    {importPhase === 'input' ? (
                                        /* ── Phase 1: file / paste ── */
                                        <>
                                            <Dialog.Title className="text-base font-semibold">Import Players</Dialog.Title>
                                            <Dialog.Description className="text-sm text-surface-600-400">
                                                Supports Excel (.xlsx, .xls), CSV, and semicolon-delimited files.
                                                You will map columns on the next step.
                                            </Dialog.Description>

                                            <label className="flex items-center gap-3 px-3 py-2.5 border border-dashed border-surface-300-700 rounded-lg cursor-pointer hover:bg-surface-50-950 transition-colors">
                                                <FileUp size={18} className="text-surface-500-400 shrink-0" />
                                                <span className="text-sm truncate">
                                                    {fileName
                                                        ? <span className="text-primary-600-400 font-medium">{fileName}</span>
                                                        : <span className="text-surface-500-400">Choose file — .xlsx, .xls, .csv, .txt</span>
                                                    }
                                                </span>
                                                <input
                                                    ref={fileInputRef}
                                                    type="file"
                                                    accept=".xlsx,.xls,.csv,.txt,.tsv"
                                                    className="hidden"
                                                    onChange={handleFileSelect}
                                                />
                                            </label>

                                            <div className="space-y-1">
                                                <p className="text-xs text-surface-500-400">or paste text directly</p>
                                                <textarea
                                                    className="w-full h-32 bg-surface-50-950 border border-surface-200-800 rounded p-2 font-mono text-xs outline-none resize-none focus:ring-1 focus:ring-primary-500"
                                                    placeholder={"Số;Tên;Cấp;Rat QG;Rat QT;LĐ;Phái;Loại;Nhóm;CLB;Số FIDE\n1;Nguyễn Trung Quân;ACM;0;1817;HCM;;CV;DB12;Tp. HCM;12445479"}
                                                    value={importText}
                                                    onChange={e => { setImportText(e.target.value); setFileName(''); }}
                                                />
                                            </div>

                                            <div className="flex justify-between">
                                                <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                                    Cancel
                                                </Dialog.CloseTrigger>
                                                <button
                                                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded preset-filled disabled:opacity-40"
                                                    disabled={!importText.trim()}
                                                    onClick={handleNext}
                                                >
                                                    Map columns
                                                    <ArrowRight size={14} />
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        /* ── Phase 2: column mapping ── */
                                        <>
                                            <Dialog.Title className="text-base font-semibold">Map columns</Dialog.Title>
                                            <Dialog.Description className="text-sm text-surface-600-400">
                                                {rawData?.rows.length} rows detected from <span className="font-medium">{fileName || 'pasted text'}</span>.
                                                Assign each source column to a field, or leave as Ignore.
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
                                                        {rawData?.headers.map((header, i) => {
                                                            const sample = rawData.rows
                                                                .slice(0, 3)
                                                                .map(r => r[i])
                                                                .filter(Boolean)
                                                                .join(', ');
                                                            return (
                                                                <tr key={i} className="border-b border-surface-200-800 last:border-0">
                                                                    <td className="px-3 py-2 font-medium truncate max-w-36">{header}</td>
                                                                    <td className="px-3 py-2 text-xs text-surface-600-400 truncate max-w-48">
                                                                        {sample.length > 50 ? sample.slice(0, 50) + '…' : sample || '—'}
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                        <select
                                                                            className="w-full text-sm bg-surface-50-950 border border-surface-200-800 rounded px-2 py-1 outline-none cursor-pointer"
                                                                            value={columnMap[i] ?? ''}
                                                                            onChange={e => setColumnMap(prev => ({ ...prev, [i]: e.target.value }))}
                                                                        >
                                                                            {TARGET_OPTIONS.map(opt => (
                                                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
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
                                                    onClick={() => setImportPhase('input')}
                                                >
                                                    <ArrowLeft size={14} />
                                                    Back
                                                </button>
                                                <div className="flex gap-2">
                                                    <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                                        Cancel
                                                    </Dialog.CloseTrigger>
                                                    <Dialog.CloseTrigger
                                                        className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer"
                                                        onClick={() => handleImport('append')}
                                                    >
                                                        Append
                                                    </Dialog.CloseTrigger>
                                                    <Dialog.CloseTrigger
                                                        className="px-4 py-1.5 text-sm rounded preset-filled cursor-pointer"
                                                        onClick={() => handleImport('replace')}
                                                    >
                                                        Replace
                                                    </Dialog.CloseTrigger>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                </Dialog.Content>
                            </Dialog.Positioner>
                        </Portal>
                    </Dialog>

                    <button
                        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-filled"
                        onClick={addPlayer}
                    >
                        <Plus size={14} />
                        Add Player
                    </button>

                    {/* Settings */}
                    <Dialog>
                        <Dialog.Trigger className="p-1.5 rounded preset-tonal cursor-pointer aspect-square" aria-label="Player list settings">
                            <Settings size={15} />
                        </Dialog.Trigger>
                        <Portal>
                            <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
                            <Dialog.Positioner className="fixed inset-0 z-50 flex items-center justify-center p-4">
                                <Dialog.Content className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-sm space-y-5 shadow-xl">
                                    <Dialog.Title className="text-base font-semibold">Player List Settings</Dialog.Title>
                                    <div className="space-y-4">
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="mt-0.5 accent-primary-500"
                                                checked={settings.warnDuplicateName}
                                                onChange={() => toggleSetting('warnDuplicateName')}
                                            />
                                            <div>
                                                <p className="text-sm font-medium">Warn about duplicate names</p>
                                                <p className="text-xs text-surface-600-400 mt-0.5">
                                                    Highlight players whose name appears more than once in the list.
                                                </p>
                                            </div>
                                        </label>
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="mt-0.5 accent-primary-500"
                                                checked={settings.warnVietnameseNoAccent}
                                                onChange={() => toggleSetting('warnVietnameseNoAccent')}
                                            />
                                            <div>
                                                <p className="text-sm font-medium">Warn about Vietnamese names without accents</p>
                                                <p className="text-xs text-surface-600-400 mt-0.5">
                                                    Detect names like &#34;Nguyen Van A&#34; that appear to be Vietnamese but lack diacritical marks.
                                                </p>
                                            </div>
                                        </label>
                                    </div>
                                    <div className="flex justify-end">
                                        <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-filled cursor-pointer">
                                            Done
                                        </Dialog.CloseTrigger>
                                    </div>
                                </Dialog.Content>
                            </Dialog.Positioner>
                        </Portal>
                    </Dialog>
                </div>
            </div>

            {/* Warning banner */}
            {warningCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-warning-500/10 border border-warning-500/30 rounded-lg text-sm text-warning-600-400">
                    <AlertTriangle size={14} className="shrink-0" />
                    {warningCount} player{warningCount !== 1 ? 's' : ''} with warnings — hover the
                    <AlertTriangle size={12} className="inline shrink-0" /> icon in the table for details.
                </div>
            )}

            {/* Filters & Total */}
            {players.length > 0 && (
                <div className={`flex flex-wrap gap-x-4 gap-y-2 items-center px-3 py-2.5 border rounded-lg transition-colors ${hasActiveFilter ? "bg-primary-500/10 border-primary-500/30" : "bg-surface-50-950 border-surface-200-800"}`}>
                    <Menu>
                        <Menu.Trigger className="flex items-center gap-1.5 text-sm text-surface-600-400 hover:text-surface-900-100 transition-colors cursor-pointer px-1 py-0.5 rounded outline-none hover:bg-surface-200-800/50">
                            {hasActiveFilter ? <span className="font-medium text-primary-600-400">{visiblePlayers.length} of {players.length}</span> : <span className="font-medium">{players.length}</span>}
                            <span>players</span>
                            <ChevronDown size={14} className="opacity-50" />
                        </Menu.Trigger>
                        <Portal>
                            <Menu.Positioner>
                                <Menu.Content className="card p-2 preset-filled-surface-100-900 shadow-lg min-w-48 text-sm outline-none z-50">
                                    <div className="font-semibold px-2 py-1 border-b border-surface-200-800 mb-1 text-xs uppercase tracking-wider text-surface-600-400">
                                        Group Summary
                                    </div>
                                    <div className="max-h-64 overflow-y-auto">
                                        {groupCounts.length > 0 ? groupCounts.map(([g, c]) => (
                                            <div key={g} className="flex justify-between items-center px-2 py-1.5 hover:bg-surface-200-800/50 rounded">
                                                <span>{g}</span>
                                                <span className="font-medium">{c}</span>
                                            </div>
                                        )) : (
                                            <div className="px-2 py-1.5 text-surface-600-400 italic">No groups found</div>
                                        )}
                                    </div>
                                </Menu.Content>
                            </Menu.Positioner>
                        </Portal>
                    </Menu>

                    {FILTER_FIELDS.some(({ key }) => uniqueValues(key).length > 0) && (
                        <>
                            <div className="w-px h-6 bg-surface-200-800" />
                            {hasActiveFilter ? (
                                <button
                                    className="flex items-center gap-1.5 text-sm text-error-500-400 hover:text-error-600-300 transition-colors font-medium shrink-0"
                                    onClick={() => setFilters(EMPTY_FILTERS)}
                                >
                                    <X size={16} />
                                    Clear filter
                                </button>
                            ) : (
                                <div className="flex items-center gap-1.5 text-sm text-surface-600-400 shrink-0">
                                    <Filter size={16} />
                                    <span>Filter</span>
                                </div>
                            )}
                            {FILTER_FIELDS.map(({ key, label }) => {
                                const options = uniqueValues(key);
                                if (!options.length) return null;
                                return (
                                    <div key={key} className="flex items-center gap-1.5">
                                        <span className="text-xs text-surface-600-400 shrink-0">{label}</span>
                                        <select
                                            className="text-sm bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1 outline-none cursor-pointer"
                                            value={filters[key]}
                                            onChange={e => setFilters(prev => ({ ...prev, [key]: e.target.value }))}
                                        >
                                            <option value="">All</option>
                                            {options.map(v => <option key={v} value={v}>{v}</option>)}
                                        </select>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>
            )}

            {/* Table */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={visiblePlayers.map(p => p.playerUniqueId)}
                    strategy={verticalListSortingStrategy}
                >
                    <div className="border border-surface-200-800 rounded-lg overflow-x-auto">
                        <table className="w-full text-sm whitespace-nowrap">
                            <thead className="bg-surface-100-900 border-b border-surface-200-800">
                                <tr>
                                    <th className="w-8" />
                                    {COLUMNS.map(col => (
                                        col.editable ? (
                                            <th
                                                key={col.key}
                                                className={`px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400 ${col.className}`}
                                            >
                                                <Menu onSelect={({ value }) => {
                                                    if (value === 'clear_all') clearColumn(col.key);
                                                    else if (value?.startsWith('template_')) {
                                                        const template = value.replace('template_', '');
                                                        applyColumnTemplate(col.key, template);
                                                    }
                                                }}>
                                                    <Menu.ContextTrigger element={(attrs) => (
                                                        <span {...attrs} className="cursor-context-menu select-none">
                                                            {col.label}
                                                        </span>
                                                    )} />
                                                    <Portal>
                                                        <Menu.Positioner>
                                                            <Menu.Content className="card p-1 preset-filled-surface-100-900 shadow-lg w-56">
                                                                <Menu.Item value="clear_all" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-error">
                                                                    <Menu.ItemText>Clear all values</Menu.ItemText>
                                                                </Menu.Item>
                                                                <Menu.Separator className="my-1 border-surface-200-800" />
                                                                <div className="px-2 py-1 text-xs uppercase tracking-wider text-surface-600-400 font-semibold">Template presets</div>
                                                                {col.key === 'teamUniqueId' && (
                                                                    <>
                                                                        <Menu.Item value="template_${club}" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                                            <Menu.ItemText className="font-mono text-xs">${'{club}'}</Menu.ItemText>
                                                                        </Menu.Item>
                                                                        <Menu.Item value="template_${federation}" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                                            <Menu.ItemText className="font-mono text-xs">${'{federation}'}</Menu.ItemText>
                                                                        </Menu.Item>
                                                                        <Menu.Item value="template_${club}_${name}" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                                            <Menu.ItemText className="font-mono text-xs">${'{club}_${name}'}</Menu.ItemText>
                                                                        </Menu.Item>
                                                                    </>
                                                                )}
                                                                {col.key === 'type' && (
                                                                    <>
                                                                        <Menu.Item value="template_OTB" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                                            <Menu.ItemText>OTB</Menu.ItemText>
                                                                        </Menu.Item>
                                                                        <Menu.Item value="template_Online" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                                            <Menu.ItemText>Online</Menu.ItemText>
                                                                        </Menu.Item>
                                                                    </>
                                                                )}
                                                                {col.key === 'group' && (
                                                                    <>
                                                                        <Menu.Item value="template_A" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                                            <Menu.ItemText>Group A</Menu.ItemText>
                                                                        </Menu.Item>
                                                                        <Menu.Item value="template_B" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                                            <Menu.ItemText>Group B</Menu.ItemText>
                                                                        </Menu.Item>
                                                                    </>
                                                                )}
                                                                <Menu.Separator className="my-1 border-surface-200-800" />
                                                                <div className="px-3 py-2 space-y-2">
                                                                    <div className="text-xs uppercase tracking-wider text-surface-600-400 font-semibold">Custom template</div>
                                                                    <input
                                                                        type="text"
                                                                        placeholder="e.g. ${name}_${club}"
                                                                        className="w-full text-xs bg-surface-50-950 border border-surface-200-800 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary-500"
                                                                        id={`template_input_${col.key}`}
                                                                        onKeyDown={(e) => {
                                                                            e.stopPropagation();
                                                                            if (e.key === 'Enter') {
                                                                                const val = e.currentTarget.value.trim();
                                                                                if (val) {
                                                                                    const success = applyColumnTemplate(col.key, val);
                                                                                    if (success) {
                                                                                        e.currentTarget.value = '';
                                                                                    }
                                                                                }
                                                                            }
                                                                        }}
                                                                        onKeyUp={(e) => {
                                                                            e.stopPropagation();
                                                                        }}
                                                                    />
                                                                    <p className="text-xs text-surface-600-400 leading-tight wrap-break-word">
                                                                        Use ${'{'}{'{'}fieldName{'}'}{'}'}.{'\n'}
                                                                        Available: name, gender, group, rating, title, federation, club, fideId, teamUniqueId, type
                                                                    </p>
                                                                </div>
                                                            </Menu.Content>
                                                        </Menu.Positioner>
                                                    </Portal>
                                                </Menu>
                                            </th>
                                        ) : (
                                            <th
                                                key={col.key}
                                                className={`px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400 ${col.className}`}
                                            >
                                                {col.label}
                                            </th>
                                        )
                                    ))}
                                    <th className="w-6" />
                                    <th className="w-10" />
                                </tr>
                            </thead>
                            <tbody ref={tableBodyRef}>
                                {visiblePlayers.map((player, rowIdx) => (
                                    <DraggableRow
                                        key={player.playerUniqueId}
                                        player={player}
                                        rowIdx={rowIdx}
                                        displayIndex={rowIdx + 1}
                                        playerWarnings={playerWarnings}
                                        COLUMNS={COLUMNS}
                                        EDITABLE_COL_IDX={EDITABLE_COL_IDX}
                                        updatePlayer={updatePlayer}
                                        handleCellPaste={handleCellPaste}
                                        handleCellKeyDown={handleCellKeyDown}
                                        removePlayer={removePlayer}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </SortableContext>
            </DndContext>

            {players.length > 0 && (
                <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                        <Menu onSelect={({ value }) => { if (value === 'excel') exportExcel(); else if (value === 'csv') exportCsv(); else if (value === 'xml') exportXml(); }}>
                            <Menu.Trigger className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer ${hasActiveFilter ? 'text-warning-600-400' : ''}`}>
                                <FileDown size={14} />
                                Export
                                {hasActiveFilter && <span className="text-xs text-warning-600-400">({visiblePlayers.length}/{players.length})</span>}
                                <ChevronDown size={12} />
                            </Menu.Trigger>
                            <Portal>
                                <Menu.Positioner>
                                    <Menu.Content className="card p-1 preset-filled-surface-100-900 shadow-lg min-w-48">
                                        {hasActiveFilter && (
                                            <div className="flex items-center gap-1.5 px-3 py-1.5 mb-1 text-xs text-warning-600-400 border-b border-surface-200-800">
                                                <AlertTriangle size={11} />
                                                Filters active — exporting {visiblePlayers.length} of {players.length} players
                                            </div>
                                        )}
                                        <Menu.Item value="excel" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                            <Menu.ItemText>Export as Excel</Menu.ItemText>
                                        </Menu.Item>
                                        <Menu.Item value="csv" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                            <Menu.ItemText>Export as CSV</Menu.ItemText>
                                        </Menu.Item>
                                        <Menu.Item value="xml" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                            <Menu.ItemText>Export as XML</Menu.ItemText>
                                        </Menu.Item>
                                    </Menu.Content>
                                </Menu.Positioner>
                            </Portal>
                        </Menu>

                        <button
                            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer"
                            onClick={() => setShowCardModal(true)}
                        >
                            <CreditCard size={14} />
                            Generate Player Card
                        </button>
                    </div>

                    <button className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-filled cursor-pointer">
                        <Play size={14} />
                        Start Pairing
                    </button>
                </div>
            )}

            {/* Generate Player Card Modal */}
            <GeneratePlayerCardModal
                open={showCardModal}
                onClose={() => setShowCardModal(false)}
                players={players}
            />

            {/* Club/Fed Mapping Modal */}
            {showMappingModal && (
                <Portal>
                    <ScrollLock />
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" onClick={() => setShowMappingModal(false)} />
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                        <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-2xl space-y-4 shadow-xl max-h-[90vh] flex flex-col">
                            <div>
                                <h2 className="text-base font-semibold">Club & Federation Mapping</h2>
                                <p className="text-sm text-surface-600-400 mt-1">
                                    Set up the relationship between clubs and federations. Populate one column from your data, then fill the other manually. Click Map to apply.
                                </p>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer"
                                    onClick={() => populateColumnFromPlayers('club')}
                                    title="Fill Club column with unique values from players"
                                >
                                    <Plus size={14} />
                                    Fill Club from Data
                                </button>
                                <button
                                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer"
                                    onClick={() => populateColumnFromPlayers('federation')}
                                    title="Fill Federation column with unique values from players"
                                >
                                    <Plus size={14} />
                                    Fill Federation from Data
                                </button>
                                <button
                                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer ml-auto"
                                    onClick={addMappingRow}
                                    title="Add a new row for manual entry"
                                >
                                    <Plus size={14} />
                                    Add Row
                                </button>
                            </div>

                            <div className="overflow-y-auto flex-1 border border-surface-200-800 rounded-lg">
                                <table className="w-full text-sm">
                                    <thead className="bg-surface-50-950 border-b border-surface-200-800 sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400 flex-1">Club</th>
                                            <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400 flex-1">Federation</th>
                                            <th className="px-3 py-2.5 text-center text-xs font-medium uppercase tracking-wider text-surface-600-400 w-12">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mappingTableData.length === 0 ? (
                                            <tr>
                                                <td colSpan="3" className="px-3 py-4 text-center text-surface-600-400">
                                                    Click "Fill Club from Data" or "Fill Federation from Data" to start
                                                </td>
                                            </tr>
                                        ) : (
                                            mappingTableData.map((row, idx) => (
                                                <MappingRow
                                                    key={idx}
                                                    row={row}
                                                    idx={idx}
                                                    onUpdate={updateMappingRow}
                                                    onRemove={removeMappingRow}
                                                    onPaste={handleMappingPaste}
                                                    isDuplicate={mappingDuplicates.has(idx)}
                                                />
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex flex-col gap-2">
                                {mappingDuplicates.size > 0 && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-warning-500/10 border border-warning-500/30 rounded-lg text-sm text-warning-600-400">
                                        <AlertTriangle size={14} className="shrink-0" />
                                        {mappingDuplicates.size} row{mappingDuplicates.size !== 1 ? 's' : ''} with duplicate values — resolve before applying.
                                    </div>
                                )}
                                <div className="flex items-center justify-between gap-2">
                                    {/* Direction toggle */}
                                    <div className="flex items-center gap-1 text-xs">
                                        <span className="text-surface-600-400 mr-1 shrink-0">Apply:</span>
                                        {[
                                            { value: 'club_to_fed', label: 'Club → Fed' },
                                            { value: 'fed_to_club', label: 'Fed → Club' },
                                        ].map(opt => (
                                            <button
                                                key={opt.value}
                                                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${mappingDirection === opt.value
                                                    ? 'preset-filled'
                                                    : 'preset-tonal opacity-60 hover:opacity-100'
                                                    }`}
                                                onClick={() => setMappingDirection(opt.value)}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                        <label className="flex items-center gap-1.5 ml-3 cursor-pointer text-surface-600-400 hover:text-surface-900-100 transition-colors select-none">
                                            <input
                                                type="checkbox"
                                                checked={mappingOverwrite}
                                                onChange={e => setMappingOverwrite(e.target.checked)}
                                                className="cursor-pointer accent-primary-500"
                                            />
                                            Overwrite
                                        </label>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer"
                                            onClick={() => setShowMappingModal(false)}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="px-4 py-1.5 text-sm rounded preset-filled cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                                            onClick={applyMappingToPlayers}
                                            disabled={
                                                mappingTableData.length === 0 ||
                                                !mappingTableData.some(row => row.club || row.federation) ||
                                                mappingDuplicates.size > 0
                                            }
                                        >
                                            <Play size={14} />
                                            Map
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Portal>
            )}
        </div>
    );
}

