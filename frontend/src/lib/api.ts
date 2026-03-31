import { z } from 'zod'
import { authResponseSchema, importSessionSchema, manifestResponseSchema, qbankInfoResponseSchema, qbankInfoSchema, revisionResponseSchema, sessionResponseSchema, startBlockResponseSchema, studyPackSchema, studyPacksResponseSchema } from './schemas'
import { getCurrentBlockKey } from './navigation'
import { normalizeProgress } from './progress'
import { STORE_PREFIX, WARM_PREFIX, localStore } from './store'
import type { CachedPackEntry, DirtyProgressEntry, ProgressRecord, QbankInfo, StartBlockPreferences, StudyPackSummary, User } from '../types/domain'

const DB_NAME = 'quail-ultra-live'
const DB_VERSION = 1
const PACK_STORE = 'packs'
const DIRTY_STORE = 'dirty-progress'
const PROGRESS_REQUEST_TIMEOUT_MS = 5000

let dbPromise: Promise<IDBDatabase> | undefined
let sessionCache: User | null | undefined

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function showSyncBanner(mode: 'info' | 'warning' | 'success' | null, text: string): void {
  let banner = document.getElementById('syncBanner')
  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'syncBanner'
    banner.className = 'sync-banner sync-banner-hidden'
    document.body.appendChild(banner)
  }
  if (!mode || !text) {
    banner.className = 'sync-banner sync-banner-hidden'
    banner.textContent = ''
    return
  }
  banner.className = `sync-banner sync-banner-${mode}`
  banner.textContent = text
}

function summarizeTextError(text: string): string {
  const normalized = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }
  if (normalized.includes('413 Request Entity Too Large')) {
    return 'Upload request was too large for the current endpoint.'
  }
  return normalized.slice(0, 220)
}

class RequestError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  const text = await response.text()
  return text ? { text } : null
}

async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs?: number): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) {
    return window.fetch(url, options)
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await window.fetch(url, {
      ...(options ?? {}),
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out.')
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function request<T>(url: string, schema: z.ZodType<T>, options?: RequestInit, timeoutMs?: number): Promise<T> {
  const response = await fetchWithTimeout(url, { credentials: 'include', ...(options ?? {}) }, timeoutMs)
  const body = await parseResponseBody(response)
  if (!response.ok) {
    let message = `Request failed with ${response.status}`
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error.trim()) {
      message = body.error.trim()
    } else if (body && typeof body === 'object' && 'text' in body && typeof body.text === 'string') {
      message = summarizeTextError(body.text) || message
    }
    throw new RequestError(message, response.status, body)
  }
  return schema.parse(body)
}

async function requestRaw(url: string, options?: RequestInit, timeoutMs?: number): Promise<unknown> {
  const response = await fetchWithTimeout(url, { credentials: 'include', ...(options ?? {}) }, timeoutMs)
  const body = await parseResponseBody(response)
  if (!response.ok) {
    let message = `Request failed with ${response.status}`
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error.trim()) {
      message = body.error.trim()
    } else if (body && typeof body === 'object' && 'text' in body && typeof body.text === 'string') {
      message = summarizeTextError(body.text) || message
    }
    throw new RequestError(message, response.status, body)
  }
  return body
}

function normalizeQbankInfo(qbankinfo: z.infer<typeof qbankInfoSchema>): QbankInfo {
  const normalizedProgress = normalizeProgress(qbankinfo.progress, qbankinfo)
  return {
    ...qbankinfo,
    progress: normalizedProgress,
    blockToOpen: qbankinfo.blockToOpen || getCurrentBlockKey()
  }
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)
      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(PACK_STORE)) {
          db.createObjectStore(PACK_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(DIRTY_STORE)) {
          db.createObjectStore(DIRTY_STORE, { keyPath: 'packId' })
        }
      }
      request.onsuccess = () => resolve(request.result)
    })
  }
  return dbPromise
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).get(key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
  })
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).getAll()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve((request.result as T[] | undefined) ?? [])
  })
}

async function getPackCache(packId: string): Promise<CachedPackEntry | null> {
  return idbGet<CachedPackEntry>(PACK_STORE, packId)
}

async function setPackCache(packId: string, qbankinfo: QbankInfo, packMeta: StudyPackSummary | null): Promise<void> {
  await idbPut<CachedPackEntry>(PACK_STORE, {
    id: packId,
    qbankinfo,
    packMeta,
    updatedAt: new Date().toISOString()
  })
}

async function setDirtyProgress(packId: string, progress: ProgressRecord, baseRevision: number): Promise<void> {
  await idbPut<DirtyProgressEntry>(DIRTY_STORE, {
    packId,
    progress,
    baseRevision
  })
}

