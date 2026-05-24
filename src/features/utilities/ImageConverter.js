"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
    Archive,
    CheckCircle2,
    Download,
    FileImage,
    Image as ImageIcon,
    Loader2,
    RefreshCw,
    Trash2,
    Upload,
    XCircle
} from 'lucide-react';

const FORMAT_OPTIONS = [
    { value: 'image/png', label: 'PNG', ext: 'png', quality: false },
    { value: 'image/jpeg', label: 'JPEG', ext: 'jpg', quality: true },
    { value: 'image/webp', label: 'WebP', ext: 'webp', quality: true },
    { value: 'image/avif', label: 'AVIF', ext: 'avif', quality: true, advanced: true },
];

const RESIZE_MODES = [
    { value: 'original', label: 'Original' },
    { value: 'exact', label: 'Exact' },
    { value: 'fit', label: 'Fit' },
    { value: 'cover', label: 'Cover' },
    { value: 'pad', label: 'Pad' },
];

const RATIO_PRESETS = [
    { value: 'original', label: 'Original' },
    { value: '1:1', label: '1:1' },
    { value: '4:3', label: '4:3' },
    { value: '3:2', label: '3:2' },
    { value: '16:9', label: '16:9' },
    { value: '2:3', label: '2:3' },
    { value: '9:16', label: '9:16' },
    { value: 'custom', label: 'Custom' },
];

const WATERMARK_ANCHORS = [
    { value: 'top-left', label: 'Top left', shortLabel: 'TL' },
    { value: 'top-center', label: 'Top center', shortLabel: 'T' },
    { value: 'top-right', label: 'Top right', shortLabel: 'TR' },
    { value: 'middle-left', label: 'Middle left', shortLabel: 'L' },
    { value: 'middle-center', label: 'Center', shortLabel: 'C' },
    { value: 'middle-right', label: 'Middle right', shortLabel: 'R' },
    { value: 'bottom-left', label: 'Bottom left', shortLabel: 'BL' },
    { value: 'bottom-center', label: 'Bottom center', shortLabel: 'B' },
    { value: 'bottom-right', label: 'Bottom right', shortLabel: 'BR' },
];

const DEFAULT_SETTINGS = {
    outputType: 'image/png',
    quality: 0.9,
    resizeMode: 'original',
    targetWidth: 1200,
    targetHeight: 1200,
    ratioPreset: 'original',
    customRatioWidth: 1,
    customRatioHeight: 1,
    backgroundColor: '#ffffff',
};

const DEFAULT_WATERMARK = {
    enabled: false,
    file: null,
    sourceUrl: null,
    naturalWidth: null,
    naturalHeight: null,
    opacity: 0.6,
    sizeMode: 'relative',
    relativeWidth: 20,
    absoluteWidth: 240,
    offsetMode: 'relative',
    offsetX: 3,
    offsetY: 3,
    anchor: 'bottom-right',
};

const MAX_CANVAS_PIXELS = 80_000_000;

function createId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDimensions(width, height) {
    return width && height ? `${width}x${height}` : '-';
}

function isHeicFile(file) {
    return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

function isImageFile(file) {
    return file.type.startsWith('image/') || isHeicFile(file);
}

function getBaseName(fileName) {
    const withoutPath = String(fileName || 'image').split(/[\\/]/).pop();
    return withoutPath.replace(/\.[^.]+$/, '') || 'image';
}

function getFormatMeta(mimeType) {
    return FORMAT_OPTIONS.find(option => option.value === mimeType) || FORMAT_OPTIONS[0];
}

function makeOutputName(fileName, mimeType) {
    const meta = getFormatMeta(mimeType);
    return `${getBaseName(fileName)}.${meta.ext}`;
}

function getNumericValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getFiniteValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clampValue(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function parseRatioValue(value) {
    if (!value || !value.includes(':')) return null;
    const [width, height] = value.split(':').map(Number);
    return width > 0 && height > 0 ? width / height : null;
}

function getRequestedRatio(settings, imageWidth, imageHeight) {
    if (settings.ratioPreset === 'original') return imageWidth / imageHeight;
    if (settings.ratioPreset === 'custom') {
        const width = getNumericValue(settings.customRatioWidth, 1);
        const height = getNumericValue(settings.customRatioHeight, 1);
        return width / height;
    }
    return parseRatioValue(settings.ratioPreset) || (imageWidth / imageHeight);
}

function getCanvasPlan(imageWidth, imageHeight, settings) {
    const mode = settings.resizeMode;
    const width = getNumericValue(settings.targetWidth, imageWidth);
    const height = getNumericValue(settings.targetHeight, imageHeight);

    if (mode === 'original') {
        return {
            canvasWidth: imageWidth,
            canvasHeight: imageHeight,
            sourceX: 0,
            sourceY: 0,
            sourceWidth: imageWidth,
            sourceHeight: imageHeight,
            drawX: 0,
            drawY: 0,
            drawWidth: imageWidth,
            drawHeight: imageHeight,
        };
    }

    if (mode === 'exact') {
        return {
            canvasWidth: Math.round(width),
            canvasHeight: Math.round(height),
            sourceX: 0,
            sourceY: 0,
            sourceWidth: imageWidth,
            sourceHeight: imageHeight,
            drawX: 0,
            drawY: 0,
            drawWidth: Math.round(width),
            drawHeight: Math.round(height),
        };
    }

    if (mode === 'fit') {
        const scale = Math.min(width / imageWidth, height / imageHeight);
        const drawWidth = Math.max(1, Math.round(imageWidth * scale));
        const drawHeight = Math.max(1, Math.round(imageHeight * scale));
        return {
            canvasWidth: drawWidth,
            canvasHeight: drawHeight,
            sourceX: 0,
            sourceY: 0,
            sourceWidth: imageWidth,
            sourceHeight: imageHeight,
            drawX: 0,
            drawY: 0,
            drawWidth,
            drawHeight,
        };
    }

    const canvasWidth = Math.round(width);
    const canvasHeight = Math.round(height);

    if (mode === 'cover') {
        const targetRatio = canvasWidth / canvasHeight;
        const imageRatio = imageWidth / imageHeight;
        let sourceX = 0;
        let sourceY = 0;
        let sourceWidth = imageWidth;
        let sourceHeight = imageHeight;

        if (imageRatio > targetRatio) {
            sourceWidth = imageHeight * targetRatio;
            sourceX = (imageWidth - sourceWidth) / 2;
        } else {
            sourceHeight = imageWidth / targetRatio;
            sourceY = (imageHeight - sourceHeight) / 2;
        }

        return {
            canvasWidth,
            canvasHeight,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            drawX: 0,
            drawY: 0,
            drawWidth: canvasWidth,
            drawHeight: canvasHeight,
        };
    }

    const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
    const drawWidth = Math.max(1, Math.round(imageWidth * scale));
    const drawHeight = Math.max(1, Math.round(imageHeight * scale));

    return {
        canvasWidth,
        canvasHeight,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: imageWidth,
        sourceHeight: imageHeight,
        drawX: Math.round((canvasWidth - drawWidth) / 2),
        drawY: Math.round((canvasHeight - drawHeight) / 2),
        drawWidth,
        drawHeight,
    };
}

function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not decode this image.'));
        image.src = url;
    });
}

