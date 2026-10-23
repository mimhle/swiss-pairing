"use client";

/**
 * BYOK (bring your own key) storage for the in-app assistant.
 *
 * The API key is stored in this browser's localStorage so it persists across
 * reloads. It is sent to the app's /api/assistant proxy with each request and
 * forwarded to the user's provider. The server does not store it.
 *
 * Security note: localStorage is readable by any script running on this
 * origin. Users should use a limited key and avoid shared browser profiles.
 */

import {
    isValidBaseUrl,
    normalizeBaseUrl,
    normalizeReasoning,
} from "@/lib/assistantConfig";

export const ASSISTANT_CONFIG_STORAGE_KEY = "swiss_ai_config_v1";

function normalizeConfig(config) {
    const apiKey = String(config?.apiKey || "").trim();
    const baseUrl = normalizeBaseUrl(config?.baseUrl || "");
    const model = String(config?.model || "").trim();
    const reasoning = normalizeReasoning(config?.reasoning);

    if (!apiKey || !model || !isValidBaseUrl(baseUrl)) return null;

    return { apiKey, baseUrl, model, reasoning };
}

export function loadAssistantConfig() {
    if (typeof window === "undefined") return null;

    try {
        const raw = window.localStorage.getItem(ASSISTANT_CONFIG_STORAGE_KEY);
        if (!raw) return null;
        return normalizeConfig(JSON.parse(raw));
    } catch (_) {
        return null;
    }
}

export function saveAssistantConfig(config) {
    if (typeof window === "undefined") return false;

    const normalized = normalizeConfig(config);
    if (!normalized) return false;

    try {
        window.localStorage.setItem(
            ASSISTANT_CONFIG_STORAGE_KEY,
            JSON.stringify({ ...normalized, savedAt: Date.now() })
        );
        return true;
    } catch (_) {
        return false;
    }
}

export function clearAssistantConfig() {
    if (typeof window === "undefined") return false;

    try {
        window.localStorage.removeItem(ASSISTANT_CONFIG_STORAGE_KEY);
        return true;
    } catch (_) {
        return false;
    }
}
