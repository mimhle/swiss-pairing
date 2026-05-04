"use client";

import { useEffect, useRef, useState, memo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, Menu, Portal, Tooltip } from '@skeletonlabs/skeleton-react';
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, CreditCard, FileDown, FileUp, GripVertical, Play, Plus, Settings, Trash, Trash2, Upload } from 'lucide-react';
import { loadPlayers, savePlayers } from '@/app/component/indexedDbPlayers';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ─── Column definitions ──────────────────────────────────────────────────────

const COLUMNS = [
    { key: 'playerUniqueId', label: 'Id',         editable: false,                  className: 'w-14'     },
    { key: 'name',           label: 'Name',        editable: true,  type: 'text',    className: 'min-w-36' },
    { key: 'gender',         label: 'Gender',      editable: true,  type: 'text',    className: 'w-20'     },
    { key: 'group',          label: 'Group',       editable: true,  type: 'text',    className: 'w-20'     },
    { key: 'rating',         label: 'Rating',      editable: true,  type: 'text',    className: 'w-20'     },
    { key: 'title',          label: 'Title',       editable: true,  type: 'text',    className: 'w-16'     },
    { key: 'federation',     label: 'Federation',  editable: true,  type: 'text',    className: 'w-24'     },
    { key: 'fideId',         label: 'FIDE Id',     editable: true,  type: 'text',    className: 'w-24'     },
    { key: 'club',           label: 'Club',        editable: true,  type: 'text',    className: 'min-w-32' },
    { key: 'teamUniqueId',   label: 'Team Id',     editable: true,  type: 'text',    className: 'w-20'     },
    { key: 'type',           label: 'Type',        editable: true,  type: 'text',    className: 'w-20'     },
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
    ['số',        null],
    ['tên',       'name'],
    ['cấp',       'title'],
    ['số id',     null],
    ['rat qg',    '__natrating'],
    ['rat qt',    'rating'],
    ['ns',        null],
    ['lđ',        'federation'],
    ['phái',      'gender'],
    ['loại',      'type'],
    ['nhóm',      'group'],
    ['csố',       'teamUniqueId'],
    ['clb',       'club'],
    ['số fide',   'fideId'],
    ['nguồn',     null],
    ['điểm',      null],
    ['hs1', null], ['hs2', null], ['hs3', null], ['hs4', null], ['hs5', null],
    ['hạng',      null],
    ['họ',        null],
    ['học vị',    null],
]);

