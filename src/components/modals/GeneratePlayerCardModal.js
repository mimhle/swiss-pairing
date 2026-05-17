"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, Portal, Steps } from '@skeletonlabs/skeleton-react';
import {
    ChevronDown,
    ChevronRight,
    Copy,
    CreditCard,
    Database,
    Download,
    FileDown,
    FileText,
    FileUp,
    Image,
    Plus,
    Redo2,
    Trash2,
    Type,
    Undo2,
    X,
} from 'lucide-react';
import { loadCardGenAsset, saveCardGenAsset } from '@/lib/tournamentStore';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import ScrollLock from '@/components/utility/ScrollLock';
import { useTournament } from '@/context/TournamentContext';
import ConfirmationModal from '@/components/modals/ConfirmationModal';
import useHydrated from '@/hooks/useHydrated';

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

function getCardPixelSize(exportSettings, imageSize) {
    if (!imageSize?.width || !imageSize?.height) return null;
    const { outW, outH } = computeDimensions(exportSettings?.scale, imageSize.width, imageSize.height);
    return { widthPx: outW, heightPx: outH };
}

function getCardPhysicalSize(exportSettings, pixelSize) {
    if (!pixelSize) return null;
    const dpiX = Math.max(1, exportSettings?.dpi?.width || 300);
    const dpiY = Math.max(1, exportSettings?.dpi?.height || 300);
    return {
        widthCm: pixelSize.widthPx / dpiX * 2.54,
        heightCm: pixelSize.heightPx / dpiY * 2.54,
    };
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        if (!dataUrl) {
            resolve(null);
            return;
        }
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load card template image.'));
        img.src = dataUrl;
    });
}

function createScaledTemplateCanvas(img, outW, outH) {
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    canvas.getContext('2d').drawImage(img, 0, 0, outW, outH);
    return canvas;
}

