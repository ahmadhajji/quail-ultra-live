const STATIC_CACHE = 'quail-live-static-v4'
const RUNTIME_CACHE = 'quail-live-runtime-v4'
const STATIC_ASSETS = [
  '/',
  '/overview.html',
  '/newblock.html',
  '/previousblocks.html',
  '/examview.html',
  '/quail-ui.css',
  '/TextHighlighter.js',
  '/vendor/jquery/dist/jquery.min.js',
  '/vendor/bootstrap/dist/css/bootstrap.min.css',
  '/vendor/bootstrap/dist/js/bootstrap.bundle.min.js',
  '/js/lib/live-api.js',
  '/js/lib/live-compat.js',
  '/js/pages/index.js',
  '/js/pages/overview.js',
  '/js/pages/newblock.js',
  '/js/pages/previousblocks.js',
  '/js/pages/examview.js',
  '/branding/quail-ultra.png'
]

self.addEventListener('install', function onInstall(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function cacheAssets(cache) {
      return cache.addAll(STATIC_ASSETS)
    })
  )
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

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(function fromStatic(cached) {
        return cached || fetch(request)
      })
    )
  }
})
