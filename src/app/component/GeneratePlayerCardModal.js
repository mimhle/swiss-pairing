"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Portal } from '@skeletonlabs/skeleton-react';
import {
    ChevronDown,
    ChevronRight,
    Copy,
    CreditCard,
    Download,
    FileDown,
    FileUp,
    Image,
    Plus,
    Redo2,
    RefreshCw,
    Trash2,
    Type,
    Undo2,
    X,
} from 'lucide-react';
import { loadCardGenAsset, saveCardGenAsset } from './indexedDbPlayers';
import JSZip from 'jszip';
import ScrollLock from '@/app/component/ScrollLock';
import { useTournament } from '@/app/context/TournamentContext';
import ConfirmationModal from './ConfirmationModal';

// ─── Shared rendering logic ───────────────────────────────────────────────────

function crc32(data) {
    let crc = -1;
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    for (let i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}

async function injectPngDpi(blob, dpiX, dpiY) {
    if (!dpiX || !dpiY) return blob;
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    // Check PNG signature
    if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
        return blob;
    }

    const ppmX = Math.round(dpiX / 0.0254);
    const ppmY = Math.round(dpiY / 0.0254);

    // Prepare pHYs chunk
    const physChunk = new Uint8Array(21);
    const physView = new DataView(physChunk.buffer);
    physView.setUint32(0, 9); // length
    physChunk.set([112, 72, 89, 115], 4); // 'pHYs'
    physView.setUint32(8, ppmX);
    physView.setUint32(12, ppmY);
    physView.setUint8(16, 1); // unit = meter

    const crc = crc32(physChunk.subarray(4, 17));
    physView.setUint32(17, crc);

    // Insert pHYs chunk after IHDR
    const ihdrLength = view.getUint32(8);
    const insertAt = 8 + 4 + 4 + ihdrLength + 4;

    const newBuffer = new Uint8Array(buffer.byteLength + 21);
    newBuffer.set(new Uint8Array(buffer.slice(0, insertAt)), 0);
    newBuffer.set(physChunk, insertAt);
    newBuffer.set(new Uint8Array(buffer.slice(insertAt)), insertAt + 21);

    return new Blob([newBuffer], { type: 'image/png' });
}

async function injectJpegDpi(blob, dpiX, dpiY) {
    if (!dpiX || !dpiY) return blob;
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    // Check JPEG signature (SOI)
    if (view.getUint16(0) !== 0xFFD8) return blob;

    let offset = 2;
    while (offset < view.byteLength) {
        const marker = view.getUint16(offset);
        const length = view.getUint16(offset + 2);

        if (marker === 0xFFE0) {
            // Found APP0. Check if it's JFIF.
            const id = [view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7), view.getUint8(offset + 8)];
            if (id[0] === 74 && id[1] === 70 && id[2] === 73 && id[3] === 70 && id[4] === 0) {
                // Update DPI (unit=1: dots per inch)
                // Offset 11: Units, 12: Xdensity, 14: Ydensity
                view.setUint8(offset + 11, 1);
                view.setUint16(offset + 12, dpiX);
                view.setUint16(offset + 14, dpiY);
                return new Blob([buffer], { type: 'image/jpeg' });
            }
        }
        offset += 2 + length;
        if (marker === 0xFFDA || marker === 0xFFD9) break;
    }
    return blob;
}

function computeDimensions(configScale, imgWidth, imgHeight) {
    const scaleW = configScale?.width || 0;
    const scaleH = configScale?.height || 0;
    let outW, outH;
    if (scaleW === 0 && scaleH === 0) {
        outW = imgWidth;
        outH = imgHeight;
    } else if (scaleW === 0) {
        outH = scaleH;
        outW = Math.round(scaleH * (imgWidth / imgHeight));
    } else if (scaleH === 0) {
        outW = scaleW;
        outH = Math.round(scaleW * (imgHeight / imgWidth));
    } else {
        outW = scaleW;
        outH = scaleH;
    }
    return { outW, outH };
}