function formatCm(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)} cm` : '-';
}

function applyColorModeToCanvas(canvas, colorMode) {
    if (!canvas || colorMode === 'rgb') return;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        if (colorMode === 'grayscale') {
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
            continue;
        }

        if (colorMode === 'cmyk') {
            const rn = r / 255;
            const gn = g / 255;
            const bn = b / 255;
            const k = 1 - Math.max(rn, gn, bn);
            const c = k >= 1 ? 0 : (1 - rn - k) / (1 - k);
            const m = k >= 1 ? 0 : (1 - gn - k) / (1 - k);
            const y = k >= 1 ? 0 : (1 - bn - k) / (1 - k);
            data[i] = Math.round(255 * (1 - c) * (1 - k));
            data[i + 1] = Math.round(255 * (1 - m) * (1 - k));
            data[i + 2] = Math.round(255 * (1 - y) * (1 - k));
        }
    }

    ctx.putImageData(imageData, 0, 0);
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
    if (config.layers) return { layers: config.layers };
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

    return { layers };
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

const DEFAULT_EXPORT_SETTINGS = {
    scale: { width: 0, height: 768 },
    dpi: { width: 300, height: 300 },
    outputFormat: 'png',
    quality: 0.9,
    exportType: 'images',
    rangeStart: '',
    rangeEnd: '',
    pdf: {
        paperSize: 'a4',
        orientation: 'portrait',
        customWidthCm: 21,
        customHeightCm: 29.7,
        colorMode: 'rgb',
        cardsPerPage: 4,
        marginCm: 0.8,
        gapXCm: 0.5,
        gapYCm: 0.5,
        cropMarks: false,
    },
};

const PAPER_SIZES_CM = {
    a4: { label: 'A4', width: 21, height: 29.7 },
    letter: { label: 'Letter', width: 21.59, height: 27.94 },
    legal: { label: 'Legal', width: 21.59, height: 35.56 },
    a3: { label: 'A3', width: 29.7, height: 42 },
    custom: { label: 'Custom', width: 21, height: 29.7 },
};

function mergeExportSettings(saved, legacyConfig) {
    const legacy = legacyConfig?.config || {};
    const merged = {
        ...DEFAULT_EXPORT_SETTINGS,
        ...legacy,
        ...saved,
        scale: {
            ...DEFAULT_EXPORT_SETTINGS.scale,
            ...(legacy.scale || {}),
            ...(saved?.scale || {}),
        },
        dpi: {
            ...DEFAULT_EXPORT_SETTINGS.dpi,
            ...(legacy.dpi || {}),
            ...(saved?.dpi || {}),
        },
        pdf: {
            ...DEFAULT_EXPORT_SETTINGS.pdf,
            ...(saved?.pdf || {}),
        },
    };
    return merged;
}

function getConfigExportJson(config, exportSettings) {
    return JSON.stringify({ ...config, exportSettings }, null, 2);
}

function parseConfigJsonString(raw) {
    const trimmed = String(raw || '').trim().replace(/^\uFEFF/, '');
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return JSON.parse(fenced ? fenced[1] : trimmed);
}

function isReadableBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

function looksLikeCardConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (Array.isArray(value.layers)) return true;
    return Object.values(value).some(item => (
        item
        && typeof item === 'object'
        && !Array.isArray(item)
        && (item.template !== undefined || item.anchor !== undefined)
    ));
}

function normalizeImportedConfigData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Config must be a JSON object.');
    }

    const source = looksLikeCardConfig(data.config)
        ? { ...data.config, exportSettings: data.exportSettings || data.config.exportSettings }
        : data;
    const migrated = migrateConfig(source);

    if (!migrated || !Array.isArray(migrated.layers)) {
        throw new Error('Config JSON must contain player card layers.');
    }

    return {
        config: migrated,
        exportSettings: mergeExportSettings(source.exportSettings || data.exportSettings, source),
    };
}

function getPdfPageSize(settings) {
    const pdf = settings?.pdf || DEFAULT_EXPORT_SETTINGS.pdf;
    const preset = PAPER_SIZES_CM[pdf.paperSize] || PAPER_SIZES_CM.a4;
    let width = pdf.paperSize === 'custom' ? (pdf.customWidthCm || preset.width) : preset.width;
    let height = pdf.paperSize === 'custom' ? (pdf.customHeightCm || preset.height) : preset.height;
    if (pdf.orientation === 'landscape' && width < height) {
        [width, height] = [height, width];
    }
    if (pdf.orientation === 'portrait' && width > height) {
        [width, height] = [height, width];
    }
    return { width, height };
}

function getPdfGrid(exportSettings, cardSizeCm) {
    const pdf = exportSettings?.pdf || DEFAULT_EXPORT_SETTINGS.pdf;
    const cardsPerPage = Math.max(1, Math.floor(pdf.cardsPerPage || 1));
    const page = getPdfPageSize(exportSettings);
    const margin = Math.max(0, pdf.marginCm || 0);
    const gapX = Math.max(0, pdf.gapXCm || 0);
    const gapY = Math.max(0, pdf.gapYCm || 0);
    const availableW = page.width - margin * 2;
    const availableH = page.height - margin * 2;
    if (!cardSizeCm || availableW <= 0 || availableH <= 0) return null;

    let best = null;
    for (let cols = 1; cols <= cardsPerPage; cols++) {
        const rows = Math.ceil(cardsPerPage / cols);
        const usedW = cols * cardSizeCm.widthCm + Math.max(0, cols - 1) * gapX;
        const usedH = rows * cardSizeCm.heightCm + Math.max(0, rows - 1) * gapY;
        if (usedW <= availableW + 0.0001 && usedH <= availableH + 0.0001) {
            const waste = (availableW - usedW) + (availableH - usedH);
            if (!best || waste < best.waste) {
                best = { cols, rows, usedW, usedH, waste, page, margin, gapX, gapY };
            }
        }
    }
    return best;
}

function validatePdfLayout(exportSettings, cardSizeCm) {
    if (!cardSizeCm) return { valid: false, message: 'Upload a template image before exporting PDF.' };
    const grid = getPdfGrid(exportSettings, cardSizeCm);
    if (!grid) {
        const page = getPdfPageSize(exportSettings);
        return {
            valid: false,
            message: `The natural card size ${formatCm(cardSizeCm.widthCm)} x ${formatCm(cardSizeCm.heightCm)} does not fit this PDF layout on ${formatCm(page.width)} x ${formatCm(page.height)} paper.`,
        };
    }
    return { valid: true, grid };
}

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

function ConfigEditor({ config, exportSettings, onUpdate, onUpdateExportSettings, showConfirm, cardSizeCm }) {
    const [openSection, setOpenSection] = useState(0);

    const toggle = (sec) => setOpenSection(prev => prev === sec ? null : sec);

    const updateGeneral = (field, value) => {
        onUpdateExportSettings(prev => ({
            ...prev,
            scale: {
                ...prev.scale,
                [field]: value
            }
        }));
    };

    const updateDpi = (field, value) => {
        onUpdateExportSettings(prev => ({
            ...prev,
            dpi: {
                ...prev.dpi,
                [field]: value
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
            <AccordionItem title="Card Output" isOpen={openSection === 'general'} onToggle={() => toggle('general')}>
                <div className="p-3 flex flex-col gap-3">
                    <div className="flex gap-3">
                        <Field label="Target Width">
                            <InputNumber value={exportSettings?.scale?.width} onChange={v => updateGeneral('width', v)} />
                        </Field>
                        <Field label="Target Height">
                            <InputNumber value={exportSettings?.scale?.height} onChange={v => updateGeneral('height', v)} />
                        </Field>
                    </div>
                    <div className="flex gap-3">
                        <Field label="DPI Width">
                            <InputNumber value={exportSettings?.dpi?.width} onChange={v => updateDpi('width', v)} />
                        </Field>
                        <Field label="DPI Height">
                            <InputNumber value={exportSettings?.dpi?.height} onChange={v => updateDpi('height', v)} />
                        </Field>
                        <Field label="Format">
                            <select
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full transition-all"
                                value={exportSettings?.outputFormat || 'png'}
                                onChange={e => onUpdateExportSettings(prev => ({ ...prev, outputFormat: e.target.value }))}
                            >
                                <option value="png">PNG</option>
                                <option value="jpg">JPG</option>
                            </select>
                        </Field>
                    </div>
                    {exportSettings?.outputFormat === 'jpg' && (
                        <div className="mt-1">
                            <Field label={`Output Quality (${Math.round((exportSettings?.quality || 0.9) * 100)}%)`}>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min="0.1"
                                        max="1"
                                        step="0.05"
                                        className="flex-1 accent-primary-500 cursor-pointer h-1.5 bg-surface-200-800 rounded-lg appearance-none"
                                        value={exportSettings?.quality || 0.9}
                                        onChange={e => onUpdateExportSettings(prev => ({ ...prev, quality: parseFloat(e.target.value) }))}
                                    />
                                    <span className="text-[10px] font-mono text-surface-500-400 w-8 text-right">
                                        {Math.round((exportSettings?.quality || 0.9) * 100)}%
                                    </span>
                                </div>
                            </Field>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 rounded border border-surface-200-800 bg-surface-50-950 p-2">
                        <div>
                            <div className="text-[10px] uppercase font-semibold text-surface-500-400">Output width</div>
                            <div className="text-xs font-mono">{formatCm(cardSizeCm?.widthCm)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase font-semibold text-surface-500-400">Output height</div>
                            <div className="text-xs font-mono">{formatCm(cardSizeCm?.heightCm)}</div>
                        </div>
                    </div>
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

function CardPreview({ imageDataUrl, config, exportSettings, player, fontFamily }) {
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
            // ── Step 1: compute output image dimensions from export settings ──
            const { outW, outH } = computeDimensions(exportSettings?.scale, img.width, img.height);

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
    }, [imageDataUrl, config, exportSettings, player, fontFamily]);

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

function ExportSettingsEditor({
    exportSettings,
    onUpdate,
    cardSizeCm,
    pixelSize,
    pdfValidation,
}) {
    const update = (patch) => onUpdate(prev => ({ ...prev, ...patch }));
    const updatePdf = (patch) => onUpdate(prev => ({ ...prev, pdf: { ...prev.pdf, ...patch } }));
    const pdf = exportSettings.pdf || DEFAULT_EXPORT_SETTINGS.pdf;
    const page = getPdfPageSize(exportSettings);

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Range Start">
                        <InputNumber value={exportSettings.rangeStart} onChange={v => update({ rangeStart: v || '' })} />
                    </Field>
                    <Field label="Range End">
                        <InputNumber value={exportSettings.rangeEnd} onChange={v => update({ rangeEnd: v || '' })} />
                    </Field>
                </div>
                <Field label="Color Mode">
                    <select
                        className="bg-surface-50-950 border border-surface-200-800 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full transition-all"
                        value={pdf.colorMode}
                        onChange={e => updatePdf({ colorMode: e.target.value })}
                    >
                        <option value="rgb">RGB Color</option>
                        <option value="grayscale">Grayscale</option>
                        <option value="cmyk">Print CMYK</option>
                    </select>
                </Field>

                <div className="rounded border border-surface-200-800 p-3 bg-surface-50-950 space-y-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-primary-600-400">Card size</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <div className="text-surface-500-400">Pixels</div>
                            <div className="font-mono">{pixelSize ? `${pixelSize.widthPx} x ${pixelSize.heightPx}` : '-'}</div>
                        </div>
                        <div>
                            <div className="text-surface-500-400">Printed</div>
                            <div className="font-mono">{cardSizeCm ? `${formatCm(cardSizeCm.widthCm)} x ${formatCm(cardSizeCm.heightCm)}` : '-'}</div>
                        </div>
                    </div>
                </div>

                <div className="rounded border border-surface-200-800 p-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Image size={15} className="text-primary-500" />
                        Image export
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Format">
                            <select
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full transition-all"
                                value={exportSettings.outputFormat || 'png'}
                                onChange={e => update({ outputFormat: e.target.value })}
                            >
                                <option value="png">PNG</option>
                                <option value="jpg">JPG</option>
                            </select>
                        </Field>
                        <Field label="DPI X">
                            <InputNumber value={exportSettings.dpi?.width} onChange={v => update({ dpi: { ...exportSettings.dpi, width: v } })} />
                        </Field>
                        <Field label="DPI Y">
                            <InputNumber value={exportSettings.dpi?.height} onChange={v => update({ dpi: { ...exportSettings.dpi, height: v } })} />
                        </Field>
                    </div>
                    {exportSettings.outputFormat === 'jpg' && (
                        <Field label={`JPG Quality (${Math.round((exportSettings.quality || 0.9) * 100)}%)`}>
                            <input
                                type="range"
                                min="0.1"
                                max="1"
                                step="0.05"
                                className="w-full accent-primary-500 cursor-pointer h-1.5 bg-surface-200-800 rounded-lg appearance-none"
                                value={exportSettings.quality || 0.9}
                                onChange={e => update({ quality: parseFloat(e.target.value) })}
                            />
                        </Field>
                    )}
                </div>

                <div className="rounded border border-surface-200-800 p-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <FileText size={15} className="text-primary-500" />
                        PDF export
                    </div>
                    {(exportSettings.outputFormat || 'png') !== 'jpg' && (
                        <div className="text-xs rounded border p-2 border-warning-500/30 text-warning-600-400 bg-warning-500/5">
                            PDF export will use PNG images. JPG is usually faster and creates smaller PDF files.
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Paper">
                            <select
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full transition-all"
                                value={pdf.paperSize}
                                onChange={e => updatePdf({ paperSize: e.target.value })}
                            >
                                {Object.entries(PAPER_SIZES_CM).map(([key, paper]) => (
                                    <option key={key} value={key}>{paper.label}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Orientation">
                            <select
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full transition-all"
                                value={pdf.orientation}
                                onChange={e => updatePdf({ orientation: e.target.value })}
                            >
                                <option value="portrait">Portrait</option>
                                <option value="landscape">Landscape</option>
                            </select>
                        </Field>
                    </div>
                    {pdf.paperSize === 'custom' && (
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Paper Width (cm)">
                                <InputNumber value={pdf.customWidthCm} onChange={v => updatePdf({ customWidthCm: v })} />
                            </Field>
                            <Field label="Paper Height (cm)">
                                <InputNumber value={pdf.customHeightCm} onChange={v => updatePdf({ customHeightCm: v })} />
                            </Field>
                        </div>
                    )}
                    <Field label="Cards / Page">
                        <InputNumber value={pdf.cardsPerPage} onChange={v => updatePdf({ cardsPerPage: Math.max(1, v || 1) })} />
                    </Field>
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Margin (cm)">
                            <InputNumber value={pdf.marginCm} onChange={v => updatePdf({ marginCm: Math.max(0, v) })} />
                        </Field>
                        <Field label="Gap X (cm)">
                            <InputNumber value={pdf.gapXCm} onChange={v => updatePdf({ gapXCm: Math.max(0, v) })} />
                        </Field>
                        <Field label="Gap Y (cm)">
                            <InputNumber value={pdf.gapYCm} onChange={v => updatePdf({ gapYCm: Math.max(0, v) })} />
                        </Field>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-medium cursor-pointer text-surface-700-300 bg-surface-50-950 p-2 rounded-md border border-surface-200-800">
                        <input
                            type="checkbox"
                            checked={pdf.cropMarks || false}
                            onChange={e => updatePdf({ cropMarks: e.target.checked })}
                            className="w-4 h-4 rounded bg-surface-50-950 border-surface-300-700 text-primary-500 focus:ring-primary-500"
                        />
                        Crop marks
                    </label>
                    <div className={`text-xs rounded border p-2 ${pdfValidation.valid ? 'border-success-500/30 text-success-500 bg-success-500/5' : 'border-error-500/30 text-error-500 bg-error-500/5'}`}>
                        {pdfValidation.valid
                            ? `${pdfValidation.grid.cols} x ${pdfValidation.grid.rows} layout on ${formatCm(page.width)} x ${formatCm(page.height)} paper.`
                            : pdfValidation.message}
                    </div>
                </div>
            </div>

        </div>
    );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

export default function GeneratePlayerCardModal({ open, onClose, players = [] }) {
    const { activeTournamentId, tournaments = [] } = useTournament();
    const [modal, setModal] = useState({ open: false, title: '', description: '', onConfirm: null, isAlert: false, variant: 'primary', confirmText: 'Confirm' });

    const showAlert = (title, description) => {
        setModal({ open: true, title, description, onConfirm: () => setModal(prev => ({ ...prev, open: false })), isAlert: true, variant: 'primary', confirmText: 'OK' });
    };

    const showConfirm = (title, description, onConfirm, variant = 'primary', confirmText = 'Confirm') => {
        setModal({ open: true, title, description, onConfirm: () => { onConfirm(); setModal(prev => ({ ...prev, open: false })); }, isAlert: false, variant, confirmText });
    };

    const [config, setConfig] = useState(() => migrateConfig(DEFAULT_CONFIG));
    const [exportSettings, setExportSettings] = useState(() => mergeExportSettings(null, DEFAULT_CONFIG));
    const [wizardStep, setWizardStep] = useState(1);

    // Prevent Portal from rendering during SSR (avoids hydration attribute mismatch)
    const mounted = useHydrated();

    // ── Undo / Redo ───────────────────────────────────────────────────────────
    const pastRef = useRef([]);
    const futureRef = useRef([]);
    const lastSavedConfigRef = useRef(config);
    const [isConfigDirty, setIsConfigDirty] = useState(false);
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
            setIsConfigDirty(false);
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
            setIsConfigDirty(false);
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
            setIsConfigDirty(false);
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

    const canUndoActual = canUndoState || isConfigDirty;

    // File states
    const [imageFile, setImageFile] = useState(null);
    const [imageDataUrl, setImageDataUrl] = useState(null);
    const [imageSize, setImageSize] = useState(null);
    const [fontFile, setFontFile] = useState(null);
    const [uploadExpanded, setUploadExpanded] = useState(true);

    const isInitialLoadRef = useRef(true);
    const isInitialExportLoadRef = useRef(true);

    // Load persisted assets on mount
    useEffect(() => {
        if (!activeTournamentId) return;
        isInitialLoadRef.current = true;
        isInitialExportLoadRef.current = true;
        Promise.all([
            loadCardGenAsset('image', activeTournamentId),
            loadCardGenAsset('font', activeTournamentId),
            loadCardGenAsset('config', activeTournamentId),
            loadCardGenAsset('exportSettings', activeTournamentId)
        ]).then(([loadedImage, loadedFont, loadedConfig, loadedExportSettings]) => {
            const validImage = isReadableBlob(loadedImage) ? loadedImage : null;
            const validFont = isReadableBlob(loadedFont) ? loadedFont : null;
            setImageFile(validImage);
            setFontFile(validFont);
            setWizardStep(1);

            if (loadedConfig) {
                const migrated = migrateConfig(loadedConfig);
                setConfig(migrated);
                lastSavedConfigRef.current = migrated;
                setIsConfigDirty(false);
                setExportSettings(mergeExportSettings(loadedExportSettings, loadedConfig));
            } else {
                const defaultConfig = migrateConfig(DEFAULT_CONFIG);
                setConfig(defaultConfig);
                lastSavedConfigRef.current = defaultConfig;
                setIsConfigDirty(false);
                setExportSettings(mergeExportSettings(loadedExportSettings, DEFAULT_CONFIG));
            }

            if (loadedImage && !validImage) saveCardGenAsset('image', null, activeTournamentId);
            if (loadedFont && !validFont) saveCardGenAsset('font', null, activeTournamentId);

            if (validImage && validFont) {
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

    useEffect(() => {
        if (isInitialExportLoadRef.current) {
            isInitialExportLoadRef.current = false;
            return;
        }
        if (!activeTournamentId) return;
        saveCardGenAsset('exportSettings', exportSettings, activeTournamentId);
    }, [exportSettings, activeTournamentId]);

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

    const updateConfig = useCallback((updater) => {
        setConfig(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            setIsConfigDirty(JSON.stringify(lastSavedConfigRef.current) !== JSON.stringify(next));
            return next;
        });
    }, []);

    // Preview player selector
    const [previewIdx, setPreviewIdx] = useState('');

    const previewPlayer = previewIdx !== '' ? players[Number(previewIdx)] ?? null : null;

    // Load image as data URL for canvas preview
    useEffect(() => {
        if (!isReadableBlob(imageFile)) { setImageDataUrl(null); setImageSize(null); return; }
        const reader = new FileReader();
        reader.onload = e => {
            const dataUrl = e.target.result;
            setImageDataUrl(dataUrl);
            const img = new window.Image();
            img.onload = () => setImageSize({ width: img.width, height: img.height });
            img.src = dataUrl;
        };
        reader.readAsDataURL(imageFile);
    }, [imageFile]);

    // Load custom font file
    const [loadedFontFamily, setLoadedFontFamily] = useState('');
    useEffect(() => {
        if (!isReadableBlob(fontFile)) {
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
    const [showTournamentImport, setShowTournamentImport] = useState(false);
    const [selectedImportTournamentId, setSelectedImportTournamentId] = useState('');
    const [showJsonImport, setShowJsonImport] = useState(false);
    const [jsonImportText, setJsonImportText] = useState('');
    const [jsonImportError, setJsonImportError] = useState('');
    const [showJsonExport, setShowJsonExport] = useState(false);
    const [jsonCopyStatus, setJsonCopyStatus] = useState('');

    const applyImportedConfig = useCallback((data) => {
        const imported = normalizeImportedConfigData(data);
        commitHistory();
        updateConfig(imported.config);
        setExportSettings(imported.exportSettings);
    }, [commitHistory, updateConfig]);

    const handleImportConfig = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                applyImportedConfig(data);
            } catch (_) {
                showAlert('Import Failed', 'Invalid JSON config file.');
            }
        };
        reader.readAsText(file, 'utf-8');
        e.target.value = '';
    };

    const openJsonImport = () => {
        setJsonImportText('');
        setJsonImportError('');
        setShowJsonImport(true);
    };

    const handleImportJsonString = () => {
        try {
            const data = parseConfigJsonString(jsonImportText);
            applyImportedConfig(data);
            setShowJsonImport(false);
            setJsonImportText('');
            setJsonImportError('');
        } catch (error) {
            setJsonImportError(error?.message || 'Invalid JSON config string.');
        }
    };

    const handleExportConfig = () => {
        const blob = new Blob([getConfigExportJson(config, exportSettings)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: 'player-card-config.json' }).click();
        URL.revokeObjectURL(url);
    };

    const handleCopyConfigJson = async () => {
        try {
            await navigator.clipboard.writeText(getConfigExportJson(config, exportSettings));
            setJsonCopyStatus('Copied');
        } catch (_) {
            setJsonCopyStatus('Select and copy manually');
        }
    };

    const otherTournaments = tournaments.filter(t => t.id !== activeTournamentId);

    const openTournamentImport = () => {
        if (otherTournaments.length === 0) {
            showAlert('No Other Tournaments', 'Create or duplicate another tournament before importing a card config from it.');
            return;
        }
        setSelectedImportTournamentId(otherTournaments[0]?.id || '');
        setShowTournamentImport(true);
    };

    const handleImportFromTournament = async () => {
        if (!selectedImportTournamentId) return;
        const sourceConfig = await loadCardGenAsset('config', selectedImportTournamentId);
        const sourceExportSettings = await loadCardGenAsset('exportSettings', selectedImportTournamentId);
        if (!sourceConfig) {
            const tournament = tournaments.find(t => t.id === selectedImportTournamentId);
            showAlert('No Config Found', `${tournament?.name || 'The selected tournament'} does not have a saved player card config.`);
            return;
        }
        applyImportedConfig({ ...sourceConfig, exportSettings: sourceExportSettings });
        setShowTournamentImport(false);
    };

    // ── Download helpers ──────────────────────────────────────────────────────

    const [isDownloading, setIsDownloading] = useState(false);
    const [exportJob, setExportJob] = useState(null);
    const [processedCount, setProcessedCount] = useState(0);

    const prepareCardRenderContext = async () => {
        if (!imageDataUrl) return null;
        const img = await loadImageFromDataUrl(imageDataUrl);
        if (!img) return null;

        const { outW, outH } = computeDimensions(exportSettings?.scale, img.width, img.height);
        const pixelSize = { widthPx: outW, heightPx: outH };
        return {
            outW,
            outH,
            pixelSize,
            physicalSize: getCardPhysicalSize(exportSettings, pixelSize),
            templateCanvas: createScaledTemplateCanvas(img, outW, outH),
        };
    };

    const renderCardForExport = async (player, options = {}) => {
        const renderContext = options.renderContext || await prepareCardRenderContext();
        if (!renderContext) return null;

        const { outW, outH, pixelSize, physicalSize, templateCanvas } = renderContext;
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(templateCanvas, 0, 0);

        renderCardContent(ctx, outW, outH, outW, player, config, loadedFontFamily);
        applyColorModeToCanvas(canvas, options.colorMode || exportSettings?.pdf?.colorMode || 'rgb');

        const isPng = exportSettings?.outputFormat === 'png' || !exportSettings?.outputFormat;
        const format = isPng ? 'image/png' : 'image/jpeg';
        const quality = exportSettings?.quality ?? 0.9;
        const includeBlob = options.includeBlob !== false;
        const includeDataUrl = options.includeDataUrl !== false;
        const result = { canvas, pixelSize, physicalSize };

        if (includeDataUrl) {
            result.dataUrl = canvas.toDataURL(format, quality);
        }

        if (!includeBlob) return result;

        result.blob = await new Promise((resolve) => {
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    resolve(null);
                    return;
                }

                const dpiX = exportSettings?.dpi?.width || 300;
                const dpiY = exportSettings?.dpi?.height || 300;
                resolve(isPng
                    ? await injectPngDpi(blob, dpiX, dpiY)
                    : await injectJpegDpi(blob, dpiX, dpiY));
            }, format, quality);
        });

        return result;
    };

    const getExportRange = () => {
        const startIdx = Math.max(0, (parseInt(exportSettings.rangeStart) || 1) - 1);
        const endIdx = Math.min(Math.max(0, players.length - 1), (parseInt(exportSettings.rangeEnd) || players.length) - 1);
        return { startIdx, endIdx, targetPlayers: startIdx <= endIdx ? players.slice(startIdx, endIdx + 1) : [] };
    };

    const handleDownloadCurrent = async () => {
        if (!previewPlayer || isDownloading) return;
        setIsDownloading(true);
        setExportJob('current');
        try {
            const renderContext = await prepareCardRenderContext();
            const result = await renderCardForExport(previewPlayer, { includeDataUrl: false, renderContext });
            if (result?.blob) {
                const playerName = (previewPlayer?.name || 'player').replace(/\s+/g, '_');
                const ext = exportSettings?.outputFormat === 'jpg' ? 'jpg' : 'png';
                const url = URL.createObjectURL(result.blob);
                Object.assign(document.createElement('a'), {
                    href: url,
                    download: `${playerName}_card.${ext}`,
                }).click();
                URL.revokeObjectURL(url);
            }
        } catch (e) {
            console.error('Failed to generate card', e);
            showAlert('Export Failed', e?.message || 'Failed to generate this card.');
        }
        setIsDownloading(false);
        setExportJob(null);
    };

    const handleDownloadAll = async () => {
        if (!players.length || !imageDataUrl || isDownloading) return;

        const { startIdx, endIdx, targetPlayers } = getExportRange();

        if (startIdx > endIdx) {
            showAlert('Invalid Range', 'Invalid range. Check your start and end numbers.');
            return;
        }

        setIsDownloading(true);
        setExportJob('images');
        setProcessedCount(0);

        // Yield main thread to allow React to paint the 'Processing...' UI state
        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            const zip = new JSZip();
            const renderContext = await prepareCardRenderContext();
            // Process sequentially to prevent massive memory spikes and UI locking
            for (let j = 0; j < targetPlayers.length; j++) {
                const p = targetPlayers[j];
                const result = await renderCardForExport(p, { includeDataUrl: false, renderContext });
                if (result?.blob) {
                    const originalIndex = startIdx + j;
                    const id = p.playerUniqueId || p.id || String(originalIndex + 1);
                    const ext = exportSettings?.outputFormat === 'jpg' ? 'jpg' : 'png';
                    zip.file(`${id}_card.${ext}`, result.blob);
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
        setExportJob(null);
    };

    const drawCropMarks = (doc, x, y, w, h) => {
        const mark = 0.6;
        doc.setDrawColor(80);
        doc.setLineWidth(0.01);
        doc.line(x - mark, y, x - 0.05, y);
        doc.line(x, y - mark, x, y - 0.05);
        doc.line(x + w + 0.05, y, x + w + mark, y);
        doc.line(x + w, y - mark, x + w, y - 0.05);
        doc.line(x - mark, y + h, x - 0.05, y + h);
        doc.line(x, y + h + 0.05, x, y + h + mark);
        doc.line(x + w + 0.05, y + h, x + w + mark, y + h);
        doc.line(x + w, y + h + 0.05, x + w, y + h + mark);
    };

    const handleDownloadPdf = async () => {
        if (!players.length || !imageDataUrl || isDownloading) return;
        const pixelSize = getCardPixelSize(exportSettings, imageSize);
        const cardSizeCm = getCardPhysicalSize(exportSettings, pixelSize);
        const validation = validatePdfLayout(exportSettings, cardSizeCm);
        if (!validation.valid) {
            showAlert('Invalid PDF Layout', validation.message);
            return;
        }

        const { startIdx, endIdx, targetPlayers } = getExportRange();
        if (startIdx > endIdx) {
            showAlert('Invalid Range', 'Invalid range. Check your start and end numbers.');
            return;
        }

        setIsDownloading(true);
        setExportJob('pdf');
        setProcessedCount(0);
        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            const { grid } = validation;
            const doc = new jsPDF({
                unit: 'cm',
                format: [grid.page.width, grid.page.height],
                orientation: exportSettings.pdf.orientation,
                compress: true,
            });
            const imageFormat = exportSettings.outputFormat === 'jpg' ? 'JPEG' : 'PNG';
            const renderContext = await prepareCardRenderContext();

            for (let j = 0; j < targetPlayers.length; j++) {
                if (j > 0 && j % (grid.cols * grid.rows) === 0) {
                    doc.addPage([grid.page.width, grid.page.height], exportSettings.pdf.orientation);
                }

                const slot = j % (grid.cols * grid.rows);
                const col = slot % grid.cols;
                const row = Math.floor(slot / grid.cols);
                const x = grid.margin + col * (cardSizeCm.widthCm + grid.gapX);
                const y = grid.margin + row * (cardSizeCm.heightCm + grid.gapY);
                const rendered = await renderCardForExport(targetPlayers[j], {
                    colorMode: exportSettings.pdf.colorMode,
                    includeBlob: false,
                    renderContext,
                });
                if (rendered?.dataUrl) {
                    doc.addImage(rendered.dataUrl, imageFormat, x, y, cardSizeCm.widthCm, cardSizeCm.heightCm);
                    if (exportSettings.pdf.cropMarks) drawCropMarks(doc, x, y, cardSizeCm.widthCm, cardSizeCm.heightCm);
                }

                setProcessedCount(j + 1);
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            const isAll = targetPlayers.length === players.length;
            doc.save(isAll ? 'all_player_cards.pdf' : `player_cards_${startIdx + 1}_to_${endIdx + 1}.pdf`);
        } catch (e) {
            console.error('Failed to generate PDF', e);
            showAlert('PDF Export Failed', e?.message || 'Failed to generate PDF.');
        }

        setIsDownloading(false);
        setExportJob(null);
    };

    const updateConfigWithHistory = (newConfig) => {
        commitHistory();
        updateConfig(newConfig);
    };

    const pixelSize = getCardPixelSize(exportSettings, imageSize);
    const cardSizeCm = getCardPhysicalSize(exportSettings, pixelSize);
    const pdfValidation = validatePdfLayout(exportSettings, cardSizeCm);
    const computedStartIdx = Math.max(0, (parseInt(exportSettings.rangeStart) || 1) - 1);
    const computedEndIdx = Math.min(Math.max(0, players.length - 1), (parseInt(exportSettings.rangeEnd) || players.length) - 1);
    const targetCount = players.length > 0 ? Math.max(0, computedEndIdx - computedStartIdx + 1) : 0;
    const exportConfigJson = getConfigExportJson(config, exportSettings);

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

                                <Menu
                                    onSelect={({ value }) => {
                                        if (value === 'file') importConfigRef.current?.click();
                                        if (value === 'json') openJsonImport();
                                        if (value === 'tournament') openTournamentImport();
                                    }}
                                >
                                    <Menu.Trigger className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded preset-tonal cursor-pointer hover:preset-tonal-primary transition-colors">
                                        <FileUp size={13} />
                                        Import config
                                        <ChevronDown size={12} />
                                    </Menu.Trigger>
                                    <Portal>
                                        <Menu.Positioner>
                                            <Menu.Content className="card p-1 preset-filled-surface-100-900 shadow-lg min-w-48 z-[70]">
                                                <Menu.Item value="file" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                    <Menu.ItemText className="flex items-center gap-2">
                                                        <FileUp size={13} />
                                                        From file
                                                    </Menu.ItemText>
                                                </Menu.Item>
                                                <Menu.Item value="json" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                    <Menu.ItemText className="flex items-center gap-2">
                                                        <FileText size={13} />
                                                        Paste JSON
                                                    </Menu.ItemText>
                                                </Menu.Item>
                                                <Menu.Item value="tournament" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                    <Menu.ItemText className="flex items-center gap-2">
                                                        <Database size={13} />
                                                        From other tournament
                                                    </Menu.ItemText>
                                                </Menu.Item>
                                            </Menu.Content>
                                        </Menu.Positioner>
                                    </Portal>
                                </Menu>
                                <input
                                    ref={importConfigRef}
                                    type="file"
                                    accept=".json"
                                    className="hidden"
                                    onChange={handleImportConfig}
                                />
                                <Menu
                                    onSelect={({ value }) => {
                                        if (value === 'json') {
                                            setJsonCopyStatus('');
                                            setShowJsonExport(true);
                                        }
                                        if (value === 'file') handleExportConfig();
                                    }}
                                >
                                    <Menu.Trigger className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded preset-tonal cursor-pointer hover:preset-tonal-primary transition-colors">
                                        <FileDown size={13} />
                                        Export config
                                        <ChevronDown size={12} />
                                    </Menu.Trigger>
                                    <Portal>
                                        <Menu.Positioner>
                                            <Menu.Content className="card p-1 preset-filled-surface-100-900 shadow-lg min-w-48 z-[70]">
                                                <Menu.Item value="json" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                    <Menu.ItemText className="flex items-center gap-2">
                                                        <Copy size={13} />
                                                        Copy JSON
                                                    </Menu.ItemText>
                                                </Menu.Item>
                                                <Menu.Item value="file" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                                    <Menu.ItemText className="flex items-center gap-2">
                                                        <FileDown size={13} />
                                                        To file
                                                    </Menu.ItemText>
                                                </Menu.Item>
                                            </Menu.Content>
                                        </Menu.Positioner>
                                    </Portal>
                                </Menu>
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

                        <div className="px-5 py-2 border-b border-surface-200-800 flex items-center gap-4 shrink-0">
                            <Steps
                                count={2}
                                step={wizardStep - 1}
                                className="flex-1 min-w-0"
                            >
                                <Steps.List className="flex items-center gap-2">
                                    <Steps.Item index={0} className="flex items-center gap-2">
                                        <Steps.Trigger
                                            disabled
                                            tabIndex={-1}
                                            className={`flex items-center gap-2 px-1 py-1 text-sm transition-colors pointer-events-none ${wizardStep === 1 ? 'text-primary-500 font-semibold' : 'text-surface-500-400 opacity-70'}`}
                                        >
                                            <Steps.Indicator className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white text-[11px] font-mono">
                                                1
                                            </Steps.Indicator>
                                            <span>Configure cards</span>
                                        </Steps.Trigger>
                                        <Steps.Separator className="h-px w-8 bg-surface-300-700" />
                                    </Steps.Item>
                                    <Steps.Item index={1} className="flex items-center gap-2">
                                        <Steps.Trigger
                                            disabled
                                            tabIndex={-1}
                                            className={`flex items-center gap-2 px-1 py-1 text-sm transition-colors pointer-events-none ${wizardStep === 2 ? 'text-primary-500 font-semibold' : 'text-surface-500-400 opacity-70'}`}
                                        >
                                            <Steps.Indicator className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white text-[11px] font-mono">
                                                2
                                            </Steps.Indicator>
                                            <span>Export file</span>
                                        </Steps.Trigger>
                                    </Steps.Item>
                                </Steps.List>
                            </Steps>
                            <div className="ml-auto text-xs text-surface-500-400">
                                {cardSizeCm ? `Output: ${formatCm(cardSizeCm.widthCm)} x ${formatCm(cardSizeCm.heightCm)}` : 'Upload a template to calculate output size'}
                            </div>
                        </div>

                        {/* Body: preview | settings */}
                        <div className="flex flex-1 min-h-0 overflow-hidden">
                            {/* ── Left: Preview ── */}
                            <div className="flex-1 flex flex-col gap-2 p-4 border-r border-surface-200-800 min-w-0 overflow-hidden">
                                <div className="flex-1 min-h-0 flex items-center justify-center">
                                    <CardPreview
                                        imageDataUrl={imageDataUrl}
                                        config={config}
                                        exportSettings={exportSettings}
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
                            <div className={`${wizardStep === 1 ? 'w-80' : 'w-[440px]'} flex flex-col shrink-0`}>

                                {wizardStep === 1 ? (
                                    <div className="flex flex-col h-full bg-surface-100-900 overflow-y-auto">
                                        <ConfigEditor
                                            config={config}
                                            exportSettings={exportSettings}
                                            onUpdate={updateConfigWithHistory}
                                            onUpdateExportSettings={setExportSettings}
                                            showConfirm={showConfirm}
                                            cardSizeCm={cardSizeCm}
                                        />
                                    </div>
                                ) : (
                                    <ExportSettingsEditor
                                        exportSettings={exportSettings}
                                        onUpdate={setExportSettings}
                                        cardSizeCm={cardSizeCm}
                                        pixelSize={pixelSize}
                                        pdfValidation={pdfValidation}
                                    />
                                )}

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
                                                {`(${p.playerUniqueId}) ${p.name}` || `Player ${p.playerUniqueId}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-200-800 shrink-0">
                            <button
                                className="mr-auto flex items-center gap-1.5 text-sm px-4 py-1.5 rounded preset-tonal cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                onClick={() => setWizardStep(1)}
                                disabled={wizardStep === 1 || isDownloading}
                            >
                                Back
                            </button>
                            {wizardStep !== 2 && (
                                <button
                                    className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded preset-tonal cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    onClick={() => setWizardStep(2)}
                                    disabled={!imageDataUrl || isDownloading}
                                >
                                    Next: Export
                                </button>
                            )}
                            {wizardStep === 2 && (
                                <>
                                    <button
                                        className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded preset-tonal cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                        onClick={handleDownloadCurrent}
                                        disabled={!previewPlayer || !cardSizeCm || isDownloading}
                                        title={!previewPlayer ? 'Select a player to preview first' : ''}
                                    >
                                        <Download size={14} />
                                        {exportJob === 'current' ? 'Processing...' : 'Current image'}
                                    </button>
                                    <button
                                        className={`relative overflow-hidden flex items-center justify-center gap-1.5 text-sm px-4 py-1.5 rounded transition-all min-w-[170px] ${isDownloading && exportJob === 'pdf'
                                            ? 'preset-filled cursor-wait'
                                            : 'preset-filled cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                                        }`}
                                        onClick={handleDownloadPdf}
                                        disabled={!players.length || isDownloading || !pdfValidation.valid}
                                    >
                                        {exportJob === 'pdf' && (
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
                                        <FileText size={14} className="relative z-10" />
                                        <span className={`relative z-10 ${exportJob === 'pdf' ? 'animate-pulse tracking-wide font-medium' : ''}`}>
                                            {exportJob === 'pdf' && processedCount > 0 ? `PDF (${processedCount}/${targetCount})` : 'Export PDF'}
                                        </span>
                                    </button>
                                    <button
                                        className={`relative overflow-hidden flex items-center justify-center gap-1.5 text-sm px-4 py-1.5 rounded transition-all min-w-[170px] ${isDownloading && exportJob === 'images'
                                            ? 'preset-filled cursor-wait'
                                            : 'preset-filled cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                                        }`}
                                        onClick={handleDownloadAll}
                                        disabled={!players.length || !cardSizeCm || isDownloading}
                                    >
                                        {exportJob === 'images' && (
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
                                        {exportJob === 'images' ? (
                                            <span className="animate-pulse tracking-wide font-medium relative z-10">
                                                {processedCount > 0 ? `Processing (${processedCount}/${targetCount})` : 'Processing...'}
                                            </span>
                                        ) : (
                                            <>
                                                <Download size={14} className="relative z-10" />
                                                <span className="relative z-10">Export images ZIP</span>
                                            </>
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

            </Portal>
            {showJsonImport && (
                <Portal>
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[120]"
                        onClick={() => setShowJsonImport(false)}
                    />
                    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
                        <div
                            className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-2xl space-y-4 shadow-xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <div>
                                <h3 className="text-base font-semibold">Import config JSON</h3>
                                <p className="text-sm text-surface-600-400 mt-1">
                                    Paste a player card config JSON string.
                                </p>
                            </div>
                            <textarea
                                className="w-full min-h-72 font-mono text-xs bg-surface-50-950 border border-surface-200-800 rounded px-3 py-2 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-y"
                                value={jsonImportText}
                                onChange={e => {
                                    setJsonImportText(e.target.value);
                                    if (jsonImportError) setJsonImportError('');
                                }}
                                placeholder='{"layers":[...],"exportSettings":{...}}'
                                spellCheck={false}
                                autoFocus
                            />
                            {jsonImportError && (
                                <div className="text-sm text-error-500 bg-error-500/10 border border-error-500/20 rounded px-3 py-2">
                                    {jsonImportError}
                                </div>
                            )}
                            <div className="flex justify-end gap-2">
                                <button
                                    className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer"
                                    onClick={() => setShowJsonImport(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="px-4 py-1.5 text-sm rounded bg-primary-500 hover:bg-primary-600 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={handleImportJsonString}
                                    disabled={!jsonImportText.trim()}
                                >
                                    Import
                                </button>
                            </div>
                        </div>
                    </div>
                </Portal>
            )}
            {showJsonExport && (
                <Portal>
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[120]"
                        onClick={() => setShowJsonExport(false)}
                    />
                    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
                        <div
                            className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-2xl space-y-4 shadow-xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="text-base font-semibold">Export config JSON</h3>
                                    <p className="text-sm text-surface-600-400 mt-1">
                                        Copy this player card config JSON string.
                                    </p>
                                </div>
                                {jsonCopyStatus && (
                                    <span className="text-xs rounded preset-tonal px-2 py-1 shrink-0">
                                        {jsonCopyStatus}
                                    </span>
                                )}
                            </div>
                            <textarea
                                className="w-full min-h-72 font-mono text-xs bg-surface-50-950 border border-surface-200-800 rounded px-3 py-2 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-y"
                                value={exportConfigJson}
                                readOnly
                                spellCheck={false}
                                onFocus={e => e.target.select()}
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer"
                                    onClick={() => setShowJsonExport(false)}
                                >
                                    Close
                                </button>
                                <button
                                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-primary-500 hover:bg-primary-600 text-white transition-colors cursor-pointer"
                                    onClick={handleCopyConfigJson}
                                >
                                    <Copy size={14} />
                                    Copy JSON
                                </button>
                            </div>
                        </div>
                    </div>
                </Portal>
            )}
            {showTournamentImport && (
                <Portal>
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[120]"
                        onClick={() => setShowTournamentImport(false)}
                    />
                    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
                        <div
                            className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-md space-y-4 shadow-xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <div>
                                <h3 className="text-base font-semibold">Import config from tournament</h3>
                                <p className="text-sm text-surface-600-400 mt-1">
                                    Choose another tournament with a saved player card config.
                                </p>
                            </div>
                            <select
                                className="w-full text-sm bg-surface-100-900 border border-surface-200-800 rounded px-3 py-2 outline-none cursor-pointer"
                                value={selectedImportTournamentId}
                                onChange={e => setSelectedImportTournamentId(e.target.value)}
                            >
                                {otherTournaments.map(tournament => (
                                    <option key={tournament.id} value={tournament.id}>
                                        {tournament.name}
                                    </option>
                                ))}
                            </select>
                            <div className="flex justify-end gap-2">
                                <button
                                    className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer"
                                    onClick={() => setShowTournamentImport(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="px-4 py-1.5 text-sm rounded bg-primary-500 hover:bg-primary-600 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={handleImportFromTournament}
                                    disabled={!selectedImportTournamentId}
                                >
                                    Import
                                </button>
                            </div>
                        </div>
                    </div>
                </Portal>
            )}
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