export function buildPackFileUrl(packId: string, relativePath: string): string {
  return `/api/study-packs/${packId}/file/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

export async function getSession(force = false): Promise<User | null> {
  if (!force && sessionCache !== undefined) {
    return sessionCache
  }
  const payload = await request('/api/auth/session', sessionResponseSchema)
  sessionCache = payload.user
  return sessionCache
}

export async function login(username: string, password: string): Promise<User> {
  const payload = await request('/api/auth/login', authResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  sessionCache = payload.user
  return payload.user
}

export async function register(username: string, password: string): Promise<User> {
  const payload = await request('/api/auth/register', authResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  sessionCache = payload.user
  return payload.user
}

export async function logout(): Promise<void> {
  await requestRaw('/api/auth/logout', { method: 'POST' })
  sessionCache = null
}

export async function listStudyPacks(): Promise<StudyPackSummary[]> {
  const payload = await request('/api/study-packs', studyPacksResponseSchema)
  return payload.packs
}

export async function importStudyPack(formData: FormData): Promise<StudyPackSummary> {
  const payload = await requestRaw('/api/study-packs/import', {
    method: 'POST',
    body: formData
  })
  return z.object({ pack: studyPackSchema }).parse(payload).pack
}

export async function beginFolderImport(packName: string): Promise<string> {
  const payload = await requestRaw('/api/study-packs/import/folder-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packName })
  })
  return z.object({ sessionId: z.string() }).parse(payload).sessionId
}

export async function uploadFolderImportBatch(sessionId: string, formData: FormData): Promise<void> {
  await requestRaw(`/api/study-packs/import/folder-session/${encodeURIComponent(sessionId)}/files`, {
    method: 'POST',
    body: formData
  })
}

export async function getFolderImportStatus(sessionId: string) {
  return request(`/api/study-packs/import/folder-session/${encodeURIComponent(sessionId)}`, importSessionSchema)
}

export async function completeFolderImport(sessionId: string, onProgress?: (message: string) => void): Promise<StudyPackSummary> {
  let payload = await request(`/api/study-packs/import/folder-session/${encodeURIComponent(sessionId)}/complete`, importSessionSchema, {
    method: 'POST'
  })
  while (payload.status === 'finalizing') {
    onProgress?.('Finalizing Study Pack on the server...')
    await delay(1500)
    payload = await getFolderImportStatus(sessionId)
  }
  if (payload.status !== 'completed' || !payload.pack) {
    throw new Error(payload.error || 'Import failed')
  }
  return payload.pack
}

export async function cancelFolderImport(sessionId: string): Promise<void> {
  await requestRaw(`/api/study-packs/import/folder-session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  })
}

export async function deleteStudyPack(packId: string): Promise<void> {
  await requestRaw(`/api/study-packs/${packId}`, { method: 'DELETE' })
  await idbDelete(PACK_STORE, packId)
  await idbDelete(DIRTY_STORE, packId)
}

async function fetchQbankInfo(packId: string, blockKey: string): Promise<QbankInfo> {
  const query = blockKey ? `?block=${encodeURIComponent(blockKey)}` : ''
  const payload = await request(`/api/study-packs/${packId}/qbankinfo${query}`, qbankInfoResponseSchema)
  const normalized = normalizeQbankInfo(payload.qbankinfo)
  await setPackCache(packId, normalized, payload.pack)
  return normalized
}

async function updateCachedProgress(packId: string, progress: ProgressRecord, revision?: number): Promise<void> {
  const cached = await getPackCache(packId)
  if (!cached) {
    return
  }
  const normalizedProgress = normalizeProgress(progress, cached.qbankinfo)
  cached.qbankinfo = {
    ...cached.qbankinfo,
    progress: normalizedProgress,
    revision: revision ?? cached.qbankinfo.revision
  }
  await setPackCache(packId, cached.qbankinfo, cached.packMeta)
}

async function resolveConflict(packId: string, progress: ProgressRecord, body: unknown): Promise<number> {
  const conflictPayload = z.object({
    error: z.string(),
    serverRevision: z.number(),
    qbankinfo: qbankInfoSchema.optional()
  }).parse(body)

  const useLocal = window.confirm(
    'A newer version of this study pack exists on the server.\n\nPress OK to keep your local changes and overwrite the server.\nPress Cancel to discard local changes and reload the server version.'
  )

  if (useLocal) {
    const payload = await request('/api/study-packs/' + packId + '/progress', revisionResponseSchema, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        progress,
        baseRevision: conflictPayload.serverRevision,
        force: true
      })
    })
    await updateCachedProgress(packId, progress, payload.revision)
    await idbDelete(DIRTY_STORE, packId)
    showSyncBanner('success', 'Local changes kept. The server version was overwritten.')
    window.setTimeout(() => showSyncBanner(null, ''), 2200)
    return payload.revision
  }

  if (conflictPayload.qbankinfo) {
    await setPackCache(packId, normalizeQbankInfo(conflictPayload.qbankinfo), null)
  }
  await idbDelete(DIRTY_STORE, packId)
  showSyncBanner('warning', 'Server version restored. Reloading this study pack.')
  window.location.reload()
  return conflictPayload.serverRevision
}

export async function loadPack(packId: string, blockKey: string): Promise<QbankInfo> {
  try {
    const qbankinfo = await fetchQbankInfo(packId, blockKey)
    void warmPackInBackground(packId, qbankinfo.revision)
    return qbankinfo
  } catch (error) {
    const cached = await getPackCache(packId)
    if (cached?.qbankinfo) {
      showSyncBanner('warning', 'Offline mode: using the cached study pack on this device.')
      return {
        ...cached.qbankinfo,
        blockToOpen: blockKey || ''
      }
    }
    throw error
  }
}

