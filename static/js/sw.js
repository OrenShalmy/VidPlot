const CACHE_NAME = 'vidplot-v4';
const ASSETS_TO_CACHE = [
	'/',
	'/static/css/style.css',
	'/static/js/plotly.js',
	'/static/js/player.js',
	'/static/js/upload.js',
	'/static/js/config.js',
	'/static/js/mediainfo.js',
	'https://cdn.plot.ly/plotly-latest.min.js'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => cache.addAll(ASSETS_TO_CACHE))
	);
});

self.addEventListener('fetch', (event) => {
	event.respondWith(
		caches.match(event.request)
			.then((response) => {
				if (response) {
					return response;
				}
				return fetch(event.request);
			})
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
		})
	);
});