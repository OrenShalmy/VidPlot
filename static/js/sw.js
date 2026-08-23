const CACHE_NAME = 'vidplot-v5';
const ASSETS_TO_CACHE = [
	'/static/js/plotly.js',
	'/static/js/player.js',
	'/static/js/upload.js',
	'/static/js/config.js',
	'/static/js/mediainfo.js',
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => cache.addAll(ASSETS_TO_CACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);
	// Always network-first for HTML and versioned CSS/JS so UI updates show up
	const isNavigate = req.mode === 'navigate' || url.pathname === '/';
	const isUiAsset = /\.(?:css|js)$/.test(url.pathname);
	if (isNavigate || isUiAsset) {
		event.respondWith(
			fetch(req).catch(() => caches.match(req))
		);
		return;
	}
	event.respondWith(
		caches.match(req).then((response) => response || fetch(req))
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames.map((cacheName) => {
					if (cacheName !== CACHE_NAME) {
						return caches.delete(cacheName);
					}
				})
			);
		}).then(() => self.clients.claim())
	);
});
