"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Portal } from '@skeletonlabs/skeleton-react';
import {
    ChevronDown,
    ChevronRight,
    CreditCard,
    Download,
    FileDown,
    FileUp,
    Image,
    RefreshCw,
    Type,
    X,
} from 'lucide-react';

// ─── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
    config: {
        font: './fonts\\UTM American Sans.ttf',
        scale: { width: 0, height: 768 },
        dpi: { width: 300, height: 300 },
        outputFormat: 'png',
    },
    name: {
        anchor: 'mm',
        offsetX: 0,
        offsetY: 20,
        maxWidth: 1600,
        maxFontSize: 200,
        maxWidthCompensate: 1.001,
        offsetXCompensate: 1,
        offsetYCompensate: 0.9991,
        color: '${\"#c21b17\" if group == \"Phong trào\" else \"#004aad\"}',
        template: '${Lastname.upper()} ${Firstname.upper()}',
        groupId: '',
        border: {
            strokeWeight: 0,
            color: '#000000',
            fill: '',
            radius: 0,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            minWidth: 0,
            minHeight: 0,
        },
    },
    club: {
        anchor: 'mm',
        offsetX: 0,
        offsetY: 210,
        maxWidth: 1450,
        maxFontSize: 80,
        maxWidthCompensate: 1,
        offsetXCompensate: 1,
        offsetYCompensate: 1,
        color: '${\"#004aad\" if group == \"Phong trào\" else \"#c21b17\"}',
        template: '${f\"Đơn vị: {Club}\" if club else \"\"}',
        groupId: '',
        border: {
            strokeWeight: 0,
            color: '#000000',
            fill: '',
            radius: 0,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            minWidth: 0,
            minHeight: 0,
        },
    },
    group: {
        anchor: 'mm',
        offsetX: 0,
        offsetY: 295,
        maxWidth: 1600,
        maxFontSize: 70,
        maxWidthCompensate: 1,
        offsetXCompensate: 1,
        offsetYCompensate: 1,
        color: '${\"#c21b17\" if gender == \"f\" else \"#004aad\"}',
        template: '',
        groupId: '',
        border: {
            strokeWeight: 0,
            color: '#000000',
            fill: '',
            radius: 0,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            minWidth: 0,
            minHeight: 0,
        },
    },
    id: {
        anchor: 'mm',
        offsetX: 750,
        offsetY: 300,
        maxWidth: 200,
        maxFontSize: 100,
        maxWidthCompensate: 1,
        offsetXCompensate: 1,
        offsetYCompensate: 1,
        color: '${{\"U7\": \"#c21b17\", \"U9\": \"#004aad\", \"U11\": \"#03670d\"}.get(Group, \"#ed9e0e\")}',
        template: '${}',
        groupId: '',
        border: {
            strokeWeight: 10,
            color: '${{\"U7\": \"#c21b17\", \"U9\": \"#004aad\", \"U11\": \"#03670d\"}.get(Group, \"#ed9e0e\")}',
            fill: '#fff9e1',
            radius: 20,
            padding: { top: 30, right: 30, bottom: 30, left: 30 },
            minWidth: 140,
            minHeight: 0,
        },
    },
};

// ─── Config tree node types for editor ───────────────────────────────────────

function getNodeType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'string';
}

// ─── Inline value editor ──────────────────────────────────────────────────────

function InlineValueEditor({ value, onChange }) {
    const type = getNodeType(value);
    const [localVal, setLocalVal] = useState(String(value ?? ''));

    useEffect(() => {
        setLocalVal(String(value ?? ''));
    }, [value]);

    const commit = () => {
        if (type === 'number') {
            const n = Number(localVal);
            onChange(isNaN(n) ? value : n);
        } else if (type === 'boolean') {
            onChange(localVal === 'true');
        } else {
            onChange(localVal);
        }
    };

    if (type === 'boolean') {
        return (
            <select
                className="text-xs bg-surface-50-950 border border-surface-200-800 rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary-500 max-w-20"
                value={String(value)}
                onChange={e => onChange(e.target.value === 'true')}
            >
                <option value="true">true</option>
                <option value="false">false</option>
            </select>
        );
    }

    return (
        <input
            type={type === 'number' ? 'number' : 'text'}
            className="text-xs bg-surface-50-950 border border-surface-200-800 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary-500 min-w-0 flex-1"
            value={localVal}
            onChange={e => setLocalVal(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } e.stopPropagation(); }}
        />
    );
}

// ─── Config tree node ─────────────────────────────────────────────────────────

