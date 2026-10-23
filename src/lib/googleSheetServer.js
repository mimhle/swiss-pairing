/**
 * Server-side Google Sheets reader used by /api/import/google-sheet.
 *
 * The importer is intentionally stricter than a generic URL fetcher:
 * - only docs.google.com / sheets.google.com links are accepted;
 * - the Google Sheets API is used when GOOGLE_SHEETS_API_KEY is configured so
 *   every tab, formatted value, merged cell, hidden row/column, note, and
 *   number format is available to the assistant;
 * - without a key it falls back to the CSV export endpoint, which keeps the
 *   formatted display values but loses the grid metadata.
 */

import * as XLSX from "xlsx";
import { parseGoogleSheetUrl } from "@/lib/googleSheetUrl";

const REQUEST_TIMEOUT_MS = 20000;
const MAX_ROWS = 5000;
const MAX_COLUMNS = 200;
const MAX_TABS = 10;
const MAX_TOTAL_CELLS = 200000;
const MAX_FORMATTING_CELLS = 60000;
const MAX_META_CELLS = 30000;
const MAX_CSV_BYTES = 8 * 1024 * 1024;
const MAX_HTML_BYTES = 12 * 1024 * 1024;

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEET_METADATA_FIELDS = [
    "properties(title,locale,timeZone)",
    "sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount)))",
].join(",");
const SHEET_GRID_FIELDS = [
    "sheets(properties(title,sheetId),merges,data(startRow,startColumn,rowMetadata(hiddenByUser,hiddenByFilter),columnMetadata(hiddenByUser),rowData(values(formattedValue,effectiveValue,userEnteredValue,note,effectiveFormat(numberFormat,backgroundColor,textFormat(bold,italic,underline,strikethrough))))))",
].join(",");

export class SheetImportError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = "SheetImportError";
        this.status = status;
    }
}

function getSheetsApiKey() {
    return String(
        process.env.GOOGLE_SHEETS_API_KEY
        || process.env.GOOGLE_API_KEY
        || ""
    ).trim();
}

function columnLetter(index) {
    let value = Math.max(0, index) + 1;
    let result = "";
    while (value > 0) {
        const remainder = (value - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        value = Math.floor((value - 1) / 26);
    }
    return result;
}

function quoteSheetTitle(title) {
    return `'${String(title).replace(/'/g, "''")}'`;
}

function normalizeCellValue(value) {
    if (value == null) return "";
    return String(value);
}

function colorToHex(color) {
    if (!color) return "";
    const alpha = color.alpha == null ? 1 : Number(color.alpha);
    if (!(alpha > 0.05)) return "";

    const channels = [color.red, color.green, color.blue].map(value => {
        const number = Number(value ?? 0);
        return Math.max(0, Math.min(255, Math.round(number * 255)));
    });

    // Ignore the default white background.
    if (channels.every(channel => channel >= 250)) return "";
    return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

function padRows(rows, columnCount) {
    return rows.map(row => {
        const next = Array.isArray(row) ? row.slice(0, columnCount).map(normalizeCellValue) : [];
        while (next.length < columnCount) next.push("");
        return next;
    });
}

function emptyTab({ title, sheetId = null, index = 0, hidden = false, rows = [], warnings = [] }) {
    const sourceRowCount = rows.length;
    const sourceColumnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const rowCount = Math.min(sourceRowCount, MAX_ROWS);
    const columnCount = Math.min(sourceColumnCount, MAX_COLUMNS);
    const keptRows = rows.slice(0, rowCount);

    return {
        title,
        sheetId,
        index,
        hidden,
        rowCount,
        columnCount,
        sourceRowCount,
        sourceColumnCount,
        rows: padRows(keptRows, columnCount),
        cellMeta: {},
        merges: [],
        hiddenRows: [],
        hiddenColumns: [],
        truncated: rowCount < sourceRowCount || columnCount < sourceColumnCount,
        formattingComplete: false,
        warnings,
    };
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new SheetImportError("Google took too long to return this sheet. Try again.", 504);
        }
        throw new SheetImportError("Could not reach Google Sheets. Check your network and the link.", 502);
    } finally {
        clearTimeout(timeout);
    }
}

function googleErrorMessage(status, context) {
    if (status === 401 || status === 403) {
        return "Google denied access to this sheet. Share it as \"Anyone with the link (Viewer)\" or publish it to the web. If this deployment uses a Google Sheets API key, make sure the key is valid and the Google Sheets API is enabled.";
    }
    if (status === 404) {
        return "Google Sheet not found. Check that the link is complete and the file still exists.";
    }
    if (status === 429) {
        return "Google is rate-limiting this import. Wait a minute and try again.";
    }
    return `Google Sheets returned ${status}${context ? ` while ${context}` : ""}.`;
}

