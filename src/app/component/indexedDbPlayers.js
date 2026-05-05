const DB_NAME = 'swiss-pairing';
const DB_VERSION = 3;
const STORE_NAME = 'players';
const MAPPINGS_STORE_NAME = 'mappings';
const CARD_GEN_STORE_NAME = 'card-gen';

// Key mappings for backward compatibility
const getPlayersKey = (tId) => tId === 'default' ? 'players' : `${tId}_players`;
const getMappingKey = (tId) => tId === 'default' ? 'clubFedMapping' : `${tId}_clubFedMapping`;
const getCardAssetKey = (tId, key) => tId === 'default' ? key : `${tId}_${key}`;

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
        if (!db.objectStoreNames.contains(CARD_GEN_STORE_NAME)) {
            db.createObjectStore(CARD_GEN_STORE_NAME);
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const runStore = async (storeName, mode, fn) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = fn(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
    });
};

export const loadPlayers = async (tournamentId = 'default') => {
    try {
        return await runStore(STORE_NAME, 'readonly', store => new Promise((resolve, reject) => {
            const request = store.get(getPlayersKey(tournamentId));
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        }));
    } catch (_) {
        return [];
    }
};

export const savePlayers = async (players, tournamentId = 'default') => {
    try {
        await runStore(STORE_NAME, 'readwrite', store => store.put(players, getPlayersKey(tournamentId)));
    } catch (_) {
        // Ignore save failures (e.g., storage blocked).
    }
};

export const loadClubFedMapping = async (tournamentId = 'default') => {
    try {
        return await runStore(MAPPINGS_STORE_NAME, 'readonly', store => new Promise((resolve, reject) => {
            const request = store.get(getMappingKey(tournamentId));
            request.onsuccess = () => resolve(request.result || {});
            request.onerror = () => reject(request.error);
        }));
    } catch (_) {
        return {};
    }
};

export const saveClubFedMapping = async (mapping, tournamentId = 'default') => {
    try {
        await runStore(MAPPINGS_STORE_NAME, 'readwrite', store => store.put(mapping, getMappingKey(tournamentId)));
    } catch (_) {
        // Ignore save failures (e.g., storage blocked).
    }
};

export const loadCardGenAsset = async (key, tournamentId = 'default') => {
    try {
        return await runStore(CARD_GEN_STORE_NAME, 'readonly', store => new Promise((resolve, reject) => {
            const request = store.get(getCardAssetKey(tournamentId, key));
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        }));
    } catch (_) {
        return null;
    }
};

export const saveCardGenAsset = async (key, data, tournamentId = 'default') => {
    try {
        await runStore(CARD_GEN_STORE_NAME, 'readwrite', store => store.put(data, getCardAssetKey(tournamentId, key)));
    } catch (_) {
    }
};

// --- Tournament Management Helpers ---

export const duplicateTournamentData = async (sourceId, targetId) => {
    try {
        const db = await openDb();

        const copyStoreData = (storeName, sourceKeyPrefix, targetKeyPrefix, isExactMatch = false) => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.openCursor();
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const key = String(cursor.key);
                        let shouldCopy = false;
                        let newKey = null;

                        if (isExactMatch) {
                            if (key === sourceKeyPrefix) {
                                shouldCopy = true;
                                newKey = targetKeyPrefix;
                            }
                        } else {
                            // For prefix matches (e.g. card assets)
                            // "default" tournament doesn't have a prefix, so we copy keys that DON'T have an underscore prefix for another tournament.
                            // If sourceId is not default, we look for `${sourceId}_` prefix.
                            if (sourceId === 'default') {
                                if (!key.includes('_')) { // simplistic heuristic: if it doesn't have an underscore, it belongs to 'default'
                                    shouldCopy = true;
                                    newKey = getCardAssetKey(targetId, key);
                                } else if (key.startsWith('card-gen-')) { // In case we used 'card-gen-' without tournament prefix for default
                                    shouldCopy = true;
                                    newKey = getCardAssetKey(targetId, key);
                                }
                            } else if (key.startsWith(`${sourceId}_`)) {
                                shouldCopy = true;
                                const originalKey = key.substring(sourceId.length + 1);
                                newKey = getCardAssetKey(targetId, originalKey);
                            }
                        }

                        if (shouldCopy && newKey) {
                            store.put(cursor.value, newKey);
                        }
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                request.onerror = () => reject(request.error);
            });
        };

        await copyStoreData(STORE_NAME, getPlayersKey(sourceId), getPlayersKey(targetId), true);
        await copyStoreData(MAPPINGS_STORE_NAME, getMappingKey(sourceId), getMappingKey(targetId), true);
        await copyStoreData(CARD_GEN_STORE_NAME, sourceId, targetId, false);

    } catch (e) {
        console.error("Failed to duplicate tournament data", e);
    }
};

export const deleteTournamentData = async (tournamentId) => {
    try {
        const db = await openDb();

        const deleteStoreData = (storeName, keyPrefix, isExactMatch = false) => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.openCursor();
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const key = String(cursor.key);
                        let shouldDelete = false;

                        if (isExactMatch) {
                            if (key === keyPrefix) shouldDelete = true;
                        } else {
                            if (tournamentId === 'default') {
                                if (!key.includes('_') || key.startsWith('card-gen-')) shouldDelete = true;
                            } else if (key.startsWith(`${tournamentId}_`)) {
                                shouldDelete = true;
                            }
                        }

                        if (shouldDelete) cursor.delete();
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                request.onerror = () => reject(request.error);
            });
        };

        await deleteStoreData(STORE_NAME, getPlayersKey(tournamentId), true);
        await deleteStoreData(MAPPINGS_STORE_NAME, getMappingKey(tournamentId), true);
        await deleteStoreData(CARD_GEN_STORE_NAME, tournamentId, false);

    } catch (e) {
        console.error("Failed to delete tournament data", e);
    }
};