function ConfigNode({ nodeKey, value, path, onUpdate, depth = 0 }) {
    const [expanded, setExpanded] = useState(depth < 2);
    const type = getNodeType(value);
    const isComplex = type === 'object' || type === 'array';

    const handleLeafChange = (newVal) => {
        onUpdate([...path, nodeKey], newVal);
    };

    const indent = depth * 12;

    if (isComplex) {
        const entries = Object.entries(value);
        return (
            <div>
                <button
                    className="flex items-center gap-1 w-full text-left hover:bg-surface-100-900 rounded px-1 py-0.5 transition-colors group"
                    style={{ paddingLeft: `${indent + 4}px` }}
                    onClick={() => setExpanded(v => !v)}
                >
                    <span className="text-surface-400-600 shrink-0">
                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <span className="text-xs font-medium text-surface-700-300 shrink-0">{nodeKey}</span>
                    <span className="text-xs text-surface-400-600 ml-1">{'{ }'}</span>
                </button>
                {expanded && (
                    <div>
                        {entries.map(([k, v]) => (
                            <ConfigNode
                                key={k}
                                nodeKey={k}
                                value={v}
                                path={[...path, nodeKey]}
                                onUpdate={onUpdate}
                                depth={depth + 1}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Leaf node
    return (
        <div
            className="flex items-center gap-2 hover:bg-surface-100-900 rounded px-1 py-0.5 transition-colors"
            style={{ paddingLeft: `${indent + 16}px` }}
        >
            <span className="text-xs text-surface-600-400 shrink-0 min-w-[80px]">{nodeKey}</span>
            <InlineValueEditor value={value} onChange={handleLeafChange} />
        </div>
    );
}

// ─── Config tree root ─────────────────────────────────────────────────────────

function ConfigTree({ config, onUpdate }) {
    const [expanded, setExpanded] = useState({
        config: true, name: true, club: false, group: false, id: false,
    });

    // Toggle a top-level section
    const toggleSection = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    // Update a value deep in config via path array
    const handleUpdate = useCallback((path, newVal) => {
        onUpdate(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            let cur = next;
            for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
            cur[path[path.length - 1]] = newVal;
            return next;
        });
    }, [onUpdate]);

    const topKeys = Object.keys(config);

    return (
        <div className="font-mono text-xs">
            <div className="text-xs text-surface-500-400 px-1 py-1 font-semibold uppercase tracking-wider select-none">
                Player Card Config {'{ }'}
            </div>
            {topKeys.map(sectionKey => {
                const sectionVal = config[sectionKey];
                const isOpen = expanded[sectionKey] ?? false;
                const entries = Object.entries(sectionVal);
                return (
                    <div key={sectionKey}>
                        <button
                            className="flex items-center gap-1 w-full text-left hover:bg-surface-100-900 rounded px-1 py-0.5 transition-colors"
                            style={{ paddingLeft: '4px' }}
                            onClick={() => toggleSection(sectionKey)}
                        >
                            <span className="text-surface-400-600 shrink-0">
                                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </span>
                            <span className="text-xs font-semibold text-primary-600-400">{sectionKey}</span>
                            <span className="text-xs text-surface-400-600 ml-1">{'{ }'}</span>
                        </button>
                        {isOpen && entries.map(([k, v]) => (
                            <ConfigNode
                                key={k}
                                nodeKey={k}
                                value={v}
                                path={[sectionKey]}
                                onUpdate={handleUpdate}
                                depth={1}
                            />
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Drag-and-drop file zone ──────────────────────────────────────────────────

function DropZone({ accept, label, icon: Icon, fileName, onFile }) {
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef(null);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
    };

    return (
        <label
            className={`flex items-center gap-3 px-3 py-2.5 border border-dashed rounded-lg cursor-pointer transition-colors select-none ${
                dragging
                    ? 'border-primary-500 bg-primary-500/10'
                    : 'border-surface-300-700 hover:bg-surface-50-950'
            }`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
        >
            <Icon size={16} className="text-surface-400-600 shrink-0" />
            <span className="text-sm truncate">
                {fileName
                    ? <span className="text-primary-600-400 font-medium">{fileName}</span>
                    : <span className="text-surface-400-600">{label}</span>
                }
            </span>
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={e => { const f = e.target.files[0]; if (f) onFile(f); }}
            />
        </label>
    );
}

// ─── Canvas preview ───────────────────────────────────────────────────────────

function CardPreview({ imageDataUrl, config, player }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;

        ctx.clearRect(0, 0, W, H);

        // Checkerboard background (transparent indicator)
        const sq = 12;
        for (let y = 0; y < H; y += sq) {
            for (let x = 0; x < W; x += sq) {
                ctx.fillStyle = (Math.floor(x / sq) + Math.floor(y / sq)) % 2 === 0
                    ? '#e0e0e0' : '#c8c8c8';
                ctx.fillRect(x, y, sq, sq);
            }
        }

        if (!imageDataUrl) return;

        const img = new window.Image();
        img.onload = () => {
            // Fit image inside canvas preserving aspect ratio
            const scale = Math.min(W / img.width, H / img.height);
            const dw = img.width * scale;
            const dh = img.height * scale;
            const dx = (W - dw) / 2;
            const dy = (H - dh) / 2;
            ctx.drawImage(img, dx, dy, dw, dh);

            // Draw text overlays using config (simplified preview)
            if (!player) return;
            const cx = W / 2;
            const cy = H / 2;

            const renderTextLayer = (layerCfg) => {
                if (!layerCfg?.template) return;
                const tmpl = layerCfg.template;
                // Very naive template rendering for preview — just show field values
                let text = tmpl
                    .replace(/\$\{Lastname\.upper\(\)\}/g, (player.name || '').split(' ')[0]?.toUpperCase() || '')
                    .replace(/\$\{Firstname\.upper\(\)\}/g, (player.name || '').split(' ').slice(1).join(' ').toUpperCase() || '')
                    .replace(/\$\{[^}]*club[^}]*\}/gi, player.club ? `Đơn vị: ${player.club}` : '')
                    .replace(/\$\{[^}]*\}/g, '');
                if (!text.trim()) return;

                const maxFontSize = Math.min((layerCfg.maxFontSize || 80) * scale, 36);
                ctx.font = `bold ${maxFontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Simple color — try to extract first hex if it's a static color
                const colorMatch = (layerCfg.color || '#333').match(/#[0-9a-fA-F]{6}/);
                ctx.fillStyle = colorMatch ? colorMatch[0] : '#333333';

                const ox = (layerCfg.offsetX || 0) * scale;
                const oy = (layerCfg.offsetY || 0) * scale;
                ctx.fillText(text, cx + dx + ox, cy + dy + oy, (layerCfg.maxWidth || 800) * scale);
            };

            renderTextLayer(config?.name);
            renderTextLayer(config?.club);
            renderTextLayer(config?.group);
        };
        img.src = imageDataUrl;
    }, [imageDataUrl, config, player]);

    return (
        <canvas
            ref={canvasRef}
            width={460}
            height={320}
            className="rounded border border-surface-200-800 w-full"
            style={{ imageRendering: 'auto' }}
        />
    );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function GeneratePlayerCardModal({ open, onClose, players = [] }) {
    const [config, setConfig] = useState(() => JSON.parse(JSON.stringify(DEFAULT_CONFIG)));

    // Prevent Portal from rendering during SSR (avoids hydration attribute mismatch)
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // File states
    const [imageFile, setImageFile]   = useState(null);
    const [imageDataUrl, setImageDataUrl] = useState(null);
    const [fontFile, setFontFile]     = useState(null);

    // Preview player selector
    const [previewIdx, setPreviewIdx] = useState('');

    const previewPlayer = previewIdx !== '' ? players[Number(previewIdx)] ?? null : null;

    // Load image as data URL for canvas preview
    useEffect(() => {
        if (!imageFile) { setImageDataUrl(null); return; }
        const reader = new FileReader();
        reader.onload = e => setImageDataUrl(e.target.result);
        reader.readAsDataURL(imageFile);
    }, [imageFile]);

    // ── Config import / export ────────────────────────────────────────────────

    const importConfigRef = useRef(null);

    const handleImportConfig = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target.result);
                setConfig(parsed);
            } catch {
                alert('Invalid JSON config file.');
            }
        };
        reader.readAsText(file, 'utf-8');
        e.target.value = '';
    };

    const handleExportConfig = () => {
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: 'player-card-config.json' }).click();
        URL.revokeObjectURL(url);
    };

    // ── Download helpers ──────────────────────────────────────────────────────

    const downloadCard = useCallback((player) => {
        if (!imageDataUrl) return;
        // For the browser preview we produce a PNG from the canvas
        // In production this would call a server or Python process
        const canvas = document.createElement('canvas');
        canvas.width = 460;
        canvas.height = 320;
        const ctx = canvas.getContext('2d');

        const img = new window.Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const playerName = (player?.name || 'player').replace(/\s+/g, '_');
            const url = canvas.toDataURL('image/png');
            Object.assign(document.createElement('a'), {
                href: url,
                download: `${playerName}_card.png`,
            }).click();
        };
        img.src = imageDataUrl;
    }, [imageDataUrl]);

    const handleDownloadCurrent = () => {
        if (previewPlayer) downloadCard(previewPlayer);
    };

    const handleDownloadAll = () => {
        players.forEach((p, i) => {
            setTimeout(() => downloadCard(p), i * 200);
        });
    };

    if (!open || !mounted) return null;

    return (
        <Portal>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div
                    className="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl flex flex-col"
                    style={{ width: '1060px', maxWidth: '100%', maxHeight: '90vh' }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-200-800 shrink-0">
                        <div className="flex items-center gap-2">
                            <CreditCard size={18} className="text-primary-500" />
                            <h2 className="text-base font-semibold">Generate player cards</h2>
                        </div>
                        <button
                            className="p-1.5 rounded hover:bg-surface-200-800 transition-colors cursor-pointer"
                            onClick={onClose}
                            aria-label="Close"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Upload strip */}
                    <div className="px-5 py-3 border-b border-surface-200-800 space-y-2 shrink-0">
                        <DropZone
                            accept="image/*"
                            label="Drag and Drop or Select image"
                            icon={Image}
                            fileName={imageFile?.name}
                            onFile={setImageFile}
                        />
                        <DropZone
                            accept=".ttf,.otf,.woff,.woff2"
                            label="Drag and Drop or Select font"
                            icon={Type}
                            fileName={fontFile?.name}
                            onFile={setFontFile}
                        />
                    </div>

                    {/* Body: preview | settings */}
                    <div className="flex flex-1 min-h-0 overflow-hidden">
                        {/* ── Left: Preview ── */}
                        <div className="flex-1 flex flex-col gap-3 p-4 border-r border-surface-200-800 min-w-0">
                            <CardPreview
                                imageDataUrl={imageDataUrl}
                                config={config}
                                player={previewPlayer}
                            />

                            {/* Vertical/horizontal crosshair hint when no image */}
                            {!imageDataUrl && (
                                <p className="text-xs text-center text-surface-400-600">
                                    Upload a template image to see the preview
                                </p>
                            )}
                        </div>

                        {/* ── Right: Settings ── */}
                        <div className="w-80 flex flex-col shrink-0">
                            {/* Config toolbar */}
                            <div className="flex gap-2 px-3 py-2 border-b border-surface-200-800 shrink-0">
                                <label className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded preset-tonal cursor-pointer hover:preset-tonal-primary transition-colors">
                                    <FileUp size={13} />
                                    Import config
                                    <input
                                        ref={importConfigRef}
                                        type="file"
                                        accept=".json"
                                        className="hidden"
                                        onChange={handleImportConfig}
                                    />
                                </label>
                                <button
                                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded preset-tonal cursor-pointer hover:preset-tonal-primary transition-colors"
                                    onClick={handleExportConfig}
                                >
                                    <FileDown size={13} />
                                    Export config
                                </button>
                            </div>

                            {/* Config tree */}
                            <div className="flex-1 overflow-y-auto px-2 py-1">
                                <ConfigTree config={config} onUpdate={setConfig} />
                            </div>

                            {/* Preview player selector */}
                            <div className="border-t border-surface-200-800 px-3 py-2 flex items-center gap-2 shrink-0">
                                <span className="text-xs text-surface-500-400 shrink-0">Preview</span>
                                <select
                                    className="flex-1 text-xs bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1.5 outline-none cursor-pointer"
                                    value={previewIdx}
                                    onChange={e => setPreviewIdx(e.target.value)}
                                >
                                    <option value="">------</option>
                                    {players.map((p, i) => (
                                        <option key={i} value={i}>
                                            {p.name || `Player ${p.playerUniqueId}`}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Update preview button */}
                            <div className="px-3 pb-2 shrink-0">
                                <button
                                    className="w-full flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded preset-filled cursor-pointer"
                                    onClick={() => {
                                        // Trigger re-render by toggling a dummy state (canvas effect already watches deps)
                                        setPreviewIdx(v => v);
                                    }}
                                >
                                    <RefreshCw size={14} />
                                    Update preview
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-200-800 shrink-0">
                        <button
                            className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded preset-tonal cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={handleDownloadCurrent}
                            disabled={!imageDataUrl || !previewPlayer}
                            title={!previewPlayer ? 'Select a player to preview first' : ''}
                        >
                            <Download size={14} />
                            Download current
                        </button>
                        <button
                            className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded preset-filled cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={handleDownloadAll}
                            disabled={!imageDataUrl || players.length === 0}
                        >
                            <Download size={14} />
                            Download all
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
}
