const CACHE_NAME = 'reigh-v3';
const EXTENSION_RELEASE_CONFIG_PATH = '/runtime-config/v1/extensions.json';

// Only cache essential static assets, not dynamic content
const urlsToCache = [
  '/manifest.json',
  '/favicon-192x192.png',
  '/lovable-uploads/e2fca7b4-10e4-4ee5-bc85-34d85d75e502.png'
];

// Install event - cache only essential resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        // Don't wait for all resources to cache - fail gracefully
        return Promise.allSettled(
          urlsToCache.map(url => 
            cache.add(url).catch(err => console.log(`Failed to cache ${url}:`, err))
          )
        );
      })
  );
  // Don't wait for old service worker to finish
  self.skipWaiting();
});

// Fetch event - network first, cache as fallback (better for dynamic apps)
self.addEventListener('fetch', event => {
  // Skip non-GET requests and chrome-extension requests
  if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
    return;
  }

  // The extension kill switch is deployment-owned and must fail closed at the
  // page loader. Never cache it and never provide an offline fallback: replaying
  // an older enabled document would defeat an emergency rollback.
  if (new URL(event.request.url).pathname === EXTENSION_RELEASE_CONFIG_PATH) {
    return;
  }

  // For API calls and dynamic content, always go to network first
  if (event.request.url.includes('/api/') || 
      event.request.url.includes('supabase.co') ||
      event.request.url.includes('lovable.dev') ||
      event.request.url.includes('gpteng.co')) {
    return; // Let these bypass the service worker entirely
  }

  event.respondWith(
    // Try network first for better performance with dynamic content
    fetch(event.request)
      .then(response => {
        // If successful, optionally cache static assets for future offline use
        if (response.status === 200 && event.request.url.includes(self.location.origin)) {
          // Only cache small static assets, not media/blobs
          const contentType = response.headers.get('content-type') || '';
          const isLargeMedia = contentType.startsWith('video/') || contentType.startsWith('audio/');
          const isBlob = event.request.url.includes('/storage/') || event.request.url.includes('/object/');
          if (!isLargeMedia && !isBlob) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone).catch(() => {
                // Storage quota exceeded or cache error — ignore gracefully
              });
            });
          }
        }
        return response;
      })
      .catch(() => {
        // Only fall back to cache if network fails
        return caches.match(event.request).then(response => {
          return response || new Response('', {
            status: 404,
            statusText: 'Not Found'
          });
        });
      })
  );
});

// Activate event - clean up and take control immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});
