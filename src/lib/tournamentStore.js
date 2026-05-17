const DB_NAME = 'swiss-pairing';
const DB_VERSION = 4;
const STORE_NAME = 'players';
const MAPPINGS_STORE_NAME = 'mappings';
const CARD_GEN_STORE_NAME = 'card-gen';
const CONFIG_STORE_NAME = 'configs';
const ROUNDS_STORE_NAME = 'rounds';

// Key mappings for backward compatibility
const getPlayersKey = (tId) => tId === 'default' ? 'players' : `${tId}_players`;
const getMappingKey = (tId) => tId === 'default' ? 'clubFedMapping' : `${tId}_clubFedMapping`;
const getCardAssetKey = (tId, key) => tId === 'default' ? key : `${tId}_${key}`;
const getConfigKey = (tId) => tId === 'default' ? 'tournamentConfig' : `${tId}_tournamentConfig`;
const getRoundsKey = (tId) => tId === 'default' ? 'tournamentRounds' : `${tId}_tournamentRounds`;

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
        if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
            db.createObjectStore(CONFIG_STORE_NAME);
        }
        if (!db.objectStoreNames.contains(ROUNDS_STORE_NAME)) {
            db.createObjectStore(ROUNDS_STORE_NAME);
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

const SKIP_IMPORT_VALUE = Symbol('skip-import-value');
const SERIALIZED_CARD_ASSET_MARKER = 'swiss-pairing-card-asset-v1';

function isBlobValue(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

function getCardGenBinaryAssetType(key) {
    const normalizedKey = String(key || '');
    if (normalizedKey === 'image' || normalizedKey.endsWith('_image') || normalizedKey.endsWith('-image')) return 'image';
    if (normalizedKey === 'font' || normalizedKey.endsWith('_font') || normalizedKey.endsWith('-font')) return 'font';
    return null;
}

function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function dataUrlToBlob(dataUrl, fallbackType = '') {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return fallbackType && blob.type !== fallbackType
        ? blob.slice(0, blob.size, fallbackType)
        : blob;
}

async function serializeStoreValue(storeName, key, value) {
    const assetType = storeName === CARD_GEN_STORE_NAME ? getCardGenBinaryAssetType(key) : null;
    if (!assetType || !isBlobValue(value)) return value;

    return {
        __type: SERIALIZED_CARD_ASSET_MARKER,
        assetType,
        name: value.name || '',
        mimeType: value.type || '',
        lastModified: typeof value.lastModified === 'number' ? value.lastModified : null,
        dataUrl: await readBlobAsDataUrl(value),
    };
}

async function deserializeStoreValue(storeName, key, value) {
    const assetType = storeName === CARD_GEN_STORE_NAME ? getCardGenBinaryAssetType(key) : null;
    if (!assetType) return value;
    if (!value) return SKIP_IMPORT_VALUE;
    if (isBlobValue(value)) return value;

    if (
        value
        && typeof value === 'object'
        && value.__type === SERIALIZED_CARD_ASSET_MARKER
        && typeof value.dataUrl === 'string'
    ) {
        let blob;
        try {
            blob = await dataUrlToBlob(value.dataUrl, value.mimeType || '');
        } catch (_) {
            return SKIP_IMPORT_VALUE;
        }
        const fileName = value.name || `${assetType}.${assetType === 'font' ? 'bin' : 'png'}`;

        if (typeof File !== 'undefined') {
            return new File([blob], fileName, {
                type: value.mimeType || blob.type,
                lastModified: typeof value.lastModified === 'number' ? value.lastModified : Date.now(),
            });
        }

        return blob;
    }

    return SKIP_IMPORT_VALUE;
}

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

export const loadTournamentConfig = async (tournamentId = 'default') => {
    try {
        return await runStore(CONFIG_STORE_NAME, 'readonly', store => new Promise((resolve, reject) => {
            const request = store.get(getConfigKey(tournamentId));
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        }));
    } catch (_) {
        return null;
    }
};

export const saveTournamentConfig = async (config, tournamentId = 'default') => {
    try {
        await runStore(CONFIG_STORE_NAME, 'readwrite', store => store.put(config, getConfigKey(tournamentId)));
    } catch (_) {
    }
};

export const loadRounds = async (tournamentId = 'default') => {
    try {
        return await runStore(ROUNDS_STORE_NAME, 'readonly', store => new Promise((resolve, reject) => {
            const request = store.get(getRoundsKey(tournamentId));
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        }));
    } catch (_) {
        return [];
    }
};

export const saveRounds = async (rounds, tournamentId = 'default') => {
    try {
        await runStore(ROUNDS_STORE_NAME, 'readwrite', store => store.put(rounds, getRoundsKey(tournamentId)));
    } catch (_) {
    }
};

export async function deleteTournamentConfig(tournamentId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONFIG_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(CONFIG_STORE_NAME);
        const request = store.delete(getConfigKey(tournamentId));
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function deleteRounds(tournamentId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(ROUNDS_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(ROUNDS_STORE_NAME);
        const request = store.delete(getRoundsKey(tournamentId));
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

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
        await copyStoreData(CONFIG_STORE_NAME, getConfigKey(sourceId), getConfigKey(targetId), true);
        await copyStoreData(ROUNDS_STORE_NAME, getRoundsKey(sourceId), getRoundsKey(targetId), true);

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
        await deleteStoreData(CONFIG_STORE_NAME, getConfigKey(tournamentId), true);
        await deleteStoreData(ROUNDS_STORE_NAME, getRoundsKey(tournamentId), true);

    } catch (e) {
        console.error("Failed to delete tournament data", e);
    }
};

export const exportAllData = async () => {
    try {
        const db = await openDb();
        
        const readStoreEntries = (storeName) => {
            return new Promise((resolve, reject) => {
                const entries = [];
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const request = store.openCursor();
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        entries.push({ key: cursor.key, value: cursor.value });
                        cursor.continue();
                    } else {
                        resolve(entries);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        };

        const exportStore = async (storeName) => {
            const entries = await readStoreEntries(storeName);
            return Promise.all(entries.map(async item => ({
                key: item.key,
                value: await serializeStoreValue(storeName, item.key, item.value),
            })));
        };

        const data = {
            players: await exportStore(STORE_NAME),
            mappings: await exportStore(MAPPINGS_STORE_NAME),
            cardGen: await exportStore(CARD_GEN_STORE_NAME),
            configs: await exportStore(CONFIG_STORE_NAME),
            rounds: await exportStore(ROUNDS_STORE_NAME)
        };

        return data;
    } catch (e) {
        console.error("Failed to export all data", e);
        return null;
    }
};

export const importAllData = async (data) => {
    try {
        const db = await openDb();

        const importStore = async (storeName, arrayRef) => {
            const items = Array.isArray(arrayRef) ? arrayRef : [];
            const preparedItems = await Promise.all(items.map(async item => ({
                key: item.key,
                value: await deserializeStoreValue(storeName, item.key, item.value),
            })));

            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                
                // Clear existing data
                store.clear();

                if (preparedItems.length > 0) {
                    preparedItems.forEach(item => {
                        if (item.value === SKIP_IMPORT_VALUE) return;
                        store.put(item.value, item.key);
                    });
                }

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        };

        await importStore(STORE_NAME, data.players || []);
        await importStore(MAPPINGS_STORE_NAME, data.mappings || []);
        await importStore(CARD_GEN_STORE_NAME, data.cardGen || []);
        await importStore(CONFIG_STORE_NAME, data.configs || []);
        await importStore(ROUNDS_STORE_NAME, data.rounds || []);
        
        return true;
    } catch (e) {
        console.error("Failed to import all data", e);
        return false;
    }
};

export const clearAllData = async () => {
    try {
        const db = await openDb();

        const clearStore = (storeName) => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                store.clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        };

        await clearStore(STORE_NAME);
        await clearStore(MAPPINGS_STORE_NAME);
        await clearStore(CARD_GEN_STORE_NAME);
        await clearStore(CONFIG_STORE_NAME);
        await clearStore(ROUNDS_STORE_NAME);

        return true;
    } catch (e) {
        console.error("Failed to clear all data", e);
        return false;
    }
};