function evaluateTemplate(templateStr, player) {
    if (!templateStr || typeof templateStr !== 'string') return '';
    if (!templateStr.includes('${')) return templateStr;
    try {
        const proxy = new Proxy(player, {
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

        const evalFunc = new Function('ctx', `
            with(ctx) {
                return \`${templateStr}\`;
            }
        `);
        return evalFunc(proxy);
    } catch (e) {
        return templateStr;
    }
}

function renderCardContent(ctx, W, H, outW, player, config, fontFamily) {
    if (!player) return;
    const previewScale = W / outW;
    const cx = W / 2;
    const cy = H / 2;

    const anchorToCanvas = (anchor) => {
        const h = (anchor || 'mm')[0];
        const v = (anchor || 'mm')[1];
        return {
            textAlign: { l: 'left', m: 'center', r: 'right' }[h] ?? 'center',
            textBaseline: {
                t: 'top', m: 'middle', b: 'bottom',
                s: 'alphabetic', a: 'alphabetic', d: 'ideographic'
            }[v] ?? 'middle',
        };
    };

    const renderTextLayer = (layerCfg) => {
        if (!layerCfg?.template) return;

        let text = evaluateTemplate(layerCfg.template, player);
        if (!text.trim()) return;

        let fontSize = (layerCfg.maxFontSize || 80) * previewScale;
        let maxW = (layerCfg.maxWidth || 0) * previewScale;
        let ox = (layerCfg.offsetX || 0) * previewScale;
        let oy = (layerCfg.offsetY || 0) * previewScale;

        if (maxW > 0) {
            const step = previewScale;
            ctx.font = `bold ${fontSize}px "${fontFamily || 'sans-serif'}"`;
            while (ctx.measureText(text).width >= maxW && fontSize > step) {
                fontSize -= step;
                maxW *= (layerCfg.maxWidthCompensate || 1);
                ox *= (layerCfg.offsetXCompensate || 1);
                oy *= (layerCfg.offsetYCompensate || 1);
                ctx.font = `bold ${fontSize}px "${fontFamily || 'sans-serif'}"`;
            }
        }

        ctx.font = `bold ${fontSize}px "${fontFamily || 'sans-serif'}"`;

        const { textAlign, textBaseline } = anchorToCanvas(layerCfg.anchor);

        // Measure text for border bounding box
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const textHeight = (metrics.actualBoundingBoxAscent !== undefined && metrics.actualBoundingBoxDescent !== undefined)
            ? (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent)
            : fontSize;
        const textAscent = metrics.actualBoundingBoxAscent !== undefined ? metrics.actualBoundingBoxAscent : fontSize * 0.8;

        const border = layerCfg.border || {};
        const strokeW = (border.strokeWeight || 0) * previewScale;

        if (strokeW > 0 || border.fill) {
            const pt = (border.padding?.top || 0) * previewScale;
            const pr = (border.padding?.right || 0) * previewScale;
            const pb = (border.padding?.bottom || 0) * previewScale;
            const pl = (border.padding?.left || 0) * previewScale;

            const minW = (border.minWidth || 0) * previewScale;
            const minH = (border.minHeight || 0) * previewScale;

            const desiredW = textWidth + pl + pr;
            const desiredH = textHeight + pt + pb;
            const boxW = Math.max(desiredW, minW);
            const boxH = Math.max(desiredH, minH);
            const diffW = boxW - desiredW;
            const diffH = boxH - desiredH;

            const x = cx + ox;
            const y = cy + oy;

            let boxX = x;
            if (textAlign === 'center') boxX = x - textWidth / 2 - pl - diffW / 2;
            else if (textAlign === 'right') boxX = x - textWidth - pl - diffW;
            else boxX = x - pl;

            let boxY = y;
            if (textBaseline === 'middle') boxY = y - textHeight / 2 - pt - diffH / 2;
            else if (textBaseline === 'top') boxY = y - pt;
            else if (textBaseline === 'bottom') boxY = y - textHeight - pt - diffH;
            else if (textBaseline === 'alphabetic') boxY = y - textAscent - pt - diffH / 2;
            else boxY = y - textHeight / 2 - pt - diffH / 2;

            ctx.save();
            const radius = (border.radius || 0) * previewScale;
            ctx.beginPath();
            if (radius > 0 && ctx.roundRect) {
                ctx.roundRect(boxX, boxY, boxW, boxH, radius);
            } else {
                ctx.rect(boxX, boxY, boxW, boxH);
            }

            if (border.fill) {
                const fillColor = evaluateTemplate(border.fill, player);
                if (fillColor) {
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                }
            }

            if (strokeW > 0 && border.color) {
                const strokeColor = evaluateTemplate(border.color, player);
                if (strokeColor) {
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = strokeW;
                    ctx.stroke();
                }
            }
            ctx.restore();
        }

        ctx.textAlign = textAlign;
        ctx.textBaseline = textBaseline;

        const colorStr = evaluateTemplate(layerCfg.color || '#333333', player);
        ctx.fillStyle = colorStr || '#333333';

        if (layerCfg.shadow) {
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = fontSize * 0.06;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = fontSize * 0.04;
        } else {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }

        ctx.fillText(text, cx + ox, cy + oy, maxW || undefined);

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
    };

    config?.layers?.forEach(layer => renderTextLayer(layer));
}

function migrateConfig(config) {
    if (!config) return null;
    if (config.layers) return config;
    const layersOrder = ['name', 'club', 'group', 'id'];
    const layers = layersOrder
        .filter(key => config[key])
        .map(key => ({ ...config[key], id: key }));

    Object.keys(config).forEach(key => {
        if (key !== 'config' && key !== 'layers' && !layersOrder.includes(key)) {
            if (config[key] && (config[key].template !== undefined || config[key].anchor !== undefined)) {
                layers.push({ ...config[key], id: key });
            }
        }
    });

    return { config: config.config, layers };
}

const LAYER_DEFAULT = {
    anchor: 'mm',
    offsetX: 0,
    offsetY: 0,
    maxWidth: 1000,
    maxFontSize: 60,
    maxWidthCompensate: 1,
    offsetXCompensate: 1,
    offsetYCompensate: 1,
    shadow: false,
    color: '#000000',
    template: 'New Layer',
    border: {
        strokeWeight: 0,
        color: '#000000',
        fill: '',
        radius: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        minWidth: 0,
        minHeight: 0,
    },
};

// ─── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
    config: {
        scale: { width: 0, height: 768 },
        dpi: { width: 300, height: 300 },
        outputFormat: 'png',
        quality: 0.9,
    },
    layers: [
        {
            id: 'name',
            anchor: 'mm',
            offsetX: 0,
            offsetY: 20,
            maxWidth: 1600,
            maxFontSize: 200,
            maxWidthCompensate: 1.001,
            offsetXCompensate: 1,
            offsetYCompensate: 0.9991,
            shadow: false,
            color: '${group === "Phong trào" ? "#c21b17" : "#004aad"}',
            template: '${name}',
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
        {
            id: 'club',
            anchor: 'mm',
            offsetX: 0,
            offsetY: 210,
            maxWidth: 1450,
            maxFontSize: 80,
            maxWidthCompensate: 1,
            offsetXCompensate: 1,
            offsetYCompensate: 1,
            shadow: false,
            color: '${group === "Phong trào" ? "#004aad" : "#c21b17"}',
            template: '${club ? "Đơn vị: " + club : ""}',
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
        {
            id: 'group',
            anchor: 'mm',
            offsetX: 0,
            offsetY: 295,
            maxWidth: 1600,
            maxFontSize: 70,
            maxWidthCompensate: 1,
            offsetXCompensate: 1,
            offsetYCompensate: 1,
            shadow: false,
            color: '${gender === "f" || gender === "nữ" ? "#c21b17" : "#004aad"}',
            template: '${group || ""}',
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
        {
            id: 'id',
            anchor: 'mm',
            offsetX: 750,
            offsetY: 300,
            maxWidth: 200,
            maxFontSize: 100,
            maxWidthCompensate: 1,
            offsetXCompensate: 1,
            offsetYCompensate: 1,
            shadow: false,
            color: '${{"U7": "#c21b17", "U9": "#004aad", "U11": "#03670d"}[group] || "#ed9e0e"}',
            template: '${playerUniqueId || ""}',
            border: {
                strokeWeight: 10,
                color: '${{"U7": "#c21b17", "U9": "#004aad", "U11": "#03670d"}[group] || "#ed9e0e"}',
                fill: '#fff9e1',
                radius: 20,
                padding: { top: 30, right: 30, bottom: 30, left: 30 },
                minWidth: 140,
                minHeight: 0,
            },
        },
    ],
};

// ─── Form-based Config Editor ─────────────────────────────────────────────────

function Field({ label, children }) {
    return (
        <label className="flex flex-col gap-1.5 w-full">
            <span className="text-[11px] text-surface-500-400 font-semibold uppercase tracking-wider">{label}</span>
            {children}
        </label>
    );
}

function InputNumber({ value, onChange }) {
    return (
        <input
            type="number"
            className="bg-surface-50-950 border border-surface-200-800 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full transition-all"
            value={value ?? ''}
            onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
    );
}

function InputText({ value, onChange }) {
    return (
        <input
            type="text"
            className="bg-surface-50-950 border border-surface-200-800 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full transition-all font-mono"
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
        />
    );
}

function AccordionItem({ title, isOpen, onToggle, children }) {
    return (
        <div className="border border-surface-200-800 rounded-lg mb-2 overflow-hidden bg-surface-100-900 shadow-sm transition-all duration-200">
            <button
                className="w-full flex items-center justify-between px-3 py-3 bg-surface-100-900 hover:bg-surface-200-800 transition-colors"
                onClick={onToggle}
            >
                <span className="text-xs font-bold text-primary-600-400 uppercase tracking-widest">{title}</span>
                {isOpen ? <ChevronDown size={16} className="text-surface-500-400" /> : <ChevronRight size={16} className="text-surface-500-400" />}
            </button>
            {isOpen && (
                <div className="border-t border-surface-200-800">
                    {children}
                </div>
            )}
        </div>
    );
}

function ConfigEditor({ config, onUpdate, showConfirm }) {
    const [openSection, setOpenSection] = useState(0);

    const toggle = (sec) => setOpenSection(prev => prev === sec ? null : sec);

    const updateGeneral = (field, value) => {
        onUpdate(prev => ({
            ...prev,
            config: {
                ...prev.config,
                scale: {
                    ...prev.config.scale,
                    [field]: value
                }
            }
        }));
    };

    const updateDpi = (field, value) => {
        onUpdate(prev => ({
            ...prev,
            config: {
                ...prev.config,
                dpi: {
                    ...prev.config.dpi,
                    [field]: value
                }
            }
        }));
    };

    const updateLayer = (idx, field, value) => {
        onUpdate(prev => {
            const newLayers = [...(prev.layers || [])];
            newLayers[idx] = { ...newLayers[idx], [field]: value };
            return { ...prev, layers: newLayers };
        });
    };

    const updateBorder = (idx, field, value) => {
        onUpdate(prev => {
            const newLayers = [...(prev.layers || [])];
            newLayers[idx] = {
                ...newLayers[idx],
                border: { ...newLayers[idx].border, [field]: value }
            };
            return { ...prev, layers: newLayers };
        });
    };

    const updatePadding = (idx, field, value) => {
        onUpdate(prev => {
            const newLayers = [...(prev.layers || [])];
            newLayers[idx] = {
                ...newLayers[idx],
                border: {
                    ...newLayers[idx].border,
                    padding: { ...newLayers[idx].border.padding, [field]: value }
                }
            };
            return { ...prev, layers: newLayers };
        });
    };

    const addLayer = () => {
        onUpdate(prev => ({
            ...prev,
            layers: [...(prev.layers || []), { ...LAYER_DEFAULT, id: `layer-${Date.now()}` }]
        }));
        setOpenSection(config.layers?.length || 0);
    };

    const removeLayer = (idx) => {
        showConfirm(
            "Remove Layer?",
            "Are you sure you want to remove this layer?",
            () => {
                onUpdate(prev => ({
                    ...prev,
                    layers: prev.layers.filter((_, i) => i !== idx)
                }));
                if (openSection === idx) setOpenSection(null);
                else if (openSection > idx) setOpenSection(openSection - 1);
            },
            'error',
            'Remove'
        );
    };

    const duplicateLayer = (idx) => {
        onUpdate(prev => {
            const newLayers = [...(prev.layers || [])];
            const layerToCopy = JSON.parse(JSON.stringify(newLayers[idx]));
            layerToCopy.id = `layer-${Date.now()}`;
            newLayers.splice(idx + 1, 0, layerToCopy);
            return { ...prev, layers: newLayers };
        });
        setOpenSection(idx + 1);
    };

    return (
        <div className="flex flex-col p-2">
            <AccordionItem title="General Config" isOpen={openSection === 'general'} onToggle={() => toggle('general')}>
                <div className="p-3 flex flex-col gap-3">
                    <div className="flex gap-3">
                        <Field label="Target Width">
                            <InputNumber value={config.config?.scale?.width} onChange={v => updateGeneral('width', v)} />
                        </Field>
                        <Field label="Target Height">
                            <InputNumber value={config.config?.scale?.height} onChange={v => updateGeneral('height', v)} />
                        </Field>
                    </div>
                    <div className="flex gap-3">
                        <Field label="DPI Width">
                            <InputNumber value={config.config?.dpi?.width} onChange={v => updateDpi('width', v)} />
                        </Field>
                        <Field label="DPI Height">
                            <InputNumber value={config.config?.dpi?.height} onChange={v => updateDpi('height', v)} />
                        </Field>
                        <Field label="Format">
                            <select
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full transition-all"
                                value={config.config?.outputFormat || 'png'}
                                onChange={e => onUpdate(prev => ({ ...prev, config: { ...prev.config, outputFormat: e.target.value } }))}
                            >
                                <option value="png">PNG</option>
                                <option value="jpg">JPG</option>
                            </select>
                        </Field>
                    </div>
                    {config.config?.outputFormat === 'jpg' && (
                        <div className="mt-1">
                            <Field label={`Output Quality (${Math.round((config.config?.quality || 0.9) * 100)}%)`}>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min="0.1"
                                        max="1"
                                        step="0.05"
                                        className="flex-1 accent-primary-500 cursor-pointer h-1.5 bg-surface-200-800 rounded-lg appearance-none"
                                        value={config.config?.quality || 0.9}
                                        onChange={e => onUpdate(prev => ({ ...prev, config: { ...prev.config, quality: parseFloat(e.target.value) } }))}
                                    />
                                    <span className="text-[10px] font-mono text-surface-500-400 w-8 text-right">
                                        {Math.round((config.config?.quality || 0.9) * 100)}%
                                    </span>
                                </div>
                            </Field>
                        </div>
                    )}
                </div>
                <div className="px-3 pb-3">
                    <p className="text-[11px] text-surface-500-400 leading-relaxed bg-surface-100-900 p-2 rounded border border-surface-200-800">
                        Set Width to <span className="font-mono text-primary-500">0</span> to auto-scale based on Height, or vice versa.
                    </p>
                </div>
            </AccordionItem>

            {config.layers?.map((layer, idx) => (
                <AccordionItem key={layer.id || idx} title={`Layer ${idx + 1}`} isOpen={openSection === idx} onToggle={() => toggle(idx)}>
                    <div className="p-3 flex flex-col gap-4">
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={(e) => { e.stopPropagation(); duplicateLayer(idx); }}
                                className="text-primary-500 hover:text-primary-700 p-1.5 rounded hover:bg-primary-500/10 transition-colors flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider border border-primary-500/20"
                            >
                                <Copy size={12} />
                                Duplicate Layer
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); removeLayer(idx); }}
                                className="text-error-500 hover:text-error-700 p-1.5 rounded hover:bg-error-500/10 transition-colors flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider border border-error-500/20"
                            >
                                <Trash2 size={12} />
                                Remove Layer
                            </button>
                        </div>

                        <Field label="Template Text / Variables">
                            <InputText value={layer.template} onChange={v => updateLayer(idx, 'template', v)} />
                        </Field>

                        <div className="flex gap-3">
                            <Field label="Font Size (px)">
                                <InputNumber value={layer.maxFontSize} onChange={v => updateLayer(idx, 'maxFontSize', v)} />
                            </Field>
                            <Field label="Color Expression">
                                <InputText value={layer.color} onChange={v => updateLayer(idx, 'color', v)} />
                            </Field>
                        </div>

                        <div className="flex gap-3">
                            <Field label="Offset X">
                                <InputNumber value={layer.offsetX} onChange={v => updateLayer(idx, 'offsetX', v)} />
                            </Field>
                            <Field label="Offset Y">
                                <InputNumber value={layer.offsetY} onChange={v => updateLayer(idx, 'offsetY', v)} />
                            </Field>
                        </div>

                        <div className="flex gap-3">
                            <Field label="Max Width">
                                <InputNumber value={layer.maxWidth} onChange={v => updateLayer(idx, 'maxWidth', v)} />
                            </Field>
                            <Field label="Anchor Alignment">
                                <select
                                    className="bg-surface-50-950 border border-surface-200-800 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full transition-all cursor-pointer"
                                    value={layer.anchor}
                                    onChange={e => updateLayer(idx, 'anchor', e.target.value)}
                                >
                                    <optgroup label="Top">
                                        <option value="tl">Top Left</option>
                                        <option value="tm">Top Middle</option>
                                        <option value="tr">Top Right</option>
                                    </optgroup>
                                    <optgroup label="Middle">
                                        <option value="ml">Middle Left</option>
                                        <option value="mm">Middle Middle</option>
                                        <option value="mr">Middle Right</option>
                                    </optgroup>
                                    <optgroup label="Bottom">
                                        <option value="bl">Bottom Left</option>
                                        <option value="bm">Bottom Middle</option>
                                        <option value="br">Bottom Right</option>
                                    </optgroup>
                                </select>
                            </Field>
                        </div>

                        <label className="flex items-center gap-2 text-[13px] font-medium cursor-pointer text-surface-700-300 hover:text-primary-500 transition-colors bg-surface-100-900 p-2 rounded-md border border-surface-200-800">
                            <input
                                type="checkbox"
                                checked={layer.shadow || false}
                                onChange={e => updateLayer(idx, 'shadow', e.target.checked)}
                                className="w-4 h-4 rounded bg-surface-50-950 border-surface-300-700 text-primary-500 focus:ring-primary-500"
                            />
                            Enable Drop Shadow
                        </label>

                        <details className="mt-1 group">
                            <summary className="text-[11px] text-surface-500-400 font-bold cursor-pointer hover:text-primary-500 flex items-center gap-1 select-none uppercase tracking-wider py-1">
                                <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                                Border & Background
                            </summary>
                            <div className="flex flex-col gap-3 mt-3 pl-4 border-l-2 border-surface-200-800">
                                <div className="flex gap-3">
                                    <Field label="Stroke Weight">
                                        <InputNumber value={layer.border?.strokeWeight} onChange={v => updateBorder(idx, 'strokeWeight', v)} />
                                    </Field>
                                    <Field label="Border Color">
                                        <InputText value={layer.border?.color} onChange={v => updateBorder(idx, 'color', v)} />
                                    </Field>
                                    <Field label="Fill Color">
                                        <InputText value={layer.border?.fill} onChange={v => updateBorder(idx, 'fill', v)} />
                                    </Field>
                                </div>
                                <div className="flex gap-3">
                                    <Field label="Radius">
                                        <InputNumber value={layer.border?.radius} onChange={v => updateBorder(idx, 'radius', v)} />
                                    </Field>
                                    <Field label="Min Width">
                                        <InputNumber value={layer.border?.minWidth} onChange={v => updateBorder(idx, 'minWidth', v)} />
                                    </Field>
                                    <Field label="Min Height">
                                        <InputNumber value={layer.border?.minHeight} onChange={v => updateBorder(idx, 'minHeight', v)} />
                                    </Field>
                                </div>
                                <div className="flex gap-3">
                                    <Field label="Pad Top">
                                        <InputNumber value={layer.border?.padding?.top} onChange={v => updatePadding(idx, 'top', v)} />
                                    </Field>
                                    <Field label="Pad Right">
                                        <InputNumber value={layer.border?.padding?.right} onChange={v => updatePadding(idx, 'right', v)} />
                                    </Field>
                                    <Field label="Pad Bottom">
                                        <InputNumber value={layer.border?.padding?.bottom} onChange={v => updatePadding(idx, 'bottom', v)} />
                                    </Field>
                                    <Field label="Pad Left">
                                        <InputNumber value={layer.border?.padding?.left} onChange={v => updatePadding(idx, 'left', v)} />
                                    </Field>
                                </div>
                            </div>
                        </details>

                        <details className="group">
                            <summary className="text-[11px] text-surface-500-400 font-bold cursor-pointer hover:text-primary-500 flex items-center gap-1 select-none uppercase tracking-wider py-1">
                                <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                                Advanced Auto-Scaling
                            </summary>
                            <div className="flex flex-col gap-3 mt-3 pl-4 border-l-2 border-surface-200-800">
                                <div className="flex gap-3">
                                    <Field label="Width Comp.">
                                        <InputNumber value={layer.maxWidthCompensate} onChange={v => updateLayer(idx, 'maxWidthCompensate', v)} />
                                    </Field>
                                    <Field label="X Comp.">
                                        <InputNumber value={layer.offsetXCompensate} onChange={v => updateLayer(idx, 'offsetXCompensate', v)} />
                                    </Field>
                                    <Field label="Y Comp.">
                                        <InputNumber value={layer.offsetYCompensate} onChange={v => updateLayer(idx, 'offsetYCompensate', v)} />
                                    </Field>
                                </div>
                            </div>
                        </details>
                    </div>
                </AccordionItem>
            ))}

            <button
                onClick={addLayer}
                className="mt-2 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-surface-300-700 rounded-lg text-surface-500-400 hover:border-primary-500 hover:text-primary-500 transition-all font-bold uppercase tracking-widest text-xs"
            >
                <Plus size={16} />
                Add New Layer
            </button>
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
            className={`flex items-center gap-3 px-3 py-2.5 border border-dashed rounded-lg cursor-pointer transition-colors select-none ${dragging
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

function CardPreview({ imageDataUrl, config, player, fontFamily }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (!imageDataUrl) {
            // Reset to default size and draw checkerboard
            canvas.width = 460;
            canvas.height = 320;
            const W = canvas.width;
            const H = canvas.height;
            const sq = 12;
            for (let y = 0; y < H; y += sq) {
                for (let x = 0; x < W; x += sq) {
                    ctx.fillStyle = (Math.floor(x / sq) + Math.floor(y / sq)) % 2 === 0
                        ? '#e0e0e0' : '#c8c8c8';
                    ctx.fillRect(x, y, sq, sq);
                }
            }
            return;
        }

        const img = new window.Image();
        img.onload = () => {
            // ── Step 1: compute output image dimensions from config.config.scale ──
            const { outW, outH } = computeDimensions(config?.config?.scale, img.width, img.height);

            // ── Step 2: size canvas to output aspect ratio at 2× for sharpness ──
            const RENDER_W = 920;
            const RENDER_H = Math.round(RENDER_W * (outH / outW));
            canvas.width = RENDER_W;
            canvas.height = RENDER_H;
            const W = canvas.width;
            const H = canvas.height;

            // Draw the image to fill the canvas (it was already scaled to output dims)
            ctx.drawImage(img, 0, 0, W, H);

            renderCardContent(ctx, W, H, outW, player, config, fontFamily);
        };
        img.src = imageDataUrl;
    }, [imageDataUrl, config, player, fontFamily]);

    return (
        <div className="w-full h-full flex items-center justify-center min-h-0">
            <canvas
                ref={canvasRef}
                width={460}
                height={320}
                className="rounded border border-surface-200-800"
                style={{ imageRendering: 'auto', maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
            />
        </div>
    );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

export default function GeneratePlayerCardModal({ open, onClose, players = [] }) {
    const { activeTournamentId } = useTournament();
    const [modal, setModal] = useState({ open: false, title: '', description: '', onConfirm: null, isAlert: false, variant: 'primary', confirmText: 'Confirm' });

    const showAlert = (title, description) => {
        setModal({ open: true, title, description, onConfirm: () => setModal(prev => ({ ...prev, open: false })), isAlert: true, variant: 'primary', confirmText: 'OK' });
    };

    const showConfirm = (title, description, onConfirm, variant = 'primary', confirmText = 'Confirm') => {
        setModal({ open: true, title, description, onConfirm: () => { onConfirm(); setModal(prev => ({ ...prev, open: false })); }, isAlert: false, variant, confirmText });
    };

    const [config, setConfig] = useState(() => migrateConfig(DEFAULT_CONFIG));

    // Prevent Portal from rendering during SSR (avoids hydration attribute mismatch)
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // ── Undo / Redo ───────────────────────────────────────────────────────────
    const pastRef = useRef([]);
    const futureRef = useRef([]);
    const lastSavedConfigRef = useRef(config);
    const [canUndoState, setCanUndoState] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    const pushHistory = useCallback((snapshot) => {
        pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), snapshot];
        futureRef.current = [];
        setCanUndoState(true);
        setCanRedo(false);
    }, []);

    const commitHistory = useCallback(() => {
        if (JSON.stringify(lastSavedConfigRef.current) !== JSON.stringify(config)) {
            pushHistory(lastSavedConfigRef.current);
            lastSavedConfigRef.current = config;
        }
    }, [config, pushHistory]);

    const undo = useCallback(() => {
        commitHistory();
        if (!pastRef.current.length) return;
        const snapshot = pastRef.current[pastRef.current.length - 1];
        pastRef.current = pastRef.current.slice(0, -1);
        setConfig(cur => {
            futureRef.current = [cur, ...futureRef.current.slice(0, MAX_HISTORY - 1)];
            setCanRedo(true);
            lastSavedConfigRef.current = snapshot;
            return snapshot;
        });
        setCanUndoState(pastRef.current.length > 0);
    }, [commitHistory]);

    const redo = useCallback(() => {
        commitHistory();
        if (!futureRef.current.length) return;
        const snapshot = futureRef.current[0];
        futureRef.current = futureRef.current.slice(1);
        setConfig(cur => {
            pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), cur];
            setCanUndoState(true);
            lastSavedConfigRef.current = snapshot;
            return snapshot;
        });
        setCanRedo(futureRef.current.length > 0);
    }, [commitHistory]);

    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (ctrl && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
            if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, undo, redo]);

    const isConfigDirty = JSON.stringify(lastSavedConfigRef.current) !== JSON.stringify(config);
    const canUndoActual = canUndoState || isConfigDirty;

    // File states
    const [imageFile, setImageFile] = useState(null);
    const [imageDataUrl, setImageDataUrl] = useState(null);
    const [fontFile, setFontFile] = useState(null);
    const [uploadExpanded, setUploadExpanded] = useState(true);

    const isInitialLoadRef = useRef(true);

    // Load persisted assets on mount
    useEffect(() => {
        if (!activeTournamentId) return;
        Promise.all([
            loadCardGenAsset('image', activeTournamentId),
            loadCardGenAsset('font', activeTournamentId),
            loadCardGenAsset('config', activeTournamentId)
        ]).then(([loadedImage, loadedFont, loadedConfig]) => {
            setImageFile(loadedImage || null);
            setFontFile(loadedFont || null);

            if (loadedConfig) {
                const migrated = migrateConfig(loadedConfig);
                setConfig(migrated);
                lastSavedConfigRef.current = migrated;
            } else {
                const defaultConfig = migrateConfig(DEFAULT_CONFIG);
                setConfig(defaultConfig);
                lastSavedConfigRef.current = defaultConfig;
            }

            if (loadedImage && loadedFont) {
                setUploadExpanded(false);
            } else {
                setUploadExpanded(true);
            }
        })
    }, [activeTournamentId]);

    // Persist config on change
    useEffect(() => {
        if (isInitialLoadRef.current) {
            isInitialLoadRef.current = false;
            return;
        }
        if (!activeTournamentId) return;
        saveCardGenAsset('config', config, activeTournamentId);
    }, [config, activeTournamentId]);

    const handleImageFile = (file) => {
        setImageFile(file);
        saveCardGenAsset('image', file, activeTournamentId);
        if (fontFile) setUploadExpanded(false);
    };

    const handleFontFile = (file) => {
        setFontFile(file);
        saveCardGenAsset('font', file, activeTournamentId);
        if (imageFile) setUploadExpanded(false);
    };

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

    // Load custom font file
    const [loadedFontFamily, setLoadedFontFamily] = useState('');
    useEffect(() => {
        if (!fontFile) {
            setLoadedFontFamily('');
            return;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                // Generate unique name so replacing the file forces an update
                const fontName = `CustomFont_${Date.now()}`;
                const font = new FontFace(fontName, e.target.result);
                const loadedFont = await font.load();
                document.fonts.add(loadedFont);
                setLoadedFontFamily(fontName);
            } catch (err) {
                console.error('Failed to load font:', err);
            }
        };
        reader.readAsArrayBuffer(fontFile);
    }, [fontFile]);

    // ── Config import / export ────────────────────────────────────────────────

    const importConfigRef = useRef(null);

    const handleImportConfig = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                setConfig(migrateConfig(data));
            } catch (e) {
                showAlert('Import Failed', 'Invalid JSON config file.');
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

    const [isDownloading, setIsDownloading] = useState(false);
    const [processedCount, setProcessedCount] = useState(0);
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');

    const generateCardBlob = (player) => {
        return new Promise((resolve) => {
            if (!imageDataUrl) { resolve(null); return; }
            const img = new window.Image();
            img.onload = () => {
                const { outW, outH } = computeDimensions(config?.config?.scale, img.width, img.height);
                const canvas = document.createElement('canvas');
                canvas.width = outW;
                canvas.height = outH;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, outW, outH);

                renderCardContent(ctx, outW, outH, outW, player, config, loadedFontFamily);

                const isPng = config?.config?.outputFormat === 'png' || !config?.config?.outputFormat;
                const format = isPng ? 'image/png' : 'image/jpeg';
                const quality = config?.config?.quality ?? 0.9;
                canvas.toBlob(async (blob) => {
                    const dpiX = config?.config?.dpi?.width || 300;
                    const dpiY = config?.config?.dpi?.height || 300;
                    let finalBlob = blob;
                    if (isPng) {
                        finalBlob = await injectPngDpi(blob, dpiX, dpiY);
                    } else {
                        finalBlob = await injectJpegDpi(blob, dpiX, dpiY);
                    }
                    resolve(finalBlob);
                }, format, quality);
            };
            img.src = imageDataUrl;
        });
    };

    const handleDownloadCurrent = async () => {
        if (!previewPlayer || isDownloading) return;
        setIsDownloading(true);
        const blob = await generateCardBlob(previewPlayer);
        if (blob) {
            const playerName = (previewPlayer?.name || 'player').replace(/\s+/g, '_');
            const ext = config?.config?.outputFormat === 'jpg' ? 'jpg' : 'png';
            const url = URL.createObjectURL(blob);
            Object.assign(document.createElement('a'), {
                href: url,
                download: `${playerName}_card.${ext}`,
            }).click();
            URL.revokeObjectURL(url);
        }
        setIsDownloading(false);
    };

    const handleDownloadAll = async () => {
        if (!players.length || !imageDataUrl || isDownloading) return;

        const startIdx = Math.max(0, (parseInt(rangeStart) || 1) - 1);
        const endIdx = Math.min(Math.max(0, players.length - 1), (parseInt(rangeEnd) || players.length) - 1);

        if (startIdx > endIdx) {
            showAlert('Invalid Range', 'Invalid range. Check your start and end numbers.');
            return;
        }

        const targetPlayers = players.slice(startIdx, endIdx + 1);

        setIsDownloading(true);
        setProcessedCount(0);

        // Yield main thread to allow React to paint the 'Processing...' UI state
        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            const zip = new JSZip();
            // Process sequentially to prevent massive memory spikes and UI locking
            for (let j = 0; j < targetPlayers.length; j++) {
                const p = targetPlayers[j];
                const blob = await generateCardBlob(p);
                if (blob) {
                    const originalIndex = startIdx + j;
                    const id = p.playerUniqueId || p.id || String(originalIndex + 1);
                    const ext = config?.config?.outputFormat === 'jpg' ? 'jpg' : 'png';
                    zip.file(`${id}_card.${ext}`, blob);
                }

                setProcessedCount(j + 1);
                // Yield thread each iteration so the UI can update the counter
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const isAll = targetPlayers.length === players.length;
            Object.assign(document.createElement('a'), {
                href: url,
                download: isAll ? `all_player_cards.zip` : `player_cards_${startIdx + 1}_to_${endIdx + 1}.zip`,
            }).click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Failed to generate zip', e);
            showAlert('Error', 'Failed to generate zip');
        }

        setIsDownloading(false);
    };

    const updateConfigWithHistory = (newConfig) => {
        commitHistory();
        setConfig(newConfig);
    };

    const computedStartIdx = Math.max(0, (parseInt(rangeStart) || 1) - 1);
    const computedEndIdx = Math.min(Math.max(0, players.length - 1), (parseInt(rangeEnd) || players.length) - 1);
    const targetCount = players.length > 0 ? Math.max(0, computedEndIdx - computedStartIdx + 1) : 0;

    if (!open || !mounted) return null;

    return (
        <>
            <Portal>
                <ScrollLock />

                {/* Backdrop */}
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                    onClick={onClose}
                />

                {/* Modal */}
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl flex flex-col"
                        style={{ width: 'min(1060px, 100%)', maxHeight: '92vh', height: '92vh' }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-200-800 shrink-0">
                            <div className="flex items-center gap-2">
                                <CreditCard size={18} className="text-primary-500" />
                                <h2 className="text-base font-semibold">Generate player cards</h2>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 mr-1">
                                    <button
                                        className="p-1.5 rounded hover:bg-surface-200-800 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                                        onClick={undo}
                                        disabled={!canUndoActual}
                                        title="Undo (Ctrl+Z)"
                                    >
                                        <Undo2 size={15} />
                                    </button>
                                    <button
                                        className="p-1.5 rounded hover:bg-surface-200-800 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                                        onClick={redo}
                                        disabled={!canRedo}
                                        title="Redo (Ctrl+Y)"
                                    >
                                        <Redo2 size={15} />
                                    </button>
                                </div>
                                <div className="w-px h-4 bg-surface-200-800 mx-1"></div>

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
                                <div className="w-px h-4 bg-surface-200-800 mx-1"></div>
                                <button
                                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded preset-tonal cursor-pointer hover:preset-tonal-primary transition-colors"
                                    onClick={() => setUploadExpanded(v => !v)}
                                >
                                    {uploadExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    Uploads
                                </button>
                                <button
                                    className="p-1.5 rounded hover:bg-surface-200-800 transition-colors cursor-pointer ml-1"
                                    onClick={onClose}
                                    aria-label="Close"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Upload strip */}
                        {uploadExpanded && (
                            <div className="px-5 py-3 border-b border-surface-200-800 space-y-2 shrink-0">
                                <DropZone
                                    accept="image/*"
                                    label="Drag and Drop or Select image"
                                    icon={Image}
                                    fileName={imageFile?.name}
                                    onFile={handleImageFile}
                                />
                                <DropZone
                                    accept=".ttf,.otf,.woff,.woff2"
                                    label="Drag and Drop or Select font"
                                    icon={Type}
                                    fileName={fontFile?.name}
                                    onFile={handleFontFile}
                                />
                            </div>
                        )}

                        {/* Body: preview | settings */}
                        <div className="flex flex-1 min-h-0 overflow-hidden">
                            {/* ── Left: Preview ── */}
                            <div className="flex-1 flex flex-col gap-2 p-4 border-r border-surface-200-800 min-w-0 overflow-hidden">
                                <div className="flex-1 min-h-0 flex items-center justify-center">
                                    <CardPreview
                                        imageDataUrl={imageDataUrl}
                                        config={config}
                                        player={previewPlayer}
                                        fontFamily={loadedFontFamily}
                                    />
                                </div>

                                {/* Vertical/horizontal crosshair hint when no image */}
                                {!imageDataUrl && (
                                    <p className="text-xs text-center text-surface-400-600 shrink-0">
                                        Upload a template image to see the preview
                                    </p>
                                )}
                            </div>

                            {/* ── Right: Settings ── */}
                            <div className="w-80 flex flex-col shrink-0">

                                {/* Config Editor */}
                                <div className="flex flex-col h-full bg-surface-100-900 overflow-y-auto">
                                    <ConfigEditor
                                        config={config}
                                        onUpdate={updateConfigWithHistory}
                                        showConfirm={showConfirm}
                                    />
                                </div>

                                {/* Preview player selector */}
                                <div className="border-t border-surface-200-800 px-3 py-2 flex items-center gap-2 shrink-0">
                                    <span className="text-xs text-surface-500-400 shrink-0">Preview</span>
                                    <select
                                        className="flex-1 text-xs bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1.5 outline-none cursor-pointer"
                                        value={previewIdx}
                                        onChange={e => setPreviewIdx(e.target.value)}
                                        title="Scroll mouse wheel to quickly change player"
                                        onWheel={e => {
                                            if (players.length === 0) return;
                                            const delta = Math.sign(e.deltaY);
                                            if (delta === 0) return;
                                            let current = previewIdx === "" ? -1 : parseInt(previewIdx);
                                            current += delta;
                                            current = Math.max(0, Math.min(current, players.length - 1));
                                            setPreviewIdx(String(current));
                                        }}
                                    >
                                        <option value="">------</option>
                                        {players.map((p, i) => (
                                            <option key={i} value={i}>
                                                {p.name || `Player ${p.playerUniqueId}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-200-800 shrink-0">
                            {/* Range Selector */}
                            <div className="flex items-center gap-1.5 mr-auto">
                                <span className="text-sm text-surface-500-400 font-medium">Range:</span>
                                <input
                                    type="number"
                                    min="1" max={players.length}
                                    className="w-16 bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1 text-sm outline-none text-center disabled:opacity-50"
                                    placeholder="1"
                                    value={rangeStart}
                                    onChange={e => setRangeStart(e.target.value)}
                                    disabled={isDownloading}
                                />
                                <span className="text-sm text-surface-500-400">-</span>
                                <input
                                    type="number"
                                    min="1" max={players.length}
                                    className="w-16 bg-surface-100-900 border border-surface-200-800 rounded px-2 py-1 text-sm outline-none text-center disabled:opacity-50"
                                    placeholder={players.length || 'All'}
                                    value={rangeEnd}
                                    onChange={e => setRangeEnd(e.target.value)}
                                    disabled={isDownloading}
                                />
                            </div>

                            <button
                                className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded preset-tonal cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                onClick={handleDownloadCurrent}
                                disabled={!imageDataUrl || !previewPlayer || isDownloading}
                                title={!previewPlayer ? 'Select a player to preview first' : ''}
                            >
                                <Download size={14} />
                                Download current
                            </button>
                            <button
                                className={`relative overflow-hidden flex items-center justify-center gap-1.5 text-sm px-4 py-1.5 rounded transition-all min-w-[170px] ${isDownloading
                                    ? 'preset-filled cursor-wait'
                                    : 'preset-filled cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                                    }`}
                                onClick={handleDownloadAll}
                                disabled={!imageDataUrl || players.length === 0 || isDownloading}
                            >
                                {isDownloading && (
                                    <div
                                        className="absolute inset-0 rounded pointer-events-none"
                                        style={{
                                            padding: '3px',
                                            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                                            WebkitMaskComposite: 'xor',
                                            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                                            maskComposite: 'exclude',
                                        }}
                                    >
                                        <div className="absolute inset-[-1000%] animate-[spin_2s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,rgba(255,255,255,0.9)_15%,transparent_15%,transparent_50%,rgba(255,255,255,0.9)_65%,transparent_65%)]" />
                                    </div>
                                )}

                                {isDownloading ? (
                                    <span className="animate-pulse tracking-wide font-medium relative z-10">
                                        {processedCount > 0
                                            ? `Processing (${processedCount}/${targetCount})`
                                            : 'Processing...'}
                                    </span>
                                ) : (
                                    <>
                                        <Download size={14} className="relative z-10" />
                                        <span className="relative z-10">
                                            {(!rangeStart && !rangeEnd) ? 'Download all (ZIP)' : 'Download range (ZIP)'}
                                        </span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

            </Portal>
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
        </>
    );
}