async function drawWatermark(ctx, canvas, watermark) {
    if (!watermark.enabled || !watermark.sourceUrl || !watermark.naturalWidth || !watermark.naturalHeight) {
        return;
    }

    const image = await loadImageFromUrl(watermark.sourceUrl);
    const requestedWidth = watermark.sizeMode === 'absolute'
        ? getNumericValue(watermark.absoluteWidth, DEFAULT_WATERMARK.absoluteWidth)
        : canvas.width * (getNumericValue(watermark.relativeWidth, DEFAULT_WATERMARK.relativeWidth) / 100);
    let drawWidth = Math.max(1, Math.min(canvas.width, Math.round(requestedWidth)));
    let drawHeight = Math.max(1, Math.round(drawWidth * (watermark.naturalHeight / watermark.naturalWidth)));

    if (drawHeight > canvas.height) {
        const scale = canvas.height / drawHeight;
        drawWidth = Math.max(1, Math.round(drawWidth * scale));
        drawHeight = canvas.height;
    }

    const offsetX = watermark.offsetMode === 'absolute'
        ? getFiniteValue(watermark.offsetX, 0)
        : canvas.width * (getFiniteValue(watermark.offsetX, 0) / 100);
    const offsetY = watermark.offsetMode === 'absolute'
        ? getFiniteValue(watermark.offsetY, 0)
        : canvas.height * (getFiniteValue(watermark.offsetY, 0) / 100);
    const [verticalAnchor, horizontalAnchor] = String(watermark.anchor || DEFAULT_WATERMARK.anchor).split('-');

    let drawX = offsetX;
    if (horizontalAnchor === 'center') {
        drawX = ((canvas.width - drawWidth) / 2) + offsetX;
    } else if (horizontalAnchor === 'right') {
        drawX = canvas.width - drawWidth - offsetX;
    }

    let drawY = offsetY;
    if (verticalAnchor === 'middle') {
        drawY = ((canvas.height - drawHeight) / 2) + offsetY;
    } else if (verticalAnchor === 'bottom') {
        drawY = canvas.height - drawHeight - offsetY;
    }

    const previousAlpha = ctx.globalAlpha;
    ctx.globalAlpha = clampValue(getFiniteValue(watermark.opacity, DEFAULT_WATERMARK.opacity), 0, 1);
    try {
        ctx.drawImage(
            image,
            Math.round(clampValue(drawX, 0, canvas.width - drawWidth)),
            Math.round(clampValue(drawY, 0, canvas.height - drawHeight)),
            drawWidth,
            drawHeight
        );
    } finally {
        ctx.globalAlpha = previousAlpha;
    }
}

function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('This browser could not export the selected format.'));
                return;
            }
            if (mimeType !== 'image/png' && blob.type && blob.type !== mimeType) {
                reject(new Error(`${getFormatMeta(mimeType).label} export is not supported by this browser.`));
                return;
            }
            resolve(blob);
        }, mimeType, quality);
    });
}

function downloadBlobUrl(url, fileName) {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
}

