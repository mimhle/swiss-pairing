const DB_NAME = 'swiss-pairing';
const DB_VERSION = 2;
const STORE_NAME = 'players';
const PLAYERS_KEY = 'players';
const MAPPINGS_STORE_NAME = 'mappings';
const CLUB_FED_MAPPING_KEY = 'clubFedMapping';

const openDb = () => new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(MAPPINGS_STORE_NAME)) {
            db.createObjectStore(MAPPINGS_STORE_NAME);
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const runStore = async (mode, fn) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const result = fn(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
    });
};

export const loadPlayers = async () => {
    try {
        return await runStore('readonly', store => new Promise((resolve, reject) => {
            const request = store.get(PLAYERS_KEY);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        }));
    } catch (_) {
        return [];
    }
};

export const savePlayers = async (players) => {
    try {
        await runStore('readwrite', store => store.put(players, PLAYERS_KEY));
    } catch (_) {
        // Ignore save failures (e.g., storage blocked).
    }
};

const runMappingStore = async (mode, fn) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(MAPPINGS_STORE_NAME, mode);
        const store = tx.objectStore(MAPPINGS_STORE_NAME);
        const result = fn(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
    });
};

export const loadClubFedMapping = async () => {
    try {
        return await runMappingStore('readonly', store => new Promise((resolve, reject) => {
            const request = store.get(CLUB_FED_MAPPING_KEY);
            request.onsuccess = () => resolve(request.result || {});
            request.onerror = () => reject(request.error);
        }));
    } catch (_) {
        return {};
    }
};

export const saveClubFedMapping = async (mapping) => {
    try {
        await runMappingStore('readwrite', store => store.put(mapping, CLUB_FED_MAPPING_KEY));
    } catch (_) {
        // Ignore save failures (e.g., storage blocked).
    }
};