export async function warmPackInBackground(packId: string, revision: number): Promise<void> {
  if (!window.navigator.onLine) {
    return
  }
  const warmKey = `${WARM_PREFIX}${packId}`
  if (window.localStorage.getItem(warmKey) === String(revision)) {
    return
  }
  try {
    const payload = await request(`/api/study-packs/${packId}/manifest`, manifestResponseSchema)
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

export async function syncProgress(packId: string, progress: ProgressRecord): Promise<{ queued?: boolean; revision?: number }> {
  const cached = await getPackCache(packId)
  const baseRevision = cached?.qbankinfo.revision ?? 0
  await updateCachedProgress(packId, progress)

  if (!window.navigator.onLine) {
    await setDirtyProgress(packId, progress, baseRevision)
    showSyncBanner('warning', 'Offline: progress saved locally and queued for sync.')
    return { queued: true }
  }

  try {
    const payload = await request(`/api/study-packs/${packId}/progress`, revisionResponseSchema, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress, baseRevision })
    }, PROGRESS_REQUEST_TIMEOUT_MS)
    await updateCachedProgress(packId, progress, payload.revision)
    await idbDelete(DIRTY_STORE, packId)
    showSyncBanner('success', 'Synced')
    window.setTimeout(() => showSyncBanner(null, ''), 900)
    return payload
  } catch (error) {
    if (error instanceof RequestError && error.status === 409) {
      const revision = await resolveConflict(packId, progress, error.body)
      return { revision }
    }
    await setDirtyProgress(packId, progress, baseRevision)
    showSyncBanner('warning', 'Saved locally. Sync will retry when the connection returns.')
    return { queued: true }
  }
}

export async function flushDirtyProgress(): Promise<void> {
  if (!window.navigator.onLine) {
    return
  }
  const entries = await idbGetAll<DirtyProgressEntry>(DIRTY_STORE)
  for (const dirtyEntry of entries) {
    try {
      const payload = await request(`/api/study-packs/${dirtyEntry.packId}/progress`, revisionResponseSchema, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progress: dirtyEntry.progress,
          baseRevision: dirtyEntry.baseRevision
        })
      }, PROGRESS_REQUEST_TIMEOUT_MS)
      await updateCachedProgress(dirtyEntry.packId, dirtyEntry.progress, payload.revision)
      await idbDelete(DIRTY_STORE, dirtyEntry.packId)
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        await resolveConflict(dirtyEntry.packId, dirtyEntry.progress, error.body)
      }
    }
  }
}

function getStartBlockPreferences(): StartBlockPreferences {
  const qpoolSetting = localStore.getString('qpool-setting') ?? 'btn-qpool-unused'
  return {
    mode: (localStore.getString('mode-setting') as StartBlockPreferences['mode'] | undefined) ?? 'tutor',
    timeperq: localStore.getString('timeperq-setting') ?? '0',
    qpoolstr: {
      'btn-qpool-unused': 'Unused',
      'btn-qpool-incorrects': 'Incorrects',
      'btn-qpool-flagged': 'Flagged',
      'btn-qpool-all': 'All',
      'btn-qpool-custom': 'Custom'
    }[qpoolSetting] ?? 'Unused',
    tagschosenstr: localStore.getString('recent-tagschosenstr') ?? '',
    allsubtagsenabled: window.localStorage.getItem(`${STORE_PREFIX}recent-allsubtagsenabled`) !== 'false'
  }
}

export async function startBlock(packId: string, blockqlist: string[]): Promise<{ blockKey: string; revision: number }> {
  const payload = await request(`/api/study-packs/${packId}/blocks/start`, startBlockResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blockqlist,
      preferences: getStartBlockPreferences()
    })
  })
  const cached = await getPackCache(packId)
  if (cached) {
    cached.qbankinfo.revision = payload.revision
    await setPackCache(packId, cached.qbankinfo, cached.packMeta)
  }
  return payload
}

export async function deleteBlock(packId: string, blockKey: string): Promise<number> {
  const payload = await request(`/api/study-packs/${packId}/blocks/${encodeURIComponent(blockKey)}`, revisionResponseSchema, {
    method: 'DELETE'
  })
  const refreshed = await fetchQbankInfo(packId, '')
  await updateCachedProgress(packId, refreshed.progress, payload.revision)
  return payload.revision
}

export async function resetPack(packId: string): Promise<number> {
  const payload = await request(`/api/study-packs/${packId}/reset`, revisionResponseSchema, {
    method: 'POST'
  })
  const refreshed = await fetchQbankInfo(packId, '')
  await updateCachedProgress(packId, refreshed.progress, payload.revision)
  return payload.revision
}

export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed.', error)
    })
  }
}

export function installOnlineSyncHandler(): void {
  window.addEventListener('online', () => {
    showSyncBanner('info', 'Connection restored. Syncing queued progress...')
    void flushDirtyProgress().then(() => showSyncBanner(null, ''))
  })
}

export { RequestError, showSyncBanner }
