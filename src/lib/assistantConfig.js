/**
 * Shared AI provider configuration helpers.
 *
 * This module is safe to import on the server and in the browser. The
 * browser storage helpers live in `assistantStorage.js`.
 */

export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4o-mini";
export const DEFAULT_AI_REASONING = "low";

export const AI_REASONING_OPTIONS = [
    {
        value: "auto",
        label: "Auto",
        description: "Use the provider's default thinking level.",
    },
    {
        value: "low",
        label: "Low",
        description: "Think less. Faster answers, usually enough for tournament edits.",
    },
    {
        value: "off",
        label: "Off",
        description: "Disable reasoning when the provider supports it.",
    },
];

export function normalizeReasoning(value) {
    return AI_REASONING_OPTIONS.some(option => option.value === value)
        ? value
        : DEFAULT_AI_REASONING;
}

/**
 * Normalize a user-entered base URL so the app can append `/chat/completions`.
 * Removes trailing slashes and an accidental `/chat/completions` suffix.
 */
export function normalizeBaseUrl(value) {
    let url = String(value || "").trim();
    if (!url) return "";

    url = url.replace(/\/+$/, "");
    url = url.replace(/\/chat\/completions$/i, "");
    url = url.replace(/\/+$/, "");

    return url;
}

/**
 * Validate a base URL for the server-side proxy.
 * Rejects non-HTTP(S) schemes, credentials, query strings, and fragments.
 */
export function isValidBaseUrl(value) {
    const url = normalizeBaseUrl(value);
    if (!url) return false;

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
        if (parsed.username || parsed.password) return false;
        if (parsed.search || parsed.hash) return false;
        return true;
    } catch (_) {
        return false;
    }
}
