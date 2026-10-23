/**
 * Parse and validate Google Sheets links.
 *
 * Only Google Sheets URLs are accepted. The import proxy uses this module so a
 * user cannot turn the app into a general-purpose URL fetcher (SSRF).
 */

const ALLOWED_HOSTS = new Set(["docs.google.com", "sheets.google.com"]);
const SPREADSHEET_ID_PATTERN = /^[a-zA-Z0-9_-]{10,200}$/;

export const GOOGLE_SHEET_URL_ERROR =
    "Enter a Google Sheets link, for example https://docs.google.com/spreadsheets/d/...";

function parseGid(value) {
    const gid = String(value ?? "").trim();
    return /^\d+$/.test(gid) ? gid : null;
}

/**
 * @param {string} raw
 * @returns {{
 *   kind: "sheet" | "published",
 *   spreadsheetId: string,
 *   publishedId?: string,
 *   gid: string | null,
 *   url: string
 * } | null}
 */
export function parseGoogleSheetUrl(raw) {
    const input = String(raw ?? "").trim();
    if (!input) return null;

    let url;
    try {
        url = new URL(input.startsWith("http://") || input.startsWith("https://")
            ? input
            : `https://${input}`);
    } catch (_) {
        return null;
    }

    if (!/^https?:$/.test(url.protocol)) return null;
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.username || url.password) return null;

    const path = url.pathname;

    const publishedMatch = path.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([a-zA-Z0-9_-]+)\/(?:pubhtml|pub)\/?$/);
    if (publishedMatch) {
        const publishedId = publishedMatch[1];
        if (!SPREADSHEET_ID_PATTERN.test(publishedId)) return null;
        return {
            kind: "published",
            spreadsheetId: publishedId,
            publishedId,
            gid: parseGid(url.searchParams.get("gid")),
            url: url.toString(),
        };
    }

    const sheetMatch = path.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
    if (!sheetMatch) return null;

    const spreadsheetId = sheetMatch[1];
    if (!SPREADSHEET_ID_PATTERN.test(spreadsheetId)) return null;

    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const gid = parseGid(url.searchParams.get("gid")) || parseGid(hashParams.get("gid"));

    return {
        kind: "sheet",
        spreadsheetId,
        gid,
        url: url.toString(),
    };
}

export function isGoogleSheetUrl(value) {
    return Boolean(parseGoogleSheetUrl(value));
}
