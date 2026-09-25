// task-planner/sw.js
const CACHE_NAME = 'pg-task-planner-v9';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/styles.css',
    './icon-192.png',
    './icon-512.png',
    './lib/leaflet.js',
    './lib/leaflet.css',
    './lib/qrcode.min.js',
    './lib/html5-qrcode.min.js',
    './js/app.js',
    './js/default-waypoints.js',
    './js/geo-math.js',
    './js/parsers/cup-parser.js',
    './js/parsers/wpt-parser.js',
    './js/optimizer/task-optimizer.js',
    './js/optimizer/randomizer-solver.js',
    './js/optimizer/reverse-cycle.js',
    './js/drawing/freehand-tracer.js',
    './js/qr/xctrack-qr.js',
    './js/offline/tile-cache.js',
    './js/ui/map-controller.js',
    './js/ui/task-sheet.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Completely bypass Service Worker for all external requests (all map tile servers)
    if (url.origin !== self.location.origin) {
        return;
    }

    // Network-first with cache fallback for local app shell
    // Guarantees immediate fresh updates when online, 100% offline capability when offline!
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});