async function readGoogleJson(url, context) {
    const response = await fetchWithTimeout(url, {
        headers: { Accept: "application/json" },
    });

    if (!response.ok) {
        throw new SheetImportError(googleErrorMessage(response.status, context), response.status === 429 ? 429 : 502);
    }

    try {
        return await response.json();
    } catch (_) {
        throw new SheetImportError("Google returned an unreadable response. Try again.", 502);
    }
}

function selectTabs(sheets, requestedTabs, gid) {
    const normalizedRequested = new Set(
        (Array.isArray(requestedTabs) ? requestedTabs : [])
            .map(title => String(title || "").trim().toLowerCase())
            .filter(Boolean)
    );

    const all = (sheets || []).filter(sheet => sheet?.properties?.title);
    let selected = normalizedRequested.size > 0
        ? all.filter(sheet => normalizedRequested.has(sheet.properties.title.toLowerCase()))
        : all.filter(sheet => !sheet.properties.hidden);

    if (selected.length === 0) selected = all;

    const gidNumber = gid != null && /^\d+$/.test(String(gid)) ? Number(gid) : null;
    const activeTab = gidNumber != null
        ? selected.find(sheet => Number(sheet.properties.sheetId) === gidNumber)
            || all.find(sheet => Number(sheet.properties.sheetId) === gidNumber)
        : null;

    return {
        selected: selected.slice(0, MAX_TABS),
        activeTab: activeTab || selected[0] || null,
        totalTabs: all.length,
    };
}

function buildCellMeta(data, sheet) {
    const cellMeta = {};
    const hiddenRows = [];
    const hiddenColumns = [];
    let metaCount = 0;

    const startRow = Number(data?.startRow) || 0;
    const startColumn = Number(data?.startColumn) || 0;

    (data?.rowMetadata || []).forEach((row, index) => {
        if (row?.hiddenByUser || row?.hiddenByFilter) hiddenRows.push(startRow + index);
    });
    (data?.columnMetadata || []).forEach((column, index) => {
        if (column?.hiddenByUser) hiddenColumns.push(startColumn + index);
    });

    (data?.rowData || []).forEach((row, rowIndex) => {
        (row?.values || []).forEach((cell, columnIndex) => {
            if (!cell || metaCount >= MAX_META_CELLS) return;

            const meta = {};
            const format = cell.effectiveFormat?.numberFormat;
            const effective = cell.effectiveValue;

            if (format?.type && format.type !== "TEXT") {
                meta.numberFormat = format.type;
                if (format.pattern) meta.pattern = format.pattern;
            }

            const fill = colorToHex(cell.effectiveFormat?.backgroundColor);
            if (fill) meta.fill = fill;
            if (cell.effectiveFormat?.textFormat?.bold) meta.bold = true;
            if (cell.effectiveFormat?.textFormat?.italic) meta.italic = true;
            if (cell.effectiveFormat?.textFormat?.underline) meta.underline = true;
            if (cell.effectiveFormat?.textFormat?.strikethrough) meta.strikethrough = true;

            if (effective) {
                if (effective.errorValue != null) {
                    meta.type = "error";
                    meta.error = normalizeCellValue(effective.errorValue);
                } else if (effective.boolValue != null) {
                    meta.type = "boolean";
                } else if (effective.numberValue != null) {
                    const isDate = format?.type === "DATE" || format?.type === "DATE_TIME";
                    meta.type = isDate ? "date" : "number";
                }
            }

            if (cell.note) meta.note = normalizeCellValue(cell.note);
            if (cell.userEnteredValue?.formulaValue) meta.formula = true;

            if (Object.keys(meta).length === 0) return;

            cellMeta[`${startRow + rowIndex},${startColumn + columnIndex}`] = meta;
            metaCount += 1;
        });
    });

    const merges = (sheet?.merges || []).map(merge => {
        const row = startRow + (Number(merge.startRowIndex) || 0);
        const column = startColumn + (Number(merge.startColumnIndex) || 0);
        return {
            startRow: row,
            endRow: startRow + (Number(merge.endRowIndex) || 0),
            startColumn: column,
            endColumn: startColumn + (Number(merge.endColumnIndex) || 0),
            value: normalizeCellValue(data?.rowData?.[row - startRow]?.values?.[column - startColumn]?.formattedValue),
        };
    }).filter(merge => merge.endRow > merge.startRow || merge.endColumn > merge.startColumn);

    return {
        cellMeta,
        merges,
        hiddenRows: hiddenRows.filter(row => row < MAX_ROWS),
        hiddenColumns: hiddenColumns.filter(column => column < MAX_COLUMNS),
    };
}