function uniqueZipName(fileName, usedNames) {
    if (!usedNames.has(fileName)) {
        usedNames.add(fileName);
        return fileName;
    }

    const dotIndex = fileName.lastIndexOf('.');
    const base = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
    const ext = dotIndex >= 0 ? fileName.slice(dotIndex) : '';
    let index = 2;
    let next = `${base}-${index}${ext}`;

    while (usedNames.has(next)) {
        index += 1;
        next = `${base}-${index}${ext}`;
    }

    usedNames.add(next);
    return next;
}

function StatusPill({ item }) {
    if (item.status === 'processing' || item.status === 'inspecting') {
        return (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-blue-500">
                <Loader2 size={11} className="animate-spin" />
                {item.status === 'inspecting' ? 'Reading' : 'Converting'}
            </span>
        );
    }

    if (item.status === 'converted') {
        return (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-green-500">
                <CheckCircle2 size={11} />
                Ready
            </span>
        );
    }

    if (item.status === 'error') {
        return (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-red-500">
                <XCircle size={11} />
                Failed
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-surface-500">
            <FileImage size={11} />
            Queued
        </span>
    );
}

export default function ImageConverter() {
    const [items, setItems] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [watermark, setWatermark] = useState(DEFAULT_WATERMARK);
    const [isDragging, setIsDragging] = useState(false);
    const [isConvertingAll, setIsConvertingAll] = useState(false);
    const [avifSupported, setAvifSupported] = useState(false);
    const itemsRef = useRef(items);
    const watermarkRef = useRef(watermark);
    const inputRef = useRef(null);
    const watermarkInputRef = useRef(null);

    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    useEffect(() => {
        watermarkRef.current = watermark;
    }, [watermark]);

    useEffect(() => {
        let cancelled = false;
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        canvas.toBlob((blob) => {
            if (!cancelled) setAvifSupported(blob?.type === 'image/avif');
        }, 'image/avif', 0.8);
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        return () => {
            itemsRef.current.forEach((item) => {
                if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
                if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
            });
        };
    }, []);

    useEffect(() => {
        return () => {
            if (watermarkRef.current.sourceUrl) URL.revokeObjectURL(watermarkRef.current.sourceUrl);
        };
    }, []);

    const outputFormats = useMemo(() => {
        return FORMAT_OPTIONS.filter(option => option.value !== 'image/avif' || avifSupported);
    }, [avifSupported]);

    const activeItem = useMemo(() => {
        return items.find(item => item.id === activeId) || items[0] || null;
    }, [activeId, items]);

    const convertedItems = useMemo(() => {
        return items.filter(item => item.resultBlob && item.resultName);
    }, [items]);

    const shouldShowQuality = getFormatMeta(settings.outputType).quality;
    const shouldShowRatio = settings.resizeMode === 'cover' || settings.resizeMode === 'pad';

    const updateItem = useCallback((id, updater) => {
        setItems(prev => prev.map(item => {
            if (item.id !== id) return item;
            return typeof updater === 'function' ? updater(item) : { ...item, ...updater };
        }));
    }, []);

    const prepareItemSource = useCallback(async (item) => {
        const latest = itemsRef.current.find(candidate => candidate.id === item.id) || item;
        if (latest.sourceUrl && latest.originalWidth && latest.originalHeight) {
            const image = await loadImageFromUrl(latest.sourceUrl);
            return { image, width: latest.originalWidth, height: latest.originalHeight, sourceUrl: latest.sourceUrl };
        }

        let renderBlob = latest.renderBlob || latest.file;

        if (isHeicFile(latest.file) && !latest.renderBlob) {
            const heic2any = (await import('heic2any')).default;
            const converted = await heic2any({ blob: latest.file, toType: 'image/png' });
            renderBlob = Array.isArray(converted) ? converted[0] : converted;
        }

        const sourceUrl = URL.createObjectURL(renderBlob);
        const image = await loadImageFromUrl(sourceUrl);
        const previousSourceUrl = latest.sourceUrl;

        updateItem(latest.id, current => ({
            ...current,
            renderBlob,
            sourceUrl,
            originalWidth: image.naturalWidth,
            originalHeight: image.naturalHeight,
            status: current.status === 'inspecting' ? 'ready' : current.status,
            error: null,
        }));

        if (previousSourceUrl && previousSourceUrl !== sourceUrl) {
            URL.revokeObjectURL(previousSourceUrl);
        }

        return {
            image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            sourceUrl,
        };
    }, [updateItem]);

    const inspectItem = useCallback(async (item) => {
        updateItem(item.id, { status: 'inspecting', error: null });
        try {
            await prepareItemSource(item);
        } catch (error) {
            updateItem(item.id, {
                status: 'error',
                error: error.message || 'Could not read this image.',
            });
        }
    }, [prepareItemSource, updateItem]);

    const addFiles = useCallback((fileList) => {
        const nextItems = Array.from(fileList || [])
            .filter(isImageFile)
            .map(file => ({
                id: createId(),
                file,
                name: file.name,
                inputType: file.type || (isHeicFile(file) ? 'image/heic' : 'image/*'),
                inputSize: file.size,
                status: 'ready',
                error: null,
                originalWidth: null,
                originalHeight: null,
                resultWidth: null,
                resultHeight: null,
                resultBlob: null,
                resultUrl: null,
                resultName: null,
                resultType: null,
                resultSize: null,
                sourceUrl: null,
                renderBlob: null,
            }));

        if (!nextItems.length) return;

        setItems(prev => [...prev, ...nextItems]);
        setActiveId(prev => prev || nextItems[0].id);
        nextItems.forEach(item => {
            void inspectItem(item);
        });
    }, [inspectItem]);

    const removeItem = useCallback((id) => {
        const target = itemsRef.current.find(item => item.id === id);
        if (target?.sourceUrl) URL.revokeObjectURL(target.sourceUrl);
        if (target?.resultUrl) URL.revokeObjectURL(target.resultUrl);

        const nextItems = itemsRef.current.filter(item => item.id !== id);
        setItems(nextItems);
        if (activeId === id) setActiveId(nextItems[0]?.id || null);
    }, [activeId]);

    const clearItems = useCallback(() => {
        itemsRef.current.forEach((item) => {
            if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
            if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        });
        setItems([]);
        setActiveId(null);
    }, []);

    const updateWatermark = useCallback((patch) => {
        setWatermark(prev => ({ ...prev, ...patch }));
    }, []);

    const loadWatermarkFile = useCallback(async (file) => {
        if (!file || !isImageFile(file)) return;

        let sourceUrl = null;
        try {
            let renderBlob = file;
            if (isHeicFile(file)) {
                const heic2any = (await import('heic2any')).default;
                const converted = await heic2any({ blob: file, toType: 'image/png' });
                renderBlob = Array.isArray(converted) ? converted[0] : converted;
            }

            sourceUrl = URL.createObjectURL(renderBlob);
            const image = await loadImageFromUrl(sourceUrl);
            setWatermark(prev => {
                if (prev.sourceUrl) URL.revokeObjectURL(prev.sourceUrl);
                return {
                    ...prev,
                    enabled: true,
                    file,
                    sourceUrl,
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                };
            });
        } catch {
            if (sourceUrl) URL.revokeObjectURL(sourceUrl);
        }
    }, []);

    const removeWatermark = useCallback(() => {
        setWatermark(prev => {
            if (prev.sourceUrl) URL.revokeObjectURL(prev.sourceUrl);
            return DEFAULT_WATERMARK;
        });
        if (watermarkInputRef.current) {
            watermarkInputRef.current.value = '';
        }
    }, []);

    const convertItem = useCallback(async (id) => {
        const item = itemsRef.current.find(candidate => candidate.id === id);
        if (!item) return null;

        const previousResultUrl = item.resultUrl;
        updateItem(id, {
            status: 'processing',
            error: null,
            resultBlob: null,
            resultUrl: null,
            resultName: null,
            resultType: null,
            resultSize: null,
        });
        if (previousResultUrl) URL.revokeObjectURL(previousResultUrl);

        try {
            const prepared = await prepareItemSource(item);
            const canvasPlan = getCanvasPlan(prepared.width, prepared.height, settings);

            if (canvasPlan.canvasWidth * canvasPlan.canvasHeight > MAX_CANVAS_PIXELS) {
                throw new Error('Output is too large for browser canvas export.');
            }

            const canvas = document.createElement('canvas');
            canvas.width = canvasPlan.canvasWidth;
            canvas.height = canvasPlan.canvasHeight;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                throw new Error('Canvas rendering is unavailable in this browser.');
            }

            if (settings.outputType === 'image/jpeg' || settings.resizeMode === 'pad') {
                ctx.fillStyle = settings.backgroundColor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            ctx.drawImage(
                prepared.image,
                canvasPlan.sourceX,
                canvasPlan.sourceY,
                canvasPlan.sourceWidth,
                canvasPlan.sourceHeight,
                canvasPlan.drawX,
                canvasPlan.drawY,
                canvasPlan.drawWidth,
                canvasPlan.drawHeight
            );

            await drawWatermark(ctx, canvas, watermark);

            const blob = await canvasToBlob(
                canvas,
                settings.outputType,
                shouldShowQuality ? settings.quality : undefined
            );
            const resultUrl = URL.createObjectURL(blob);
            const resultName = makeOutputName(item.name, settings.outputType);
            const result = {
                status: 'converted',
                resultBlob: blob,
                resultUrl,
                resultName,
                resultType: blob.type || settings.outputType,
                resultSize: blob.size,
                resultWidth: canvas.width,
                resultHeight: canvas.height,
                originalWidth: prepared.width,
                originalHeight: prepared.height,
                error: null,
            };

            updateItem(id, result);
            return { ...item, ...result };
        } catch (error) {
            updateItem(id, {
                status: 'error',
                error: error.message || 'Conversion failed.',
            });
            return null;
        }
    }, [prepareItemSource, settings, shouldShowQuality, updateItem, watermark]);

    const convertActive = useCallback(async () => {
        if (!activeItem) return;
        await convertItem(activeItem.id);
    }, [activeItem, convertItem]);

    const convertAll = useCallback(async () => {
        if (!itemsRef.current.length) return;
        setIsConvertingAll(true);
        const ids = itemsRef.current.map(item => item.id);
        for (const id of ids) {
            await convertItem(id);
        }
        setIsConvertingAll(false);
    }, [convertItem]);

    const downloadActive = useCallback(() => {
        if (!activeItem?.resultUrl || !activeItem.resultName) return;
        downloadBlobUrl(activeItem.resultUrl, activeItem.resultName);
    }, [activeItem]);

    const downloadAll = useCallback(async () => {
        const readyItems = itemsRef.current.filter(item => item.resultBlob && item.resultName);
        if (!readyItems.length) return;

        const zip = new JSZip();
        const usedNames = new Set();
        readyItems.forEach((item) => {
            zip.file(uniqueZipName(item.resultName, usedNames), item.resultBlob);
        });

        const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
        });
        const url = URL.createObjectURL(blob);
        downloadBlobUrl(url, 'converted-images.zip');
        URL.revokeObjectURL(url);
    }, []);

    const updateRatioPreset = (value) => {
        setSettings(prev => {
            const ratio = value === 'custom'
                ? getNumericValue(prev.customRatioWidth, 1) / getNumericValue(prev.customRatioHeight, 1)
                : value === 'original' && activeItem?.originalWidth && activeItem?.originalHeight
                    ? activeItem.originalWidth / activeItem.originalHeight
                    : parseRatioValue(value);

            if (!ratio || (prev.resizeMode !== 'cover' && prev.resizeMode !== 'pad')) {
                return { ...prev, ratioPreset: value };
            }

            return {
                ...prev,
                ratioPreset: value,
                targetHeight: Math.max(1, Math.round(getNumericValue(prev.targetWidth, 1200) / ratio)),
            };
        });
    };

    const updateTargetWidth = (value) => {
        setSettings(prev => {
            const nextWidth = getNumericValue(value, 1);
            if (prev.resizeMode !== 'cover' && prev.resizeMode !== 'pad') {
                return { ...prev, targetWidth: value };
            }

            const ratio = activeItem?.originalWidth && activeItem?.originalHeight
                ? getRequestedRatio(prev, activeItem.originalWidth, activeItem.originalHeight)
                : getRequestedRatio(prev, 1, 1);

            return {
                ...prev,
                targetWidth: value,
                targetHeight: Math.max(1, Math.round(nextWidth / ratio)),
            };
        });
    };

    const updateCustomRatio = (field, value) => {
        setSettings(prev => {
            const next = { ...prev, [field]: value };
            if ((prev.resizeMode !== 'cover' && prev.resizeMode !== 'pad') || prev.ratioPreset !== 'custom') {
                return next;
            }

            const ratio = getNumericValue(next.customRatioWidth, 1) / getNumericValue(next.customRatioHeight, 1);
            return {
                ...next,
                targetHeight: Math.max(1, Math.round(getNumericValue(next.targetWidth, 1200) / ratio)),
            };
        });
    };

    const handleDrop = (event) => {
        event.preventDefault();
        setIsDragging(false);
        addFiles(event.dataTransfer.files);
    };

    const selectedFormat = getFormatMeta(settings.outputType);
    const hasWatermark = Boolean(watermark.sourceUrl);

    return (
        <div className="space-y-6">
            <div
                className={`border border-dashed rounded-xl p-6 bg-surface-100-900 transition-colors ${isDragging ? 'border-primary-500 bg-primary-500/5' : 'border-surface-300-700'}`}
                onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
            >
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-primary-500/10 text-primary-500 flex items-center justify-center">
                            <Upload size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-surface-900-100">Image converter</h3>
                            <p className="text-sm text-surface-500 mt-1">Drop images here, including HEIC/HEIF, or choose files.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            className="px-4 py-2 rounded-lg preset-filled text-sm font-bold inline-flex items-center gap-2"
                        >
                            <Upload size={16} />
                            Add Images
                        </button>
                        {items.length > 0 && (
                            <button
                                type="button"
                                onClick={clearItems}
                                className="px-4 py-2 rounded-lg preset-tonal text-sm font-bold inline-flex items-center gap-2"
                            >
                                <Trash2 size={16} />
                                Clear
                            </button>
                        )}
                    </div>
                </div>
                <input
                    ref={inputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,.heic,.heif"
                    multiple
                    onChange={(event) => {
                        addFiles(event.target.files);
                        event.target.value = '';
                    }}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Format</span>
                            <select
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full cursor-pointer"
                                value={settings.outputType}
                                onChange={(event) => setSettings(prev => ({ ...prev, outputType: event.target.value }))}
                            >
                                {outputFormats.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Resize Mode</span>
                            <select
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full cursor-pointer"
                                value={settings.resizeMode}
                                onChange={(event) => setSettings(prev => {
                                    const nextMode = event.target.value;
                                    if (nextMode !== 'cover' && nextMode !== 'pad') {
                                        return { ...prev, resizeMode: nextMode };
                                    }

                                    const ratio = activeItem?.originalWidth && activeItem?.originalHeight
                                        ? getRequestedRatio(prev, activeItem.originalWidth, activeItem.originalHeight)
                                        : getRequestedRatio(prev, 1, 1);

                                    return {
                                        ...prev,
                                        resizeMode: nextMode,
                                        targetHeight: Math.max(1, Math.round(getNumericValue(prev.targetWidth, 1200) / ratio)),
                                    };
                                })}
                            >
                                {RESIZE_MODES.map(mode => (
                                    <option key={mode.value} value={mode.value}>{mode.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Width</span>
                            <input
                                type="number"
                                min="1"
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full"
                                value={settings.targetWidth}
                                disabled={settings.resizeMode === 'original'}
                                onChange={(event) => updateTargetWidth(event.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Height</span>
                            <input
                                type="number"
                                min="1"
                                className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full"
                                value={settings.targetHeight}
                                disabled={settings.resizeMode === 'original'}
                                onChange={(event) => setSettings(prev => ({ ...prev, targetHeight: event.target.value }))}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {shouldShowQuality && (
                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Quality</span>
                                    <span className="text-[10px] font-mono font-bold text-primary-500">{Math.round(settings.quality * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.1"
                                    max="1"
                                    step="0.01"
                                    value={settings.quality}
                                    onChange={(event) => setSettings(prev => ({ ...prev, quality: Number(event.target.value) }))}
                                    className="w-full accent-primary-500 h-1.5 bg-surface-200-800 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        )}

                        {shouldShowRatio && (
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Aspect Ratio</span>
                                <select
                                    className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full cursor-pointer"
                                    value={settings.ratioPreset}
                                    onChange={(event) => updateRatioPreset(event.target.value)}
                                >
                                    {RATIO_PRESETS.map(ratio => (
                                        <option key={ratio.value} value={ratio.value}>{ratio.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {shouldShowRatio && settings.ratioPreset === 'custom' && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Ratio W</span>
                                    <input
                                        type="number"
                                        min="1"
                                        className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full"
                                        value={settings.customRatioWidth}
                                        onChange={(event) => updateCustomRatio('customRatioWidth', event.target.value)}
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Ratio H</span>
                                    <input
                                        type="number"
                                        min="1"
                                        className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full"
                                        value={settings.customRatioHeight}
                                        onChange={(event) => updateCustomRatio('customRatioHeight', event.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Background</span>
                            <div className="flex gap-2">
                                <input
                                    type="color"
                                    value={settings.backgroundColor}
                                    onChange={(event) => setSettings(prev => ({ ...prev, backgroundColor: event.target.value }))}
                                    className="h-9 w-12 rounded-md border border-surface-200-800 bg-surface-50-950 cursor-pointer"
                                />
                                <input
                                    type="text"
                                    value={settings.backgroundColor}
                                    onChange={(event) => setSettings(prev => ({ ...prev, backgroundColor: event.target.value }))}
                                    className="min-w-0 flex-1 bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs font-mono outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                                />
                            </div>
                        </div>
                    </div>

                    <div className={`border border-surface-200-800 rounded-xl bg-surface-100-900 ${hasWatermark ? 'p-4 space-y-4' : 'p-3'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className={`${hasWatermark ? 'w-12 h-12' : 'w-9 h-9'} rounded-lg bg-surface-50-950 border border-surface-200-800 overflow-hidden flex items-center justify-center shrink-0`}>
                                    {hasWatermark ? (
                                        <img src={watermark.sourceUrl} alt="" className="w-full h-full object-contain" />
                                    ) : (
                                        <ImageIcon size={16} className="text-surface-500" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-primary-500">Watermark</h4>
                                    <p className="text-[10px] text-surface-500 truncate">
                                        {hasWatermark
                                            ? `${watermark.file?.name || 'Watermark'} / ${formatDimensions(watermark.naturalWidth, watermark.naturalHeight)}`
                                            : 'Upload an image to stamp converted output.'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => watermarkInputRef.current?.click()}
                                    className={`${hasWatermark ? 'px-3 py-2' : 'px-3 py-1.5'} rounded-lg preset-tonal text-xs font-bold inline-flex items-center gap-2`}
                                >
                                    <Upload size={14} />
                                    {hasWatermark ? 'Replace' : 'Upload'}
                                </button>
                                {hasWatermark && (
                                    <button
                                        type="button"
                                        onClick={removeWatermark}
                                        className="px-3 py-2 rounded-lg preset-tonal text-xs font-bold inline-flex items-center gap-2"
                                    >
                                        <Trash2 size={14} />
                                        Remove
                                    </button>
                                )}
                            </div>
                            <input
                                ref={watermarkInputRef}
                                type="file"
                                className="hidden"
                                accept="image/*,.heic,.heif"
                                onChange={(event) => {
                                    void loadWatermarkFile(event.target.files?.[0]);
                                    event.target.value = '';
                                }}
                            />
                        </div>

                        {hasWatermark && (
                        <div className="space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center gap-4">
                                <label className="inline-flex items-center gap-2 text-xs font-bold text-surface-700-300">
                                    <input
                                        type="checkbox"
                                        checked={watermark.enabled}
                                        disabled={!hasWatermark}
                                        onChange={(event) => updateWatermark({ enabled: event.target.checked })}
                                        className="w-4 h-4 accent-primary-500"
                                    />
                                    Enable watermark
                                </label>

                                <div className="flex-1 min-w-[180px]">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Transparency</span>
                                        <span className="text-[10px] font-mono font-bold text-primary-500">{Math.round(watermark.opacity * 100)}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={watermark.opacity}
                                        disabled={!hasWatermark}
                                        onChange={(event) => updateWatermark({ opacity: Number(event.target.value) })}
                                        className="w-full accent-primary-500 h-1.5 bg-surface-200-800 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Size Mode</span>
                                    <select
                                        className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full cursor-pointer disabled:cursor-not-allowed"
                                        value={watermark.sizeMode}
                                        disabled={!hasWatermark}
                                        onChange={(event) => updateWatermark({ sizeMode: event.target.value })}
                                    >
                                        <option value="relative">Relative</option>
                                        <option value="absolute">Absolute</option>
                                    </select>
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">
                                        {watermark.sizeMode === 'absolute' ? 'Width PX' : 'Width %'}
                                    </span>
                                    <input
                                        type="number"
                                        min="1"
                                        max={watermark.sizeMode === 'relative' ? '100' : undefined}
                                        className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full"
                                        value={watermark.sizeMode === 'absolute' ? watermark.absoluteWidth : watermark.relativeWidth}
                                        disabled={!hasWatermark}
                                        onChange={(event) => updateWatermark(
                                            watermark.sizeMode === 'absolute'
                                                ? { absoluteWidth: event.target.value }
                                                : { relativeWidth: event.target.value }
                                        )}
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Position Mode</span>
                                    <select
                                        className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full cursor-pointer disabled:cursor-not-allowed"
                                        value={watermark.offsetMode}
                                        disabled={!hasWatermark}
                                        onChange={(event) => updateWatermark({
                                            offsetMode: event.target.value,
                                            offsetX: event.target.value === 'absolute' ? 24 : 3,
                                            offsetY: event.target.value === 'absolute' ? 24 : 3,
                                        })}
                                    >
                                        <option value="relative">Relative</option>
                                        <option value="absolute">Absolute</option>
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">
                                            X {watermark.offsetMode === 'absolute' ? 'PX' : '%'}
                                        </span>
                                        <input
                                            type="number"
                                            className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full"
                                            value={watermark.offsetX}
                                            disabled={!hasWatermark}
                                            onChange={(event) => updateWatermark({ offsetX: event.target.value })}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">
                                            Y {watermark.offsetMode === 'absolute' ? 'PX' : '%'}
                                        </span>
                                        <input
                                            type="number"
                                            className="bg-surface-50-950 border border-surface-200-800 rounded-md px-3 py-2 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 w-full"
                                            value={watermark.offsetY}
                                            disabled={!hasWatermark}
                                            onChange={(event) => updateWatermark({ offsetY: event.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <span className="text-[10px] text-surface-500-400 font-bold uppercase tracking-wider">Anchor</span>
                                <div className="grid grid-cols-3 gap-1 w-full max-w-[220px]">
                                    {WATERMARK_ANCHORS.map(anchor => (
                                        <button
                                            key={anchor.value}
                                            type="button"
                                            disabled={!hasWatermark}
                                            title={anchor.label}
                                            aria-label={anchor.label}
                                            onClick={() => updateWatermark({ anchor: anchor.value })}
                                            className={`h-8 rounded-md border text-[10px] font-bold transition-colors disabled:cursor-not-allowed ${watermark.anchor === anchor.value ? 'border-primary-500 bg-primary-500/15 text-primary-500' : 'border-surface-200-800 bg-surface-50-950 text-surface-500 hover:border-primary-500/60'}`}
                                        >
                                            {anchor.shortLabel}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-3 pt-4 border-t border-surface-200-800">
                        <button
                            type="button"
                            onClick={convertActive}
                            disabled={!activeItem || activeItem.status === 'processing'}
                            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2 disabled:opacity-50 active:scale-95 uppercase tracking-[0.1em]"
                        >
                            <RefreshCw size={16} className={activeItem?.status === 'processing' ? 'animate-spin' : ''} />
                            Convert Active
                        </button>
                        <button
                            type="button"
                            onClick={convertAll}
                            disabled={!items.length || isConvertingAll}
                            className="px-5 py-2.5 bg-surface-900-100 text-surface-50-950 rounded-xl text-xs font-black transition-all flex items-center gap-2 disabled:opacity-50 active:scale-95 uppercase tracking-[0.1em]"
                        >
                            <Archive size={16} />
                            Convert All
                        </button>
                        <button
                            type="button"
                            onClick={downloadActive}
                            disabled={!activeItem?.resultUrl}
                            className="px-5 py-2.5 rounded-xl preset-tonal text-xs font-black transition-all flex items-center gap-2 disabled:opacity-50 active:scale-95 uppercase tracking-[0.1em]"
                        >
                            <Download size={16} />
                            Download Active
                        </button>
                        <button
                            type="button"
                            onClick={downloadAll}
                            disabled={!convertedItems.length}
                            className="px-5 py-2.5 rounded-xl preset-tonal text-xs font-black transition-all flex items-center gap-2 disabled:opacity-50 active:scale-95 uppercase tracking-[0.1em]"
                        >
                            <Archive size={16} />
                            Download ZIP
                        </button>
                    </div>

                    <div className="border border-surface-200-800 rounded-xl overflow-hidden bg-surface-100-900 shadow-sm">
                        <div className="px-4 py-3 border-b border-surface-200-800 flex items-center justify-between">
                            <h4 className="text-[11px] font-bold uppercase tracking-widest text-primary-500">Queue</h4>
                            <span className="text-[10px] font-mono text-surface-500">{items.length} files</span>
                        </div>

                        {items.length === 0 ? (
                            <div className="p-10 text-center text-surface-500 text-sm">
                                No images selected.
                            </div>
                        ) : (
                            <div className="divide-y divide-surface-200-800 max-h-[420px] overflow-y-auto">
                                {items.map(item => (
                                    <div
                                        key={item.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setActiveId(item.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setActiveId(item.id);
                                            }
                                        }}
                                        className={`w-full text-left p-3 transition-colors ${activeItem?.id === item.id ? 'bg-primary-500/10' : 'hover:bg-surface-200-800/40'}`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="w-12 h-12 rounded-lg bg-surface-200-800 border border-surface-300-700 overflow-hidden flex items-center justify-center shrink-0">
                                                {item.sourceUrl ? (
                                                    <img src={item.sourceUrl} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <ImageIcon size={20} className="text-surface-500" />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex gap-2 items-center justify-between">
                                                    <span className="font-bold text-xs truncate text-surface-900-100">{item.name}</span>
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            removeItem(item.id);
                                                        }}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter' || event.key === ' ') {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                removeItem(item.id);
                                                            }
                                                        }}
                                                        className="p-1 rounded hover:bg-error-500/10 text-surface-500 hover:text-error-500"
                                                        aria-label={`Remove ${item.name}`}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-surface-500">
                                                    <span>{item.inputType || 'image'} / {formatBytes(item.inputSize)}</span>
                                                    <span>In {formatDimensions(item.originalWidth, item.originalHeight)}</span>
                                                    <span>Out {formatDimensions(item.resultWidth, item.resultHeight)}</span>
                                                    {item.resultSize ? <span>{formatBytes(item.resultSize)}</span> : null}
                                                </div>
                                                <div className="flex items-center justify-between gap-2">
                                                    <StatusPill item={item} />
                                                    {item.error && (
                                                        <span className="text-[10px] text-red-500 truncate max-w-[260px]">{item.error}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="lg:sticky lg:top-4 border border-surface-200-800 rounded-2xl bg-surface-100-900 min-h-[440px] p-5 flex flex-col shadow-inner">
                    <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-surface-600-300 flex items-center gap-2">
                            <ImageIcon size={12} className="text-primary-500" />
                            Preview
                        </span>
                        <span className="text-[9px] font-mono text-primary-500 font-bold px-2 py-1 rounded bg-primary-500/10 border border-primary-500/20">
                            {selectedFormat.label}
                        </span>
                    </div>

                    {!activeItem ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-surface-500-400 text-xs font-medium gap-5 opacity-40 text-center">
                            <div className="w-20 h-20 rounded-full bg-surface-300-700 flex items-center justify-center">
                                <FileImage size={38} strokeWidth={1} />
                            </div>
                            <p className="uppercase tracking-widest text-[9px] font-black">Select Images</p>
                        </div>
                    ) : (
                        <>
                            <div className="flex-1 flex items-center justify-center rounded-xl min-h-[260px] p-4">
                                {activeItem.resultUrl || activeItem.sourceUrl ? (
                                    <div className="inline-flex max-w-full overflow-hidden rounded-lg border border-surface-200-800 bg-surface-50-950 shadow-sm">
                                        <img
                                            src={activeItem.resultUrl || activeItem.sourceUrl}
                                            alt={activeItem.name}
                                            className="block h-auto w-auto max-w-full max-h-[320px]"
                                        />
                                    </div>
                                ) : (
                                    <Loader2 size={36} className="animate-spin text-surface-500" />
                                )}
                            </div>

                            <div className="mt-4 space-y-3">
                                <div>
                                    <h3 className="font-bold text-sm text-surface-900-100 truncate">{activeItem.name}</h3>
                                    <p className="text-[10px] text-surface-500 mt-1">
                                        {activeItem.resultName || makeOutputName(activeItem.name, settings.outputType)}
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                    <div className="p-2 rounded-lg bg-surface-50-950 border border-surface-200-800">
                                        <span className="block uppercase tracking-widest font-bold text-surface-500">Original</span>
                                        <span className="font-mono text-surface-900-100">{formatDimensions(activeItem.originalWidth, activeItem.originalHeight)}</span>
                                    </div>
                                    <div className="p-2 rounded-lg bg-surface-50-950 border border-surface-200-800">
                                        <span className="block uppercase tracking-widest font-bold text-surface-500">Output</span>
                                        <span className="font-mono text-surface-900-100">{formatDimensions(activeItem.resultWidth, activeItem.resultHeight)}</span>
                                    </div>
                                    <div className="p-2 rounded-lg bg-surface-50-950 border border-surface-200-800">
                                        <span className="block uppercase tracking-widest font-bold text-surface-500">Input Size</span>
                                        <span className="font-mono text-surface-900-100">{formatBytes(activeItem.inputSize)}</span>
                                    </div>
                                    <div className="p-2 rounded-lg bg-surface-50-950 border border-surface-200-800">
                                        <span className="block uppercase tracking-widest font-bold text-surface-500">Output Size</span>
                                        <span className="font-mono text-surface-900-100">{activeItem.resultSize ? formatBytes(activeItem.resultSize) : '-'}</span>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
