(function bootstrapQuailLive(window) {
  const DB_NAME = 'quail-ultra-live'
  const DB_VERSION = 1
  const PACK_STORE = 'packs'
  const DIRTY_STORE = 'dirty-progress'
  const STORE_PREFIX = 'quail-live:store:'
  const WARM_PREFIX = 'quail-live:warm:'

  let dbPromise
  let syncBanner
  let sessionCache

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function initialize(resolve, reject) {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION)
        request.onerror = function onError() {
          reject(request.error)
        }
        request.onupgradeneeded = function onUpgrade() {
          const db = request.result
          if (!db.objectStoreNames.contains(PACK_STORE)) {
            db.createObjectStore(PACK_STORE, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(DIRTY_STORE)) {
            db.createObjectStore(DIRTY_STORE, { keyPath: 'packId' })
          }
        }
        request.onsuccess = function onSuccess() {
          resolve(request.result)
        }
      })
    }
    return dbPromise
  }

  async function idbGet(storeName, key) {
    const db = await openDb()
    return new Promise(function resolveRequest(resolve, reject) {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).get(key)
      request.onerror = function onError() {
        reject(request.error)
      }
      request.onsuccess = function onSuccess() {
        resolve(request.result || null)
      }
    })
  }

  async function idbPut(storeName, value) {
    const db = await openDb()
    return new Promise(function resolveRequest(resolve, reject) {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(value)
      tx.oncomplete = function onComplete() {
        resolve()
      }
      tx.onerror = function onError() {
        reject(tx.error)
      }
    })
  }

  async function idbDelete(storeName, key) {
    const db = await openDb()
    return new Promise(function resolveRequest(resolve, reject) {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).delete(key)
      tx.oncomplete = function onComplete() {
        resolve()
      }
      tx.onerror = function onError() {
        reject(tx.error)
      }
    })
  }

  async function idbGetAll(storeName) {
    const db = await openDb()
    return new Promise(function resolveRequest(resolve, reject) {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).getAll()
      request.onerror = function onError() {
        reject(request.error)
      }
      request.onsuccess = function onSuccess() {
        resolve(request.result || [])
      }
    })
  }

  function buildPackFileUrl(packId, relativePath) {
    return `/api/study-packs/${packId}/file/${relativePath.split('/').map(encodeURIComponent).join('/')}`
  }

  async function request(url, options) {
    const response = await window.fetch(url, Object.assign({ credentials: 'include' }, options || {}))
    const contentType = response.headers.get('content-type') || ''
    let body = null

    if (contentType.includes('application/json')) {
      body = await response.json()
    } else if (!response.ok) {
      body = { error: await response.text() }
    }

    if (!response.ok) {
      const error = new Error(body && body.error ? body.error : `Request failed with ${response.status}`)
      error.status = response.status
      error.body = body
      throw error
    }

    return body
  }

  function showSyncBanner(mode, text) {
    if (!syncBanner) {
      syncBanner = document.createElement('div')
      syncBanner.id = 'syncBanner'
      syncBanner.className = 'sync-banner sync-banner-hidden'
      document.body.appendChild(syncBanner)
    }

    if (!text) {
      syncBanner.className = 'sync-banner sync-banner-hidden'
      syncBanner.textContent = ''
      return
    }

    syncBanner.className = `sync-banner sync-banner-${mode || 'info'}`
    syncBanner.textContent = text
  }

  function getCurrentPackId() {
    const params = new URLSearchParams(window.location.search)
    return params.get('pack')
  }

  function getCurrentBlockKey() {
    const params = new URLSearchParams(window.location.search)
    return params.get('block') || ''
  }

  function buildPageUrl(pageName, params) {
    const url = new URL(pageName === 'index' ? '/' : `/${pageName}.html`, window.location.origin)
    Object.keys(params || {}).forEach(function appendParam(key) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        url.searchParams.set(key, params[key])
      }
    })
    return `${url.pathname}${url.search}`
  }

  function navigate(pageName, params) {
    window.location.href = buildPageUrl(pageName, params)
  }

  async function getSession(force) {
    if (!force && sessionCache !== undefined) {
      return sessionCache
    }
    const payload = await request('/api/auth/session')
    sessionCache = payload.user || null
    return sessionCache
  }

  async function login(username, password) {
    const payload = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    })
    sessionCache = payload.user
    return payload.user
  }

  async function register(username, password) {
    const payload = await request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    })
    sessionCache = payload.user
    return payload.user
  }

  async function logout() {
    await request('/api/auth/logout', { method: 'POST' })
    sessionCache = null
  }

  async function listStudyPacks() {
    const payload = await request('/api/study-packs')
    return payload.packs
  }

  async function importStudyPack(formData) {
    const response = await window.fetch('/api/study-packs/import', {
      method: 'POST',
      credentials: 'include',
      body: formData
    })
    const payload = await response.json()
    if (!response.ok) {
      const error = new Error(payload.error || 'Import failed')
      error.status = response.status
      error.body = payload
      throw error
    }
    return payload.pack
  }

  async function deleteStudyPack(packId) {
    await request(`/api/study-packs/${packId}`, { method: 'DELETE' })
    await idbDelete(PACK_STORE, packId)
    await idbDelete(DIRTY_STORE, packId)
  }

  async function getPackCache(packId) {
    return idbGet(PACK_STORE, packId)
  }

  async function setPackCache(packId, qbankinfo, packMeta) {
    await idbPut(PACK_STORE, {
      id: packId,
      qbankinfo: qbankinfo,
      packMeta: packMeta || null,
      updatedAt: new Date().toISOString()
    })
  }

  async function setDirtyProgress(packId, progress, baseRevision) {
    await idbPut(DIRTY_STORE, {
      packId: packId,
      progress: progress,
      baseRevision: baseRevision
    })
  }

  async function fetchQbankInfo(packId, blockKey) {
    const query = blockKey ? `?block=${encodeURIComponent(blockKey)}` : ''
    const payload = await request(`/api/study-packs/${packId}/qbankinfo${query}`)
    await setPackCache(packId, payload.qbankinfo, payload.pack)
    return payload.qbankinfo
  }

  async function loadPack(packId, blockKey) {
    try {
      const qbankinfo = await fetchQbankInfo(packId, blockKey)
      warmPackInBackground(packId, qbankinfo.revision)
      return qbankinfo
    } catch (error) {
      const cached = await getPackCache(packId)
      if (cached && cached.qbankinfo) {
        const qbankinfo = Object.assign({}, cached.qbankinfo, {
          blockToOpen: blockKey || ''
        })
        showSyncBanner('warning', 'Offline mode: using the cached study pack on this device.')
        return qbankinfo
      }
      throw error
    }
  }

  async function warmPackInBackground(packId, revision) {
    if (!window.navigator.onLine) {
      return
    }

    const warmKey = `${WARM_PREFIX}${packId}`
    if (window.localStorage.getItem(warmKey) === String(revision)) {
      return
    }

    try {
      const payload = await request(`/api/study-packs/${packId}/manifest`)
      for (const relativePath of payload.files) {
        await window.fetch(buildPackFileUrl(packId, relativePath), {
          credentials: 'include',
          cache: 'reload'
        })
      }
      window.localStorage.setItem(warmKey, String(revision))
    } catch (error) {
      console.warn('Unable to warm study-pack files for offline use.', error)
    }
  }

  async function updateCachedProgress(packId, progress, revision) {
    const cached = await getPackCache(packId)
    if (!cached || !cached.qbankinfo) {
      return
    }
    cached.qbankinfo.progress = progress
    if (revision !== undefined) {
      cached.qbankinfo.revision = revision
    }
    await setPackCache(packId, cached.qbankinfo, cached.packMeta)
  }

  async function resolveConflict(packId, progress, conflictPayload) {
    const useLocal = window.confirm(
      'A newer version of this study pack exists on the server.\n\nPress OK to keep your local changes and overwrite the server.\nPress Cancel to discard local changes and reload the server version.'
    )

    if (useLocal) {
      const payload = await request(`/api/study-packs/${packId}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progress: progress,
          baseRevision: conflictPayload.serverRevision,
          force: true
        })
      })
      await updateCachedProgress(packId, progress, payload.revision)
      await idbDelete(DIRTY_STORE, packId)
      showSyncBanner('success', 'Local changes kept. The server version was overwritten.')
      window.setTimeout(function clearBanner() {
        showSyncBanner(null, '')
      }, 2200)
      return payload.revision
    }

    if (conflictPayload.qbankinfo) {
      await setPackCache(packId, conflictPayload.qbankinfo, null)
    }
    await idbDelete(DIRTY_STORE, packId)
    showSyncBanner('warning', 'Server version restored. Reloading this study pack.')
    window.location.reload()
    return conflictPayload.serverRevision
  }

  async function syncProgress(packId, progress) {
    const cached = await getPackCache(packId)
    const baseRevision = cached && cached.qbankinfo ? cached.qbankinfo.revision : 0

    await updateCachedProgress(packId, progress)

    if (!window.navigator.onLine) {
      await setDirtyProgress(packId, progress, baseRevision)
      showSyncBanner('warning', 'Offline: progress saved locally and queued for sync.')
      return { queued: true }
    }

    try {
      const payload = await request(`/api/study-packs/${packId}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progress: progress,
          baseRevision: baseRevision
        })
      })
      await updateCachedProgress(packId, progress, payload.revision)
      await idbDelete(DIRTY_STORE, packId)
      showSyncBanner('success', 'Synced')
      window.setTimeout(function clearBanner() {
        showSyncBanner(null, '')
      }, 900)
      return payload
    } catch (error) {
      if (error.status === 409 && error.body) {
        const revision = await resolveConflict(packId, progress, error.body)
        return { revision: revision }
      }
      await setDirtyProgress(packId, progress, baseRevision)
      showSyncBanner('warning', 'Saved locally. Sync will retry when the connection returns.')
      return { queued: true }
    }
  }

  async function flushDirtyProgress() {
    if (!window.navigator.onLine) {
      return
    }

    const allDirty = await idbGetAll(DIRTY_STORE)
    for (const dirtyEntry of allDirty) {
      try {
        const payload = await request(`/api/study-packs/${dirtyEntry.packId}/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            progress: dirtyEntry.progress,
            baseRevision: dirtyEntry.baseRevision
          })
        })
        await updateCachedProgress(dirtyEntry.packId, dirtyEntry.progress, payload.revision)
        await idbDelete(DIRTY_STORE, dirtyEntry.packId)
      } catch (error) {
        if (error.status === 409 && getCurrentPackId() === dirtyEntry.packId && error.body) {
          await resolveConflict(dirtyEntry.packId, dirtyEntry.progress, error.body)
        }
      }
    }
  }

  async function startBlock(packId, blockqlist) {
    const preferences = {
      mode: window.localStorage.getItem(`${STORE_PREFIX}mode-setting`) || 'tutor',
      timeperq: window.localStorage.getItem(`${STORE_PREFIX}timeperq-setting`) || '0',
      qpoolstr: {
        'btn-qpool-unused': 'Unused',
        'btn-qpool-incorrects': 'Incorrects',
        'btn-qpool-flagged': 'Flagged',
        'btn-qpool-all': 'All',
        'btn-qpool-custom': 'Custom'
      }[window.localStorage.getItem(`${STORE_PREFIX}qpool-setting`) || 'btn-qpool-unused'],
      tagschosenstr: window.localStorage.getItem(`${STORE_PREFIX}recent-tagschosenstr`) || '',
      allsubtagsenabled: window.localStorage.getItem(`${STORE_PREFIX}recent-allsubtagsenabled`) !== 'false'
    }

    const payload = await request(`/api/study-packs/${packId}/blocks/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blockqlist: blockqlist,
        preferences: preferences
      })
    })

    const cached = await getPackCache(packId)
    if (cached && cached.qbankinfo) {
      cached.qbankinfo.revision = payload.revision
      await setPackCache(packId, cached.qbankinfo, cached.packMeta)
    }
    return payload
  }

  async function deleteBlock(packId, blockKey) {
    const payload = await request(`/api/study-packs/${packId}/blocks/${encodeURIComponent(blockKey)}`, {
      method: 'DELETE'
    })
    const refreshed = await fetchQbankInfo(packId, '')
    await updateCachedProgress(packId, refreshed.progress, payload.revision)
    return payload
  }

  async function resetPack(packId) {
    const payload = await request(`/api/study-packs/${packId}/reset`, {
      method: 'POST'
    })
    const refreshed = await fetchQbankInfo(packId, '')
    await updateCachedProgress(packId, refreshed.progress, payload.revision)
    return payload
  }

  async function initPageBridge(ipcRenderer) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function ignoreError(error) {
        console.warn('Service worker registration failed.', error)
      })
    }

    window.addEventListener('online', function handleOnline() {
      showSyncBanner('info', 'Connection restored. Syncing queued progress...')
      flushDirtyProgress().then(function clearAfterFlush() {
        showSyncBanner(null, '')
      })
    })

    await flushDirtyProgress()

    const requiresPack = document.body && document.body.dataset.requiresPack === 'true'
    if (!requiresPack) {
      return
    }

    const user = await getSession()
    if (!user) {
      navigate('index')
      return
    }

    const packId = getCurrentPackId()
    if (!packId) {
      navigate('index')
      return
    }

    try {
      const qbankinfo = await loadPack(packId, getCurrentBlockKey())
      ipcRenderer._emit('qbankinfo', qbankinfo)
    } catch (error) {
      window.alert(error.message || 'Unable to load this study pack.')
      navigate('index')
    }
  }

  async function handleIpcSend(channel, payload) {
    const packId = getCurrentPackId()

    switch (channel) {
      case 'navto-overview':
        navigate('overview', { pack: packId })
        return
      case 'navto-newblock':
        navigate('newblock', { pack: packId })
        return
      case 'navto-prevblocks':
        navigate('previousblocks', { pack: packId })
        return
      case 'navto-index':
        navigate('index')
        return
      case 'startblock': {
        const result = await startBlock(packId, payload)
        navigate('examview', { pack: packId, block: result.blockKey })
        return
      }
      case 'saveprogress':
        await syncProgress(packId, payload)
        return
      case 'pauseblock':
        await syncProgress(packId, payload)
        navigate('previousblocks', { pack: packId })
        return
      case 'openblock':
        navigate('examview', { pack: packId, block: payload })
        return
      case 'deleteblock':
        await deleteBlock(packId, payload)
        return
      case 'resetqbank':
        if (window.confirm('Delete all progress for this study pack and reset it?')) {
          await resetPack(packId)
          window.location.reload()
        }
        return
      case 'answerselect':
        return
      default:
        console.warn(`Unhandled IPC channel: ${channel}`)
    }
  }

  window.QuailLive = {
    buildPageUrl: buildPageUrl,
    buildPackFileUrl: buildPackFileUrl,
    deleteStudyPack: deleteStudyPack,
    flushDirtyProgress: flushDirtyProgress,
    getCurrentPackId: getCurrentPackId,
    getSession: getSession,
    handleIpcSend: handleIpcSend,
    importStudyPack: importStudyPack,
    initPageBridge: initPageBridge,
    listStudyPacks: listStudyPacks,
    login: login,
    logout: logout,
    navigate: navigate,
    register: register,
    request: request,
    setPackCache: setPackCache,
    showSyncBanner: showSyncBanner,
    STORE_PREFIX: STORE_PREFIX
  }
})(window)
