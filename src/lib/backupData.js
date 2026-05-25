import { exportAllData, importAllData } from "@/lib/tournamentStore";
import { LOCAL_DATA_UPDATED_AT_KEY } from "@/lib/dataChangeSignal";

export const BACKUP_VERSION = 1;

const LOCAL_STORAGE_KEYS = [
    "swiss_tournaments",
    "swiss_active_tournament",
];

function sortForHash(value) {
    if (Array.isArray(value)) {
        return value.map(sortForHash);
    }
    if (!value || typeof value !== "object") {
        return value;
    }

    return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
            acc[key] = sortForHash(value[key]);
            return acc;
        }, {});
}

function getBackupCore(data) {
    return {
        version: data?.version,
        localStorage: {
            swiss_tournaments: data?.localStorage?.swiss_tournaments ?? null,
            swiss_active_tournament: data?.localStorage?.swiss_active_tournament ?? null,
        },
        indexedDB: data?.indexedDB ?? null,
    };
}

async function sha256(text) {
    if (typeof crypto === "undefined" || !crypto.subtle) {
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        return `fallback-${Math.abs(hash)}`;
    }

    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

export async function getBackupHash(data) {
    const stableJson = JSON.stringify(sortForHash(getBackupCore(data)));
    return sha256(stableJson);
}

export function isValidBackupEnvelope(data) {
    return Boolean(
        data
        && data.version
        && data.localStorage
        && data.indexedDB
    );
}

export async function createBackupEnvelope() {
    const indexedDBData = await exportAllData();
    if (!indexedDBData) {
        throw new Error("Failed to export database data.");
    }

    const backup = {
        version: BACKUP_VERSION,
        localStorage: Object.fromEntries(
            LOCAL_STORAGE_KEYS.map(key => [key, localStorage.getItem(key)])
        ),
        indexedDB: indexedDBData,
        localUpdatedAt: localStorage.getItem(LOCAL_DATA_UPDATED_AT_KEY) || "",
        createdAt: new Date().toISOString(),
    };

    backup.sourceHash = await getBackupHash(backup);
    return backup;
}

export async function restoreBackupEnvelope(data) {
    if (!isValidBackupEnvelope(data)) {
        throw new Error("Invalid backup file format.");
    }

    LOCAL_STORAGE_KEYS.forEach((key) => {
        const value = data.localStorage[key];
        if (typeof value === "string") {
            localStorage.setItem(key, value);
        } else {
            localStorage.removeItem(key);
        }
    });

    const success = await importAllData(data.indexedDB);
    if (!success) {
        throw new Error("Failed to restore database data.");
    }

    return true;
}

export async function parseBackupJson(text) {
    const data = JSON.parse(text);
    if (!isValidBackupEnvelope(data)) {
        throw new Error("Invalid backup file format.");
    }

    if (!data.sourceHash) {
        data.sourceHash = await getBackupHash(data);
    }

    return data;
}
