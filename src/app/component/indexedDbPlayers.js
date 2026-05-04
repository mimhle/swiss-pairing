const DB_NAME = 'swiss-pairing';
const DB_VERSION = 1;
const STORE_NAME = 'players';
const PLAYERS_KEY = 'players';

const openDb = () => new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
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

