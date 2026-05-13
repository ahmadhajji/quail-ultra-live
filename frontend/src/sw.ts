/// <reference lib="webworker" />
// @ts-nocheck
export {}

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

self.addEventListener('message', function onMessage(event) {
  if (event.data?.type !== 'CLEAR_PACK_CACHES') {
    return
  }
  event.waitUntil(caches.delete(RUNTIME_CACHE))
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
        return fetch(request).then(function fromNetwork(response) {
          if (response.ok) {
            cache.put(request, response.clone())
          }
          return response
        }).catch(function fromCache(error) {
          return cache.match(request).then(function resolveCached(cached) {
            if (cached) {
              return cached
            }
            throw error
          })
        })
      })
    )
    return
  }

  const isNavigation = request.mode === 'navigate'
  const isStaticAsset = url.pathname === '/' ||
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/sw.js' ||
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
