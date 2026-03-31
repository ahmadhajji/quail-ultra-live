const STATIC_CACHE = 'quail-live-static-v5'
const RUNTIME_CACHE = 'quail-live-runtime-v5'

self.addEventListener('install', function onInstall(event) {
  self.skipWaiting()
})

self.addEventListener('activate', function onActivate(event) {
  event.waitUntil(
    caches.keys().then(function removeOldCaches(keys) {
      return Promise.all(keys.map(function removeOldCache(key) {
        if (key !== STATIC_CACHE && key !== RUNTIME_CACHE) {
          return caches.delete(key)
        }
        return Promise.resolve()
      }))
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', function onFetch(event) {
  const request = event.request
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return
  }

  if (url.pathname.startsWith('/api/study-packs/') && url.pathname.includes('/file/')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(function runtimeCache(cache) {
        return cache.match(request).then(function fromCache(cached) {
          if (cached) {
            return cached
          }
          return fetch(request).then(function fromNetwork(response) {
            cache.put(request, response.clone())
            return response
          })
        })
      })
    )
    return
  }

  const isNavigation = request.mode === 'navigate'
  const isStaticAsset = url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/quail-ui.css' ||
    url.pathname === '/TextHighlighter.js' ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.startsWith('/branding/')

  if (isNavigation || isStaticAsset) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(function staticCache(cache) {
        return fetch(request)
          .then(function fromNetwork(response) {
            cache.put(request, response.clone())
            return response
          })
          .catch(function fromCache() {
            return cache.match(request).then(function resolveCached(cached) {
              return cached || caches.match('/')
            })
          })
      })
    )
  }
})