const EN_MAP = new Map([
    ['name',           'name'],
    ['gender',         'gender'],
    ['group',          'group'],
    ['rating',         'rating'],
    ['title',          'title'],
    ['federation',     'federation'],
    ['fideid',         'fideId'],
    ['fide id',        'fideId'],
    ['club',           'club'],
    ['teamuniqueid',   'teamUniqueId'],
    ['team id',        'teamUniqueId'],
    ['type',           'type'],
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
    { key: 'group',      label: 'Group'  },
    { key: 'federation', label: 'Fed'   },
    { key: 'gender',     label: 'Gender' },
    { key: 'club',       label: 'Club'   },
];

const EMPTY_FILTERS = Object.fromEntries(FILTER_FIELDS.map(f => [f.key, '']));

// ─── Warning helpers ─────────────────────────────────────────────────────────

const VIET_DIACRITICS = /[àáảãạăắặằẳẵâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i;

const VIET_WORDS = new Set([
    'nguyen','tran','le','pham','hoang','bui','ngo','duong','vo','do',
    'dang','vu','dinh','ha','trinh','truong','luong','cao','doan','thi',
    'van','duc','minh','trung','thanh','hung','tuan','son','long','hai',
    'nam','quoc','quan','phuong','huong','thuy','hien','linh','lan','hong',
    'mai','thu','trang','ngoc','nhu','tien','xuan','huy','kien','lien',
    'binh','cuong','khanh','phong','quang','dat','hieu','hiep','khoa',
    'dung','hoa','tam','yen','chi','viet','vinh','lam','bao','thao',
    'phuc','sang','tan','thang','tin','toan','trong','tung','uyen','my',
    'nga','ninh','sinh','loi','khiem','phu','tuong','tuyen',
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

export default function PlayersTab() {
    const [players, setPlayers] = useState([]);
    const saveTimeoutRef = useRef(null);
    const saveIdleRef = useRef(null);
    const hasLoadedRef = useRef(false);

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
    const [rawData, setRawData]     = useState(null);  // { headers: string[], rows: string[][] }
    const [columnMap, setColumnMap] = useState({});    // { colIndex: fieldKey | '' }
    const [importText, setImportText] = useState('');
    const [fileName, setFileName]   = useState('');
    const fileInputRef = useRef(null);
    const tableBodyRef = useRef(null);

    // Action selector state
    const [selectedAction, setSelectedAction] = useState('');
    const [actionField, setActionField]       = useState('');

    // ── Player handlers ───────────────────────────────────────────────────────
    const updatePlayer = (id, field, value) => {
        setPlayers(prev => prev.map(p => p.playerUniqueId === id ? { ...p, [field]: value } : p));
    };

    const addPlayer = () => {
        setPlayers(prev => [...prev, emptyPlayer(prev.length + 1)]);
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
        setPlayers(prev => {
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
        try { input.setSelectionRange(len, len); } catch (_) {}
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

    const applyAction = () => {
        if (selectedAction === 'fill_down' && actionField) {
            setPlayers(prev => {
                let lastValue = '';
                return prev.map(p => {
                    const val = p[actionField];
                    if (val === '' || val === null || val === undefined) {
                        return { ...p, [actionField]: lastValue };
                    }
                    lastValue = val;
                    return p;
                });
            });
        }
    };

    const removePlayer = (id) => {
        setPlayers(prev => prev.filter(p => p.playerUniqueId !== id));
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const activeIdx = players.findIndex(p => p.playerUniqueId === active.id);
        const overIdx = players.findIndex(p => p.playerUniqueId === over.id);

        if (activeIdx === -1 || overIdx === -1) return;

        setPlayers(prev => arrayMove(prev, activeIdx, overIdx));
    };

    const handleClearAll = () => setPlayers([]);

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
                p.rating       && `Rtg="${e(p.rating)}"`,
                p.title        && `Title="${e(p.title)}"`,
                p.federation   && `Federation="${e(p.federation)}"`,
                p.fideId       && `FideId="${e(p.fideId)}"`,
                p.club         && `Club="${e(p.club)}"`,
                p.gender       && `Sex="${e(p.gender)}"`,
                p.group        && `Group="${e(p.group)}"`,
                p.teamUniqueId && `TeamUniqueId="${e(p.teamUniqueId)}"`,
                p.type         && `Type="${e(p.type)}"`,
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
            setPlayers(applyMapping(rawData.rows, columnMap, () => id++));
        } else {
            setPlayers(prev => {
                let id = prev.length + 1;
                return [...prev, ...applyMapping(rawData.rows, columnMap, () => id++)];
            });
        }
        resetImportState();
    };

    // ── Settings ──────────────────────────────────────────────────────────────
    const [settings, setSettings] = useState({
        warnDuplicateName:     true,
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

    useEffect(() => {
        let isActive = true;
        loadPlayers().then(saved => {
            if (!isActive) return;
            setPlayers(normalizePlayers(saved));
            hasLoadedRef.current = true;
        });
        return () => { isActive = false; };
    }, []);

     useEffect(() => {
         if (!hasLoadedRef.current) return;
         if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
         if (saveIdleRef.current && window.cancelIdleCallback) window.cancelIdleCallback(saveIdleRef.current);
         saveTimeoutRef.current = setTimeout(() => {
             if (window.requestIdleCallback) {
                 saveIdleRef.current = window.requestIdleCallback(() => savePlayers(players), { timeout: 1000 });
             } else {
                 // Fire save without awaiting - it's fire-and-forget now
                 savePlayers(players);
             }
         }, 300);
         return () => {
             if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
             if (saveIdleRef.current && window.cancelIdleCallback) window.cancelIdleCallback(saveIdleRef.current);
             if (saveIdleRef.current && !window.cancelIdleCallback) clearTimeout(saveIdleRef.current);
         };
     }, [players]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <span className="text-sm text-surface-600-400">
                        {hasActiveFilter ? `${visiblePlayers.length} of ${players.length}` : players.length} players
                    </span>
                    {players.length > 0 && (
                        <Dialog>
                            <Dialog.Trigger className="flex items-center gap-1.5 text-sm px-2.5 py-1 rounded text-error-500-400 hover:bg-error-500/10 transition-colors cursor-pointer">
                                <Trash size={13} />
                                Clear All
                            </Dialog.Trigger>
                            <Portal>
                                <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
                                <Dialog.Positioner className="fixed inset-0 z-50 flex items-center justify-center p-4">
                                    <Dialog.Content className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
                                        <Dialog.Title className="text-base font-semibold">Clear all players?</Dialog.Title>
                                        <Dialog.Description className="text-sm text-surface-600-400">
                                            This will permanently remove all {players.length} players from the list.
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
                                onChange={e => { setSelectedAction(e.target.value); setActionField(''); }}
                            >
                                <option value="">Actions...</option>
                                <option value="fill_down">Fill Downward</option>
                                {/*
                                TODO: + add more action
                                 - auto fill rating in order (user input: start rating, step, direction, players to fill)
                                 - auto fill group base on gender
                                 - auto fill club and fed using a mapping table
                                 - auto fill team id using fed or club
                                 + make action apply to what shown (filtered) instead of all players
                                    */}
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
                            {selectedAction && (
                                <button
                                    className="text-sm px-2.5 py-1 rounded preset-tonal cursor-pointer disabled:opacity-40"
                                    onClick={applyAction}
                                    disabled={!actionField}
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

            {/* Filters */}
            {players.length > 0 && FILTER_FIELDS.some(({ key }) => uniqueValues(key).length > 0) && (
                <div className={`flex flex-wrap gap-x-4 gap-y-2 items-center px-3 py-2.5 border rounded-lg transition-colors ${hasActiveFilter ? "bg-primary-500/10 border-primary-500/30" : "bg-surface-50-950 border-surface-200-800"}`}>
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
                    {hasActiveFilter && (
                        <button
                            className="ml-auto text-xs text-surface-500-400 hover:text-surface-900-100 transition-colors"
                            onClick={() => setFilters(EMPTY_FILTERS)}
                        >
                            Clear filters
                        </button>
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
                                        <th
                                            key={col.key}
                                            className={`px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400 ${col.className}`}
                                        >
                                            {col.label}
                                        </th>
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
                            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-not-allowed opacity-50"
                            disabled
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
        </div>
    );
}

