const NETWORK_TIMEOUT = 1000; // 1 Sec

const dynamicCacheName = 'site-dynamic-v1';
const staticCacheName = 'site-static-v1';
const staticCacheAssets = [
   '/assets/audio/AlertTone.mp3',
];

self.addEventListener('install', (e) => {
   e.waitUntil(
      caches.open(staticCacheName).then((cache) => {
         return cache.addAll(staticCacheAssets);
      })
   );
});

self.addEventListener('activate', (e) => {
   e.waitUntil(
      caches.keys().then((keys) => {
         return Promise.all(
            keys.filter(key => ![dynamicCacheName, staticCacheName].includes(key))
            .map(key => caches.delete(key))
         );
      })
   );
});

// Dummy fetch handler
self.addEventListener('fetch', (e) => {
   if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin ||
       e.request.headers.has('Range')) {
      return;
   }

      // Try to always load the latest conect from the server amd cache it...
      // but after NETWORK_TIMEOUT (ms), load from the cache instead so the
      // UI isn't left hanging. If the fetch request subsequently completes,
      // the cache will be updated for next time. If the entry is not found in
      // the cache, then fall back to continuing to wait for the fetch to
      // complete.
      e.respondWith(
         caches.open(dynamicCacheName).then((cache) => {
            let fetchPromise = fetch(e.request).then((fetchResp) => {
               if (fetchResp.ok && fetchResp.type === 'basic') {
                  cache.put(e.request, fetchResp.clone());
               }
               return fetchResp;
            });

            return Promise.race([
               fetchPromise,
               new Promise((resolve, reject) => setTimeout(reject, NETWORK_TIMEOUT)),
            ]).catch(() => {
               return cache.match(e.request).then((cacheResp) => {
                  return cacheResp || fetchPromise;
               });
            });
         })
      );
});
