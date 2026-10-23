"use client";

/**
 * Image preparation for the in-app assistant.
 *
 * Photos and screenshots are converted to compact JPEG data URLs before they
 * are sent to the AI provider. Downscaling keeps requests small enough for
 * platform body limits and reduces token cost, and the canvas re-encode strips
 * EXIF metadata such as GPS location.
 */

export const MAX_ATTACHMENTS = 4;

const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 650 * 1024;
// Keep the base64 payload under the API route's per-image limit.
const MAX_ACCEPTED_OUTPUT_BYTES = 655 * 1024;
const MAX_DIMENSION = 1600;
const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;

const RENDER_ATTEMPTS = [
    { maxDimension: MAX_DIMENSION, quality: 0.85 },
    { maxDimension: MAX_DIMENSION, quality: 0.7 },
    { maxDimension: 1400, quality: 0.7 },
    { maxDimension: 1200, quality: 0.65 },
    { maxDimension: 1024, quality: 0.6 },
];

export function isHeicFile(file) {
    return /image\/hei[cf]/i.test(file?.type || "")
        || /\.(heic|heif)$/i.test(file?.name || "");
}

export function isSupportedImageFile(file) {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "");

    if (type === "image/svg+xml" || /\.svg$/i.test(name)) return false;
    if (type.startsWith("image/")) return true;

    // Some browsers and file pickers leave the MIME type empty.
    return IMAGE_EXTENSION_PATTERN.test(name);
}

function createAttachmentId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadImage(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();

        image.onload = () => resolve({ image, url });
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("This image could not be read. Try a JPEG or PNG photo."));
        };
        image.src = url;
    });
}

function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) {
                reject(new Error("This browser could not prepare the image."));
                return;
            }
            resolve(blob);
        }, "image/jpeg", quality);
    });
}

async function renderJpeg(image, naturalWidth, naturalHeight, maxDimension, quality) {
    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvas rendering is unavailable in this browser.");
    }

    // Transparent PNGs get a white background so text stays readable.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, quality);
    return { blob, width, height };
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("This image could not be read."));
        reader.readAsDataURL(blob);
    });
}

/**
 * Prepare one image for the assistant.
 *
 * Returns a compact JPEG attachment: { id, name, dataUrl, width, height, size }.
 * Throws a user-facing Error when the file cannot be used.
 */
export async function prepareAssistantImage(file) {
    if (!isSupportedImageFile(file)) {
        throw new Error("Only image files can be attached.");
    }

    if (file.size > MAX_SOURCE_FILE_BYTES) {
        throw new Error("This image is too large. Use an image under 20 MB.");
    }

    let sourceBlob = file;

    if (isHeicFile(file)) {
        try {
            const heic2any = (await import("heic2any")).default;
            const converted = await heic2any({
                blob: file,
                toType: "image/jpeg",
                quality: 0.92,
            });
            sourceBlob = Array.isArray(converted) ? converted[0] : converted;
        } catch (_) {
            throw new Error("This HEIC image could not be converted. Try a JPEG or PNG.");
        }
    }

    const { image, url } = await loadImage(sourceBlob);

    try {
        const naturalWidth = image.naturalWidth;
        const naturalHeight = image.naturalHeight;

        if (!naturalWidth || !naturalHeight) {
            throw new Error("This image has no readable pixels.");
        }

        let best = null;

        for (const attempt of RENDER_ATTEMPTS) {
            const rendered = await renderJpeg(
                image,
                naturalWidth,
                naturalHeight,
                attempt.maxDimension,
                attempt.quality
            );

            if (!best || rendered.blob.size < best.blob.size) {
                best = rendered;
            }

            if (rendered.blob.size <= MAX_OUTPUT_BYTES) {
                best = rendered;
                break;
            }
        }

        if (best.blob.size > MAX_ACCEPTED_OUTPUT_BYTES) {
            throw new Error("This image is too detailed to attach. Crop it or use a screenshot.");
        }

        const dataUrl = await blobToDataUrl(best.blob);
        if (!dataUrl.startsWith("data:image/jpeg;base64,")) {
            throw new Error("This browser could not encode the image.");
        }

        return {
            id: createAttachmentId(),
            name: file.name || "image.jpg",
            dataUrl,
            width: best.width,
            height: best.height,
            size: best.blob.size,
        };
    } finally {
        URL.revokeObjectURL(url);
    }
}
