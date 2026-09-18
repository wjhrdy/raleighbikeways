var CACHE_NAME = "bikeways-cache-v2";
var urlsToCache = [
    '/',
    '/styles.css',
    '/data/caryFacilities.geojson',
    '/data/caryGreenways.geojson',
    '/data/durham_shared.geojson',
    '/data/osm_durham.geojson',
    '/img/bike_lane.jpg',
    '/img/citrix.jpg',
    '/img/marginal-greenway-1.jpg',
    '/img/marginal-greenway-2.jpg',
    '/img/sidepath.jpg',
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

// Refresh the app shell on every online visit; keep the last good copy offline.
// Only cache our explicit static assets. APIs, routing POSTs, and third-party
// requests must keep their normal network behavior.
self.addEventListener('fetch', function (event) {
    var url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    var isPage = event.request.mode === 'navigate' &&
        (url.pathname === '/' || url.pathname === '/index.html');
    if (!isPage && urlsToCache.indexOf(url.pathname) === -1) return;
    var cacheKey = isPage ? '/' : event.request;

    var responsePromise = fetch(event.request, { cache: 'no-cache' }).then(function (response) {
        if (!response.ok) throw new Error('Unable to refresh cached asset');
        return response;
    });
    event.waitUntil(responsePromise.then(function (response) {
        var copy = response.clone();
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.put(cacheKey, copy);
        });
    }).catch(function () {
        // Offline or cache storage unavailable: retain the last successful copy.
    }));
    event.respondWith(responsePromise.catch(function (error) {
        return caches.open(CACHE_NAME).then(function (cache) {
            return cache.match(cacheKey);
        }).then(function (cached) {
            if (cached) return cached;
            throw error;
        });
    }));
});

self.addEventListener('activate', function (event) {
    event.waitUntil(caches.keys().then(function (cacheNames) {
        return Promise.all(cacheNames.filter(function (name) {
            return name.indexOf('bikeways-cache-') === 0 && name !== CACHE_NAME;
        }).map(function (name) {
            return caches.delete(name);
        }));
    }));
});
