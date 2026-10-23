import { NextResponse } from "next/server";
import { readGoogleSheet, SheetImportError, isSheetsApiConfigured } from "@/lib/googleSheetServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 40;
const rateLimitStore = new Map();

function getClientIp(request) {
    const forwarded = request.headers.get("x-forwarded-for") || "";
    return forwarded.split(",")[0].trim()
        || request.headers.get("x-real-ip")
        || "unknown";
}

function checkRateLimit(request) {
    const now = Date.now();

    if (rateLimitStore.size > 2000) {
        for (const [key, value] of rateLimitStore) {
            if (now - value.startedAt > RATE_LIMIT_WINDOW_MS) rateLimitStore.delete(key);
        }
    }

    const ip = getClientIp(request);
    const entry = rateLimitStore.get(ip);

    if (!entry || now - entry.startedAt > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.set(ip, { startedAt: now, count: 1 });
        return { allowed: true };
    }

    entry.count += 1;
    if (entry.count > RATE_LIMIT_MAX) {
        return {
            allowed: false,
            retryAfter: Math.ceil((entry.startedAt + RATE_LIMIT_WINDOW_MS - now) / 1000),
        };
    }

    return { allowed: true };
}

function errorResponse(message, status, extraHeaders = {}) {
    return NextResponse.json(
        { error: message },
        { status, headers: { "Cache-Control": "no-store", ...extraHeaders } }
    );
}

export async function POST(request) {
    const limit = checkRateLimit(request);
    if (!limit.allowed) {
        return errorResponse(
            "Too many Google Sheet imports. Wait a few minutes and try again.",
            429,
            { "Retry-After": String(limit.retryAfter) }
        );
    }

    let body;
    try {
        body = await request.json();
    } catch (_) {
        return errorResponse("Invalid JSON body.", 400);
    }

    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url || url.length > 2048) {
        return errorResponse(
            "Enter a Google Sheets link, for example https://docs.google.com/spreadsheets/d/...",
            400
        );
    }

    const tabs = Array.isArray(body?.tabs)
        ? body.tabs
            .filter(tab => typeof tab === "string" && tab.trim())
            .slice(0, 20)
            .map(tab => tab.trim().slice(0, 200))
        : undefined;

    try {
        const sheet = await readGoogleSheet({ url, tabs });
        return NextResponse.json(
            { ...sheet, sheetsApiConfigured: isSheetsApiConfigured() },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (error) {
        if (error instanceof SheetImportError) {
            return errorResponse(error.message, error.status);
        }

        console.error("[Google Sheet Import] Failed:", error?.message || error);
        return errorResponse("Could not read this Google Sheet. Try again.", 500);
    }
}
