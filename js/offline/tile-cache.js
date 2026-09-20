// task-planner/js/offline/tile-cache.js

const DB_NAME = 'PGTaskPlanner_TileCache';
const DB_VERSION = 1;
const STORE_NAME = 'tiles';

let dbPromise = null;

function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                resolve(null);
                return;
            }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }
    return dbPromise;
}

/**
 * Get a cached tile blob from IndexedDB.
 */
export async function getCachedTile(key) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });
}

/**
 * Store a tile blob in IndexedDB.
 */
export async function setCachedTile(key, blob) {
    const db = await openDb();
    if (!db) return;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(blob, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Count how many tiles are stored offline.
 */
export async function getOfflineTileCount() {
    const db = await openDb();
    if (!db) return 0;
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
    });
}

/**
 * Clear all offline map tiles.
 */
export async function clearOfflineTiles() {
    const db = await openDb();
    if (!db) return;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Creates an offline-first Leaflet TileLayer subclass.
 * Automatically serves from IndexedDB when offline, and caches visited tiles when online.
 * 
 * @param {string} urlTemplate 
 * @param {Object} options 
 * @returns {L.TileLayer}
 */
export function createOfflineTileLayer(L, urlTemplate, options = {}) {
    const OfflineTileLayer = L.TileLayer.extend({
        createTile: function (coords, done) {
            const tile = document.createElement('img');
            tile.alt = '';
            tile.setAttribute('role', 'presentation');

            const key = `${options.layerId || 'base'}:${coords.z}:${coords.x}:${coords.y}`;
            const tileUrl = this.getTileUrl(coords);

            getCachedTile(key).then(cachedBlob => {
                if (cachedBlob) {
                    const objectUrl = URL.createObjectURL(cachedBlob);
                    tile.src = objectUrl;
                    tile.onload = () => {
                        done(null, tile);
                    };
                    tile.onerror = (e) => {
                        done(e, tile);
                    };
                } else {
                    // Try fetching online
                    fetch(tileUrl)
                        .then(res => {
                            if (!res.ok) throw new Error("Tile fetch failed");
                            return res.blob();
                        })
                        .then(blob => {
                            setCachedTile(key, blob).catch(() => {});
                            const objectUrl = URL.createObjectURL(blob);
                            tile.src = objectUrl;
                            tile.onload = () => done(null, tile);
                            tile.onerror = (e) => done(e, tile);
                        })
                        .catch(err => {
                            // If fetch failed (e.g. CORS or network error), try direct img src if online
                            if (typeof navigator !== 'undefined' && navigator.onLine) {
                                tile.onload = () => done(null, tile);
                                tile.onerror = () => {
                                    tile.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="%23222" opacity="0.4"/></svg>';
                                    done(null, tile);
                                };
                                tile.src = tileUrl;
                            } else {
                                tile.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="%23222" opacity="0.4"/></svg>';
                                done(null, tile);
                            }
                        });
                }
            });

            return tile;
        }
    });

    return new OfflineTileLayer(urlTemplate, options);
}

/**
 * Downloads all tiles within a bounding box for specified zoom levels.
 * 
 * @param {Object} bounds - { north, south, east, west }
 * @param {number} minZoom 
 * @param {number} maxZoom 
 * @param {string} urlTemplate 
 * @param {string} layerId 
 * @param {function} onProgress - callback(completed, total)
 * @returns {Promise<{ total: number, downloaded: number }>}
 */
export async function downloadAreaTiles({
    bounds,
    minZoom = 9,
    maxZoom = 13,
    urlTemplate = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    layerId = 'osm',
    onProgress
}) {
    const tilesToFetch = [];

    for (let z = minZoom; z <= maxZoom; z++) {
        const minX = lon2tile(bounds.west, z);
        const maxX = lon2tile(bounds.east, z);
        const minY = lat2tile(bounds.north, z);
        const maxY = lat2tile(bounds.south, z);

        for (let x = Math.min(minX, maxX); x <= Math.max(minX, maxX); x++) {
            for (let y = Math.min(minY, maxY); y <= Math.max(minY, maxY); y++) {
                tilesToFetch.push({ z, x, y });
            }
        }
    }

    const total = tilesToFetch.length;
    let completed = 0;

    // Concurrently fetch with a concurrency limit of 6
    const limit = 6;
    let index = 0;

    async function worker() {
        while (index < tilesToFetch.length) {
            const current = tilesToFetch[index++];
            const key = `${layerId}:${current.z}:${current.x}:${current.y}`;
            const existing = await getCachedTile(key);
            if (!existing) {
                const subdomains = ['a', 'b', 'c'];
                const s = subdomains[(current.x + current.y) % subdomains.length];
                const url = urlTemplate
                    .replace('{s}', s)
                    .replace('{z}', current.z)
                    .replace('{x}', current.x)
                    .replace('{y}', current.y);
                try {
                    const res = await fetch(url);
                    if (res.ok) {
                        const blob = await res.blob();
                        await setCachedTile(key, blob);
                    }
                } catch (e) {
                    // Ignore individual tile failures
                }
            }
            completed++;
            if (onProgress) onProgress(completed, total);
        }
    }

    const workers = [];
    for (let i = 0; i < limit; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    return { total, downloaded: completed };
}

function lon2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}