async function readTabWithApi({ spreadsheetId, apiKey, sheet }) {
    const title = sheet.properties.title;
    const range = quoteSheetTitle(title);
    const valuesUrl = new URL(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
    valuesUrl.searchParams.set("key", apiKey);
    valuesUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
    valuesUrl.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
    valuesUrl.searchParams.set("majorDimension", "ROWS");

    const valuesData = await readGoogleJson(valuesUrl.toString(), `reading "${title}"`);
    const sourceRows = Array.isArray(valuesData?.values) ? valuesData.values : [];
    const tab = emptyTab({
        title,
        sheetId: sheet.properties.sheetId ?? null,
        index: sheet.properties.index ?? 0,
        hidden: Boolean(sheet.properties.hidden),
        rows: sourceRows,
    });

    if (tab.truncated) {
        tab.warnings.push(
            `"${title}" has ${tab.sourceRowCount} rows and ${tab.sourceColumnCount} columns. Only the first ${tab.rowCount} rows and ${tab.columnCount} columns were read. Split the sheet or move the player list to a smaller tab before importing.`
        );
    }

    if (tab.rowCount === 0 || tab.columnCount === 0) {
        tab.formattingComplete = true;
        return tab;
    }

    const gridCellCount = tab.rowCount * tab.columnCount;
    if (gridCellCount > MAX_FORMATTING_CELLS) {
        tab.warnings.push(
            `"${title}" is too large to read full formatting (${gridCellCount} cells). Values were read, but merged cells, hidden rows/columns, notes, and number formats are unavailable for this tab.`
        );
        return tab;
    }

    const gridRange = `${quoteSheetTitle(title)}!A1:${columnLetter(tab.columnCount - 1)}${tab.rowCount}`;
    const gridUrl = new URL(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}`);
    gridUrl.searchParams.set("key", apiKey);
    gridUrl.searchParams.set("includeGridData", "true");
    gridUrl.searchParams.set("ranges", gridRange);
    gridUrl.searchParams.set("fields", SHEET_GRID_FIELDS);

    try {
        const gridData = await readGoogleJson(gridUrl.toString(), `reading formatting in "${title}"`);
        const gridSheet = (gridData?.sheets || []).find(candidate => (
            candidate?.properties?.title === title
        )) || gridData?.sheets?.[0];
        const data = gridSheet?.data?.[0] || null;

        if (data) {
            const meta = buildCellMeta(data, gridSheet);
            tab.cellMeta = meta.cellMeta;
            tab.merges = meta.merges;
            tab.hiddenRows = meta.hiddenRows;
            tab.hiddenColumns = meta.hiddenColumns;
            tab.formattingComplete = true;
        }
    } catch (error) {
        tab.warnings.push(
            `Could not read full formatting for "${title}": ${error?.message || "Google did not return grid data."} Values were still imported.`
        );
    }

    return tab;
}

async function readWithSheetsApi(parsed, requestedTabs) {
    const apiKey = getSheetsApiKey();
    const metadataUrl = new URL(`${SHEETS_API}/${encodeURIComponent(parsed.spreadsheetId)}`);
    metadataUrl.searchParams.set("key", apiKey);
    metadataUrl.searchParams.set("fields", SHEET_METADATA_FIELDS);

    const metadata = await readGoogleJson(metadataUrl.toString(), "reading the spreadsheet");
    const sheets = metadata?.sheets || [];
    if (sheets.length === 0) {
        throw new SheetImportError("This Google Sheet has no tabs.", 400);
    }

    const { selected, activeTab, totalTabs } = selectTabs(sheets, requestedTabs, parsed.gid);
    if (selected.length === 0) {
        throw new SheetImportError("None of the requested tabs were found in this Google Sheet.", 400);
    }

    const tabs = [];
    const warnings = [];
    const availableTabs = sheets.map(sheet => ({
        title: sheet.properties.title,
        sheetId: sheet.properties.sheetId ?? null,
        index: sheet.properties.index ?? 0,
        hidden: Boolean(sheet.properties.hidden),
        rowCount: sheet.properties.gridProperties?.rowCount ?? null,
        columnCount: sheet.properties.gridProperties?.columnCount ?? null,
    }));

    if (totalTabs > selected.length) {
        warnings.push(
            `This spreadsheet has ${totalTabs} tabs. Only ${selected.length} were read. Ask for a specific tab if the player list is in another one.`
        );
    }

    for (const sheet of selected) {
        const tab = await readTabWithApi({
            spreadsheetId: parsed.spreadsheetId,
            apiKey,
            sheet,
        });
        tabs.push(tab);
        warnings.push(...tab.warnings);

        const totalCells = tabs.reduce(
            (sum, item) => sum + (item.rowCount * item.columnCount),
            0
        );
        if (totalCells > MAX_TOTAL_CELLS) {
            throw new SheetImportError(
                `This Google Sheet is too large to import (${totalCells} cells across the selected tabs). Move the player list to a smaller tab, or split the workbook.`,
                413
            );
        }
    }

    return {
        source: "sheets-api",
        spreadsheet: {
            id: parsed.spreadsheetId,
            title: metadata?.properties?.title || "",
            locale: metadata?.properties?.locale || "",
            timeZone: metadata?.properties?.timeZone || "",
        },
        activeTab: activeTab?.properties?.title || tabs[0]?.title || "",
        availableTabs,
        tabs,
        warnings,
        complete: tabs.every(tab => tab.formattingComplete && !tab.truncated),
        formattingCoverage: {
            values: true,
            strikethrough: true,
            bold: true,
            italic: true,
            underline: true,
            fill: true,
            merges: true,
            hiddenRows: true,
            hiddenColumns: true,
            notes: true,
            numberFormats: true,
        },
        fetchedAt: Date.now(),
    };
}

async function readCsvText(url) {
    const response = await fetchWithTimeout(url, {
        headers: { Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8" },
        redirect: "follow",
    });

    if (!response.ok) {
        throw new SheetImportError(googleErrorMessage(response.status, "reading the CSV export"), response.status === 429 ? 429 : 502);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_CSV_BYTES) {
        throw new SheetImportError("This sheet is too large to import. Split it or move the player list to a smaller tab.", 413);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_CSV_BYTES) {
        throw new SheetImportError("This sheet is too large to import. Split it or move the player list to a smaller tab.", 413);
    }

    const text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
    if (contentType.includes("text/html") || /^\s*<!doctype html|^\s*<html/i.test(text)) {
        throw new SheetImportError(
            "Google returned a sign-in page instead of the sheet. Share the sheet as \"Anyone with the link (Viewer)\" or publish it to the web.",
            403
        );
    }

    return text;
}

function parseCsv(text) {
    try {
        const workbook = XLSX.read(text, { type: "string", raw: false, cellDates: false });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!worksheet) return { title: "Sheet", rows: [] };
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: false });
        return {
            title: workbook.SheetNames[0] || "Sheet",
            rows: data,
        };
    } catch (_) {
        throw new SheetImportError("Could not parse the CSV export from this sheet.", 422);
    }
}

function decodeHtmlEntities(text) {
    return String(text)
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
            try { return String.fromCodePoint(parseInt(hex, 16)); } catch (_) { return ""; }
        })
        .replace(/&#(\d+);/g, (_, decimal) => {
            try { return String.fromCodePoint(parseInt(decimal, 10)); } catch (_) { return ""; }
        })
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}

function htmlToText(fragment) {
    const text = String(fragment ?? "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr)>/gi, "\n")
        .replace(/<[^>]*>/g, " ");

    return decodeHtmlEntities(text)
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/\s*\n\s*/g, " ")
        .trim();
}

function normalizeColor(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw || raw === "transparent" || raw === "inherit") return "";

    let red;
    let green;
    let blue;
    let alpha = 1;

    const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
        let digits = hex[1];
        if (digits.length === 3 || digits.length === 4) {
            digits = digits.split("").map(char => char + char).join("");
        }
        if (digits.length === 6 || digits.length === 8) {
            red = parseInt(digits.slice(0, 2), 16);
            green = parseInt(digits.slice(2, 4), 16);
            blue = parseInt(digits.slice(4, 6), 16);
            if (digits.length === 8) alpha = parseInt(digits.slice(6, 8), 16) / 255;
        }
    } else {
        const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
        if (!rgb) return "";
        const parts = rgb[1].split(",").map(part => part.trim());
        red = Number(parts[0]);
        green = Number(parts[1]);
        blue = Number(parts[2]);
        if (parts[3] != null) alpha = Number(parts[3]);
    }

    if (![red, green, blue].every(Number.isFinite) || alpha <= 0.05) return "";

    const channels = [red, green, blue].map(channel => (
        Math.max(0, Math.min(255, Math.round(channel)))
    ));
    if (channels.every(channel => channel >= 250)) return "";

    return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

function parseFormattingCss(text) {
    const formatting = {};
    if (!text) return formatting;

    if (/text-decoration[^;]*line-through/i.test(text)) formatting.strikethrough = true;
    if (/text-decoration[^;]*underline/i.test(text)) formatting.underline = true;
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(text)) formatting.bold = true;
    if (/font-style\s*:\s*italic/i.test(text)) formatting.italic = true;

    const fill = text.match(/background-color\s*:\s*([^;]+)/i);
    if (fill) {
        const color = normalizeColor(fill[1]);
        if (color) formatting.fill = color;
    }

    return formatting;
}

function parseCssFormats(html) {
    const formats = {};
    const styleBlocks = String(html ?? "").match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];

    for (const block of styleBlocks) {
        const css = block.replace(/^<style[^>]*>/i, "").replace(/<\/style>$/i, "");
        const rulePattern = /\.([a-zA-Z_][\w-]*)\s*\{([^}]*)\}/g;
        let match;
        while ((match = rulePattern.exec(css)) !== null) {
            const formatting = parseFormattingCss(match[2]);
            if (Object.keys(formatting).length > 0) {
                formats[match[1]] = { ...(formats[match[1]] || {}), ...formatting };
            }
        }
    }

    return formats;
}

function parseContentFormatting(content) {
    const formatting = {};
    if (/<s\b|<strike\b|line-through/i.test(content)) formatting.strikethrough = true;
    if (/<b\b|<strong\b/i.test(content)) formatting.bold = true;
    if (/<i\b|<em\b/i.test(content)) formatting.italic = true;
    if (/<u\b/i.test(content)) formatting.underline = true;
    return formatting;
}

function looksLikeHtmlDate(value) {
    const text = String(value ?? "").trim();
    return /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(text)
        || /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\s+\d{1,2}:\d{2}(:\d{2})?$/.test(text)
        || /^\d{4}-\d{2}-\d{2}$/.test(text)
        || /^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i.test(text);
}

function parseHtmlTabs(html, spreadsheetId) {
    const tabs = [];
    const seen = new Set();
    const pattern = /items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"((?:[^"\\]|\\.)*)",\s*gid:\s*"(-?\d+)"/g;
    let match;

    while ((match = pattern.exec(html)) !== null) {
        let name = match[1];
        try {
            name = JSON.parse(`"${match[1]}"`);
        } catch (_) {
            name = name.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        }

        const gid = match[3];
        if (seen.has(gid)) continue;
        seen.add(gid);
        tabs.push({
            title: decodeHtmlEntities(String(name || `Sheet ${tabs.length + 1}`)),
            gid,
            index: tabs.length,
        });
    }

    if (tabs.length === 0) {
        tabs.push({
            title: "Sheet1",
            gid: null,
            index: 0,
        });
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const spreadsheetTitle = titleMatch
        ? decodeHtmlEntities(titleMatch[1]).replace(/\s*-\s*Google Sheets\s*$/i, "").trim()
        : "";

    return { tabs, spreadsheetTitle, spreadsheetId };
}

function parseHtmlTable(html) {
    const formats = parseCssFormats(html);
    const tableMatch = html.match(/<table[^>]*class="[^"]*\bwaffle\b[^"]*"[^>]*>([\s\S]*?)<\/table>/i)
        || html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);

    if (!tableMatch) {
        throw new SheetImportError("Could not find the sheet table in Google's HTML view.", 422);
    }

    const bodyMatch = tableMatch[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const body = bodyMatch ? bodyMatch[1] : tableMatch[1];
    const rowMatches = [...body.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];

    const grid = [];
    const cellMeta = {};
    const merges = [];
    const hiddenRows = [];
    const occupied = new Set();
    let maxColumns = 0;

    rowMatches.forEach(rowMatch => {
        const rowAttrs = rowMatch[1] || "";
        const rowHtml = rowMatch[2] || "";

        if (/freezebar/i.test(rowAttrs)) return;

        const cellMatches = [...rowHtml.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)];
        const dataCells = cellMatches.filter(cell => cell[1].toLowerCase() === "d");
        if (dataCells.length === 0) return;

        // Use the index in the returned grid, not the raw <tr> index, because
        // freezebar and spacer rows are skipped.
        const rowIndex = grid.length;
        const row = [];
        let column = 0;
        const rowIsHidden = /\bdisplay\s*:\s*none\b/i.test(rowAttrs);

        for (const cell of dataCells) {
            const attrs = cell[2] || "";
            if (/freezebar/i.test(attrs)) continue;
            while (occupied.has(`${rowIndex},${column}`)) column += 1;

            const colspan = Math.max(1, parseInt(attrs.match(/colspan\s*=\s*"(\d+)"/i)?.[1] || "1", 10));
            const rowspan = Math.max(1, parseInt(attrs.match(/rowspan\s*=\s*"(\d+)"/i)?.[1] || "1", 10));
            const text = htmlToText(cell[3]);
            row[column] = text;

            const formatting = {};
            const classMatch = attrs.match(/class\s*=\s*"([^"]*)"/i);
            if (classMatch) {
                classMatch[1].split(/\s+/).filter(Boolean).forEach(className => {
                    Object.assign(formatting, formats[className] || {});
                });
            }
            const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i);
            if (styleMatch) Object.assign(formatting, parseFormattingCss(styleMatch[1]));
            Object.assign(formatting, parseContentFormatting(cell[3]));
            if (looksLikeHtmlDate(text)) formatting.type = "date";

            if (Object.keys(formatting).length > 0) {
                cellMeta[`${rowIndex},${column}`] = formatting;
            }

            if (rowspan > 1 || colspan > 1) {
                merges.push({
                    startRow: rowIndex,
                    endRow: rowIndex + rowspan,
                    startColumn: column,
                    endColumn: column + colspan,
                    value: text,
                });
                for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
                    for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
                        if (rowOffset === 0 && columnOffset === 0) continue;
                        occupied.add(`${rowIndex + rowOffset},${column + columnOffset}`);
                    }
                }
            }

            column += colspan;
            maxColumns = Math.max(maxColumns, column);
        }

        if (column > 0) {
            grid.push(row);
            if (rowIsHidden) hiddenRows.push(rowIndex);
        }
    });

    const rows = grid.map(row => Array.from({ length: maxColumns }, (_, index) => row[index] ?? ""));

    // Drop trailing empty columns and rows so the AI does not see decorative
    // whitespace as real fields.
    let lastColumn = -1;
    rows.forEach(row => {
        row.forEach((value, index) => {
            if (String(value ?? "").trim()) lastColumn = Math.max(lastColumn, index);
        });
    });
    const trimmed = lastColumn >= 0
        ? rows.map(row => row.slice(0, lastColumn + 1))
        : rows;

    while (trimmed.length > 1 && trimmed[trimmed.length - 1].every(value => !String(value ?? "").trim())) {
        trimmed.pop();
    }

    const filteredMeta = {};
    Object.entries(cellMeta).forEach(([key, value]) => {
        const [row, column] = key.split(",").map(Number);
        if (row < trimmed.length && column <= lastColumn) filteredMeta[key] = value;
    });

    return {
        rows: trimmed,
        cellMeta: filteredMeta,
        merges: merges.filter(merge => (
            merge.startRow < trimmed.length
            && merge.startColumn <= lastColumn
        )),
        hiddenRows: hiddenRows.filter(row => row < trimmed.length),
        hiddenColumns: [],
    };
}

async function readHtmlPage(url, context) {
    const response = await fetchWithTimeout(url, {
        headers: { Accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
    });

    if (!response.ok) {
        throw new SheetImportError(
            googleErrorMessage(response.status, context),
            response.status === 429 ? 429 : (response.status === 401 || response.status === 403) ? 403 : 502
        );
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) {
        throw new SheetImportError("This sheet is too large to read from Google's HTML view.", 413);
    }

    const html = new TextDecoder("utf-8").decode(buffer);
    if (/<title>\s*(sign in|đăng nhập)/i.test(html) || /You need access|Request access/i.test(html)) {
        throw new SheetImportError(
            "Google requires sign-in for this sheet. Share it as \"Anyone with the link (Viewer)\" or publish it to the web.",
            403
        );
    }

    return html;
}

async function readWithHtmlView(parsed, requestedTabs) {
    const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsed.spreadsheetId)}`;
    const home = await readHtmlPage(`${base}/htmlview`, "listing the tabs");
    const { tabs: available, spreadsheetTitle } = parseHtmlTabs(home, parsed.spreadsheetId);

    const requested = new Set(
        (Array.isArray(requestedTabs) ? requestedTabs : [])
            .map(title => String(title || "").trim().toLowerCase())
            .filter(Boolean)
    );

    const selected = requested.size > 0
        ? available.filter(tab => requested.has(tab.title.toLowerCase()))
        : available;

    if (selected.length === 0) {
        throw new SheetImportError("None of the requested tabs were found in this Google Sheet.", 400);
    }

    const activeGid = parsed.gid || selected[0].gid;
    const tabs = [];
    const warnings = [
        "This sheet was read from Google's HTML view. Values, strikethrough, bold, italic, underline, and fill colors are available. Merged-cell ranges are reconstructed from rowspan/colspan; hidden rows, notes, and exact number formats may be missing. Set GOOGLE_SHEETS_API_KEY for the full formatting metadata.",
    ];

    for (const tab of selected.slice(0, MAX_TABS)) {
        const gidQuery = tab.gid ? `&gid=${encodeURIComponent(tab.gid)}` : "";
        const page = await readHtmlPage(
            `${base}/htmlview/sheet?headers=true${gidQuery}`,
            `reading "${tab.title}"`
        );
        const parsedTab = parseHtmlTable(page);
        const tabEntry = emptyTab({
            title: tab.title,
            sheetId: tab.gid != null ? Number(tab.gid) : null,
            index: tab.index,
            hidden: false,
            rows: parsedTab.rows,
        });

        // Keep only metadata inside the capped rows/columns returned by emptyTab.
        const cellMeta = {};
        Object.entries(parsedTab.cellMeta).forEach(([key, value]) => {
            const [row, column] = key.split(",").map(Number);
            if (row < tabEntry.rowCount && column < tabEntry.columnCount) cellMeta[key] = value;
        });

        tabEntry.cellMeta = cellMeta;
        tabEntry.merges = parsedTab.merges
            .filter(merge => merge.startRow < tabEntry.rowCount && merge.startColumn < tabEntry.columnCount)
            .slice(0, 200);
        tabEntry.hiddenRows = parsedTab.hiddenRows.filter(row => row < tabEntry.rowCount);
        tabEntry.hiddenColumns = parsedTab.hiddenColumns.filter(column => column < tabEntry.columnCount);
        tabEntry.formattingComplete = false;
        tabEntry.warnings.push(
            "Formatting coverage from HTML view: values, strikethrough, bold, italic, underline, and fill colors. Merged-cell ranges are reconstructed; hidden rows and notes may be missing."
        );

        if (tabEntry.truncated) {
            tabEntry.warnings.push(
                `"${tab.title}" has ${tabEntry.sourceRowCount} rows and ${tabEntry.sourceColumnCount} columns. Only the first ${tabEntry.rowCount} rows and ${tabEntry.columnCount} columns were read. Split the sheet before importing.`
            );
        }

        tabs.push(tabEntry);
        warnings.push(...tabEntry.warnings);
        tab.rowCount = tabEntry.sourceRowCount;
        tab.columnCount = tabEntry.sourceColumnCount;
    }

    return {
        source: "htmlview",
        spreadsheet: {
            id: parsed.spreadsheetId,
            title: spreadsheetTitle,
            locale: "",
            timeZone: "",
        },
        activeTab: available.find(tab => String(tab.gid) === String(activeGid))?.title || tabs[0]?.title || "",
        availableTabs: available.map(tab => ({
            title: tab.title,
            sheetId: tab.gid != null ? Number(tab.gid) : null,
            index: tab.index,
            hidden: false,
            rowCount: tab.rowCount ?? null,
            columnCount: tab.columnCount ?? null,
        })),
        tabs,
        warnings,
        complete: false,
        formattingCoverage: {
            values: true,
            strikethrough: true,
            bold: true,
            italic: true,
            underline: true,
            fill: true,
            merges: true,
            hiddenRows: false,
            hiddenColumns: false,
            notes: false,
            numberFormats: false,
        },
        fetchedAt: Date.now(),
    };
}

async function readWithCsv(parsed) {
    let url;
    if (parsed.kind === "published") {
        url = new URL(`https://docs.google.com/spreadsheets/d/e/${encodeURIComponent(parsed.publishedId)}/pub`);
        url.searchParams.set("output", "csv");
    } else {
        url = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(parsed.spreadsheetId)}/export`);
        url.searchParams.set("format", "csv");
    }
    if (parsed.gid) url.searchParams.set("gid", parsed.gid);

    const text = await readCsvText(url.toString());
    const { title, rows } = parseCsv(text);
    const tab = emptyTab({
        title: title || "Sheet",
        sheetId: parsed.gid != null ? Number(parsed.gid) : null,
        index: 0,
        hidden: false,
        rows,
        warnings: [
            "Formatting details are unavailable because this deployment has no Google Sheets API key. Values use the displayed text from the CSV export. Merged cells, hidden rows/columns, notes, and number formats were not read. Set GOOGLE_SHEETS_API_KEY for full formatting.",
        ],
    });

    if (tab.truncated) {
        tab.warnings.push(
            `This tab has ${tab.sourceRowCount} rows and ${tab.sourceColumnCount} columns. Only the first ${tab.rowCount} rows and ${tab.columnCount} columns were read. Split the sheet before importing.`
        );
    }

    if (tab.rowCount * tab.columnCount > MAX_TOTAL_CELLS) {
        throw new SheetImportError(
            `This Google Sheet is too large to import (${tab.rowCount * tab.columnCount} cells). Move the player list to a smaller tab, or split the workbook.`,
            413
        );
    }

    tab.formattingComplete = false;

    return {
        source: "csv",
        spreadsheet: {
            id: parsed.spreadsheetId,
            title: "",
            locale: "",
            timeZone: "",
        },
        activeTab: tab.title,
        availableTabs: [{
            title: tab.title,
            sheetId: tab.sheetId,
            index: 0,
            hidden: false,
            rowCount: tab.sourceRowCount,
            columnCount: tab.sourceColumnCount,
        }],
        tabs: [tab],
        warnings: [
            ...tab.warnings,
            "This sheet was read from the CSV export. Values use the displayed text, but merged cells, hidden rows/columns, notes, strikethrough, and number formats are unavailable.",
        ],
        complete: false,
        formattingCoverage: {
            values: true,
            strikethrough: false,
            bold: false,
            italic: false,
            underline: false,
            fill: false,
            merges: false,
            hiddenRows: false,
            hiddenColumns: false,
            notes: false,
            numberFormats: false,
        },
        fetchedAt: Date.now(),
    };
}

/**
 * @param {{ url: string, tabs?: string[] }} input
 */
export async function readGoogleSheet({ url, tabs }) {
    const parsed = parseGoogleSheetUrl(url);
    if (!parsed) {
        throw new SheetImportError(
            "Enter a Google Sheets link, for example https://docs.google.com/spreadsheets/d/...",
            400
        );
    }

    if (parsed.kind === "published") {
        return readWithCsv(parsed);
    }

    const apiKey = getSheetsApiKey();

    if (apiKey) {
        try {
            return await readWithSheetsApi(parsed, tabs);
        } catch (error) {
            // A key can be present but still fail: the Sheets API may be
            // disabled, the key may be restricted, or the key's project may
            // not see a link-shared file. Try the public HTML view first; it
            // keeps every tab and text formatting such as strikethrough.
            if (
                error instanceof SheetImportError
                && [400, 401, 403, 404].includes(error.status)
            ) {
                try {
                    const fallback = await readWithHtmlView(parsed, tabs);
                    fallback.warnings.unshift(
                        `Google Sheets API could not read this sheet (${error.message}). The importer used Google's HTML view instead. Values, strikethrough, bold, italic, underline, and fill colors are available; some grid metadata may be missing.`
                    );
                    fallback.fallbackReason = error.message;
                    return fallback;
                } catch (_) {
                    // HTML view also failed; fall through to CSV.
                }

                try {
                    const fallback = await readWithCsv(parsed);
                    fallback.warnings.unshift(
                        `Google Sheets API could not read this sheet (${error.message}). The importer used the CSV export instead, so only one tab is available and formatting is missing.`
                    );
                    fallback.fallbackReason = error.message;
                    return fallback;
                } catch (_) {
                    throw error;
                }
            }

            throw error;
        }
    }

    try {
        return await readWithHtmlView(parsed, tabs);
    } catch (htmlError) {
        // The HTML view is a fallback, not a source of truth. If it fails,
        // the CSV export can still import the active tab.
        try {
            const fallback = await readWithCsv(parsed);
            fallback.warnings.unshift(
                `Could not read Google's HTML view (${htmlError.message}). The importer used the CSV export instead, so only one tab is available and formatting is missing.`
            );
            fallback.fallbackReason = htmlError.message;
            return fallback;
        } catch (_) {
            throw htmlError;
        }
    }
}

export function isSheetsApiConfigured() {
    return Boolean(getSheetsApiKey());
}
