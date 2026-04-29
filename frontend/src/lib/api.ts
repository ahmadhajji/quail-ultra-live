import { z } from 'zod'
import { upload as uploadBlobClient } from '@vercel/blob/client'
import { unzipSync, zipSync } from 'fflate'
import { adminUserSchema, adminUsersResponseSchema, appSettingsResponseSchema, authConfigSchema, authResponseSchema, importSessionSchema, inviteCreationResponseSchema, invitesResponseSchema, libraryPackSchema, libraryPacksResponseSchema, manifestResponseSchema, nativePackContentSchema, nativePackDiffSchema, packProgressSummarySchema, qbankInfoResponseSchema, qbankInfoSchema, questionStatsResponseSchema, revisionResponseSchema, sessionResponseSchema, startBlockResponseSchema, studyPackSchema, studyPacksResponseSchema } from './schemas'
import { getCurrentBlockKey } from './navigation'
import { ProgressSyncCoordinator } from './progress-sync'
import { normalizeProgress } from './progress'
import { STORE_PREFIX, WARM_PREFIX, localStore } from './store'
import type { AdminUser, AppSettings, CachedPackEntry, DirtyProgressEntry, InviteCreationResult, InviteRecord, LibraryPackSummary, NativePackContent, NativePackDiff, PackProgressSummary, ProgressRecord, QbankInfo, QuestionStats, StartBlockPreferences, StudyPackSummary, SyncMetadata, SyncProgressOptions, SyncProgressResult, User, UserRole, UserStatus } from '../types/domain'

const DB_NAME = 'quail-ultra-live'
const DB_VERSION = 1
const PACK_STORE = 'packs'
const DIRTY_STORE = 'dirty-progress'
const PROGRESS_REQUEST_TIMEOUT_MS = 5000
const SYNC_INSTANCE_KEY = `${STORE_PREFIX}sync-instance-id`

let dbPromise: Promise<IDBDatabase> | undefined
let sessionCache: User | null | undefined
let authConfigCache: AppSettings | undefined
const syncMutationSeqByPack = new Map<string, number>()

type ImportUploadEntry = {
  relativePath: string
  body: Blob
  size: number
  contentType?: string
}

type UploadMode = 'multipart' | 'vercel-blob' | 'presigned'

function getSyncInstanceId(): string {
  let instanceId = window.localStorage.getItem(SYNC_INSTANCE_KEY)
  if (!instanceId) {
    instanceId = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
    window.localStorage.setItem(SYNC_INSTANCE_KEY, instanceId)
  }
  return instanceId
}

function nextSyncMetadata(packId: string): SyncMetadata {
  const nextSeq = (syncMutationSeqByPack.get(packId) ?? 0) + 1
  syncMutationSeqByPack.set(packId, nextSeq)
  return {
    clientInstanceId: getSyncInstanceId(),
    clientMutationSeq: nextSeq,
    clientUpdatedAt: new Date().toISOString()
  }
}

function syncMetadataFromDirtyEntry(entry: DirtyProgressEntry): SyncMetadata {
  return {
    clientInstanceId: entry.clientInstanceId,
    clientMutationSeq: entry.clientMutationSeq,
    clientUpdatedAt: entry.clientUpdatedAt
  }
}

function compactSyncOptions(options: SyncProgressOptions): SyncProgressOptions {
  return {
    ...(options.immediate !== undefined ? { immediate: options.immediate } : {}),
    ...(options.keepalive !== undefined ? { keepalive: options.keepalive } : {}),
    ...(options.silent !== undefined ? { silent: options.silent } : {})
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * Sync status surface. The exam UI renders a small pill driven by these
 * states rather than a per-event toast so users aren't distracted on every
 * save. States are coarse and durable:
 *   - `synced`   → all known changes have been acknowledged by the server
 *   - `syncing`  → a flush is in-flight
 *   - `pending`  → changes are queued locally; not yet sent
 *   - `offline`  → navigator is offline; changes buffered for later
 *   - `error`    → the last attempt failed; will retry on the next flush
 */
export type SyncStatusState = 'synced' | 'syncing' | 'pending' | 'offline' | 'error'

export interface SyncStatus {
  state: SyncStatusState
  message?: string
}

let currentSyncStatus: SyncStatus = { state: 'synced' }
const syncStatusListeners = new Set<(status: SyncStatus) => void>()

function setSyncStatus(next: SyncStatus): void {
  const sameState = currentSyncStatus.state === next.state
  const sameMessage = (currentSyncStatus.message ?? '') === (next.message ?? '')
  if (sameState && sameMessage) {
    return
  }
  currentSyncStatus = next
  for (const listener of syncStatusListeners) {
    try {
      listener(next)
    } catch (error) {
      console.warn('Sync status listener failed.', error)
    }
  }
}

export function getSyncStatus(): SyncStatus {
  return currentSyncStatus
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  syncStatusListeners.add(listener)
  listener(currentSyncStatus)
  return () => {
    syncStatusListeners.delete(listener)
  }
}

// Legacy no-op kept for API compatibility; the UI now owns status rendering
// through the `SyncStatusPill` component.
function showSyncBanner(_mode: 'info' | 'warning' | 'success' | null, _text: string): void {
  // intentionally left blank
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
  const { format, nativeContent, questionMeta, ...rest } = qbankinfo
  const normalizedBase = {
    ...rest,
    ...(format ? { format } : {}),
    ...(nativeContent ? { nativeContent } : {}),
    progress: normalizedProgress,
    blockToOpen: qbankinfo.blockToOpen || getCurrentBlockKey()
  }
  return questionMeta ? { ...normalizedBase, questionMeta } : normalizedBase
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

async function setDirtyProgress(entry: DirtyProgressEntry): Promise<void> {
  await idbPut<DirtyProgressEntry>(DIRTY_STORE, entry)
}

export function buildPackFileUrl(packId: string, relativePath: string): string {
  return `/api/study-packs/${packId}/file/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

function sanitizeImportRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
  if (!normalized || normalized.startsWith('.')) {
    throw new Error('Invalid import path.')
  }
  return normalized
}

function buildImportBlobPath(sessionId: string, relativePath: string): string {
  return `imports/${encodeURIComponent(sessionId)}/${sanitizeImportRelativePath(relativePath)}`
}

async function requestImportUploadUrls(sessionId: string, entries: ImportUploadEntry[]) {
  const payload = await requestRaw('/api/study-packs/import/upload-urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      files: entries.map((entry) => ({
        relativePath: entry.relativePath,
        ...(entry.contentType ? { contentType: entry.contentType } : {})
      }))
    })
  })
  return z.object({
    uploads: z.array(z.object({
      relativePath: z.string(),
      url: z.string(),
      headers: z.record(z.string(), z.string())
    }))
  }).parse(payload).uploads
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl)
  }, 0)
}

async function uploadImportEntries(sessionId: string, entries: ImportUploadEntry[], uploadMode: UploadMode, onProgress?: (message: string) => void): Promise<void> {
  const presignedUploads = uploadMode === 'presigned'
    ? new Map((await requestImportUploadUrls(sessionId, entries)).map((upload) => [upload.relativePath, upload]))
    : null
  let cursor = 0
  let completed = 0
  const concurrency = 4

  async function worker(): Promise<void> {
    while (cursor < entries.length) {
      const entry = entries[cursor]
      cursor += 1
      if (!entry) {
        return
      }
      onProgress?.(`Uploading ${completed + 1} of ${entries.length}: ${entry.relativePath}`)
      if (uploadMode === 'vercel-blob') {
        await uploadBlobClient(buildImportBlobPath(sessionId, entry.relativePath), entry.body, {
          access: 'private',
          handleUploadUrl: '/api/study-packs/import/uploads',
          clientPayload: JSON.stringify({ sessionId }),
          multipart: entry.size > 5 * 1024 * 1024
        })
      } else {
        const upload = presignedUploads?.get(entry.relativePath)
        if (!upload) {
          throw new Error(`Missing upload target for ${entry.relativePath}`)
        }
        const response = await window.fetch(upload.url, {
          method: 'PUT',
          headers: upload.headers,
          body: entry.body
        })
        if (!response.ok) {
          throw new Error(`Unable to upload ${entry.relativePath}`)
        }
      }
      completed += 1
      onProgress?.(`Uploaded ${completed} of ${entries.length} files...`)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(entries.length, 1)) }, () => worker())
  await Promise.all(workers)
}

export async function getSession(force = false): Promise<User | null> {
  if (!force && sessionCache !== undefined) {
    return sessionCache
  }
  const payload = await request('/api/auth/session', sessionResponseSchema)
  sessionCache = payload.user
  return sessionCache
}

export async function getAuthConfig(force = false): Promise<AppSettings> {
  if (!force && authConfigCache) {
    return authConfigCache
  }
  const payload = await request('/api/auth/config', authConfigSchema)
  authConfigCache = payload.settings
  return authConfigCache
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

export async function register(username: string, password: string, email: string, inviteToken: string): Promise<User> {
  const payload = await request('/api/auth/register', authResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email, inviteToken })
  })
  sessionCache = payload.user
  return payload.user
}

export async function logout(): Promise<void> {
  await requestRaw('/api/auth/logout', { method: 'POST' })
  sessionCache = null
  authConfigCache = undefined
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

export async function uploadFolderImportDirect(sessionId: string, fileList: FileList, onProgress?: (message: string) => void): Promise<void> {
  const entries: ImportUploadEntry[] = Array.from(fileList).map((file) => ({
    relativePath: sanitizeImportRelativePath(file.webkitRelativePath || file.name),
    body: file,
    size: file.size || 0,
    ...(file.type ? { contentType: file.type } : {})
  }))
  await uploadImportEntries(sessionId, entries, 'vercel-blob', onProgress)
}

export async function uploadZipImportDirect(sessionId: string, zipFile: File, onProgress?: (message: string) => void): Promise<void> {
  onProgress?.('Extracting zip in the browser...')
  const archive = unzipSync(new Uint8Array(await zipFile.arrayBuffer()))
  const entries: ImportUploadEntry[] = Object.entries(archive)
    .filter(([relativePath]) => !relativePath.endsWith('/'))
    .map(([relativePath, content]) => ({
      relativePath: sanitizeImportRelativePath(relativePath),
      body: new Blob([Uint8Array.from(content)]),
      size: content.byteLength
    }))
  await uploadImportEntries(sessionId, entries, 'vercel-blob', onProgress)
}

export async function uploadFolderImportPresigned(sessionId: string, fileList: FileList, onProgress?: (message: string) => void): Promise<void> {
  const entries: ImportUploadEntry[] = Array.from(fileList).map((file) => ({
    relativePath: sanitizeImportRelativePath(file.webkitRelativePath || file.name),
    body: file,
    size: file.size || 0,
    ...(file.type ? { contentType: file.type } : {})
  }))
  await uploadImportEntries(sessionId, entries, 'presigned', onProgress)
}

export async function uploadZipImportPresigned(sessionId: string, zipFile: File, onProgress?: (message: string) => void): Promise<void> {
  onProgress?.('Extracting zip in the browser...')
  const archive = unzipSync(new Uint8Array(await zipFile.arrayBuffer()))
  const entries: ImportUploadEntry[] = Object.entries(archive)
    .filter(([relativePath]) => !relativePath.endsWith('/'))
    .map(([relativePath, content]) => ({
      relativePath: sanitizeImportRelativePath(relativePath),
      body: new Blob([Uint8Array.from(content)]),
      size: content.byteLength
    }))
  await uploadImportEntries(sessionId, entries, 'presigned', onProgress)
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

export async function exportStudyPackZip(pack: StudyPackSummary, onProgress?: (message: string) => void): Promise<void> {
  const manifest = await request(`/api/study-packs/${encodeURIComponent(pack.id)}/manifest`, manifestResponseSchema)
  const files: Record<string, Uint8Array> = {}
  for (let index = 0; index < manifest.files.length; index += 1) {
    const relativePath = manifest.files[index]
    if (!relativePath) {
      continue
    }
    onProgress?.(`Preparing export ${index + 1} of ${manifest.files.length}: ${relativePath}`)
    const response = await window.fetch(buildPackFileUrl(pack.id, relativePath), {
      credentials: 'include'
    })
    if (!response.ok) {
      throw new Error(`Unable to export ${relativePath}`)
    }
    files[relativePath] = new Uint8Array(await response.arrayBuffer())
  }
  onProgress?.('Building zip archive...')
  const archive = zipSync(files, { level: 0 })
  downloadBlob(
    new Blob([Uint8Array.from(archive)], { type: 'application/zip' }),
    `${pack.name.replace(/[^\w.-]+/g, '_') || 'study-pack'}.zip`
  )
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

async function sendProgressEntry(entry: DirtyProgressEntry, options: SyncProgressOptions = {}): Promise<SyncProgressResult> {
  if (!window.navigator.onLine) {
    await setDirtyProgress(entry)
    setSyncStatus({ state: 'offline' })
    return { queued: true }
  }

  setSyncStatus({ state: 'syncing' })

  try {
    const payload = await request(`/api/study-packs/${entry.packId}/progress`, revisionResponseSchema, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        progress: entry.progress,
        baseRevision: entry.baseRevision,
        ...syncMetadataFromDirtyEntry(entry)
      }),
      ...(options.keepalive !== undefined ? { keepalive: options.keepalive } : {})
    }, PROGRESS_REQUEST_TIMEOUT_MS)

    await updateCachedProgress(entry.packId, entry.progress, payload.revision)
    await idbDelete(DIRTY_STORE, entry.packId)

    setSyncStatus({ state: 'synced' })

    return {
      revision: payload.revision,
      ...(payload.applied !== undefined ? { applied: payload.applied } : {}),
      ...(payload.serverAcceptedAt !== undefined ? { serverAcceptedAt: payload.serverAcceptedAt } : {})
    }
  } catch (error) {
    setSyncStatus({ state: 'error' })
    throw error
  }
}

const progressSyncCoordinator = new ProgressSyncCoordinator(sendProgressEntry)

export async function loadPack(packId: string, blockKey: string): Promise<QbankInfo> {
  try {
    const qbankinfo = await fetchQbankInfo(packId, blockKey)
    void warmPackInBackground(packId, qbankinfo.revision)
    return qbankinfo
  } catch (error) {
    const cached = await getPackCache(packId)
    if (cached?.qbankinfo) {
      setSyncStatus({ state: 'offline' })
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

function buildDirtyProgressEntry(packId: string, progress: ProgressRecord, baseRevision: number): DirtyProgressEntry {
  const metadata = nextSyncMetadata(packId)
  return {
    packId,
    progress,
    baseRevision,
    queuedAt: metadata.clientUpdatedAt,
    ...metadata
  }
}

export async function syncProgress(packId: string, progress: ProgressRecord, options: SyncProgressOptions = {}): Promise<SyncProgressResult> {
  const cached = await getPackCache(packId)
  const baseRevision = cached?.qbankinfo.revision ?? 0
  await updateCachedProgress(packId, progress)
  const entry = buildDirtyProgressEntry(packId, progress, baseRevision)
  await setDirtyProgress(entry)

  if (!window.navigator.onLine) {
    setSyncStatus({ state: 'offline' })
    return { queued: true }
  }

  setSyncStatus({ state: options.immediate ? 'syncing' : 'pending' })

  try {
    return await progressSyncCoordinator.queue(entry, options)
  } catch (error) {
    await setDirtyProgress(entry)
    setSyncStatus({ state: 'error' })
    return { queued: true }
  }
}

export async function flushDirtyProgress(options: SyncProgressOptions = {}): Promise<void> {
  if (!window.navigator.onLine) {
    return
  }
  await progressSyncCoordinator.flushAll({
    ...compactSyncOptions(options),
    immediate: true
  })

  const entries = (await idbGetAll<DirtyProgressEntry>(DIRTY_STORE))
    .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
  for (const dirtyEntry of entries) {
    try {
      await sendProgressEntry(dirtyEntry, {
        ...compactSyncOptions(options),
        immediate: true,
        silent: true
      })
    } catch (error) {
      if (!(error instanceof RequestError)) {
        continue
      }
    }
  }
}

function getStartBlockPreferences(): StartBlockPreferences {
  const qpoolSetting = localStore.getString('qpool-setting') ?? 'btn-qpool-unused'
  return {
    mode: 'tutor',
    timeperq: '0',
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

export async function getQuestionStats(packId: string, questionIds: string[]): Promise<Record<string, QuestionStats>> {
  const ids = [...new Set(questionIds.filter(Boolean))]
  if (ids.length === 0) {
    return {}
  }
  const query = ids.map((id) => encodeURIComponent(id)).join(',')
  const payload = await request(`/api/study-packs/${packId}/question-stats?ids=${query}`, questionStatsResponseSchema)
  return payload.stats
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const payload = await request('/api/admin/users', adminUsersResponseSchema)
  return payload.users
}

export async function createAdminUser(input: {
  username: string
  password: string
  email: string
  role: UserRole
}): Promise<AdminUser> {
  const payload = await requestRaw('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  return z.object({ user: adminUserSchema }).parse(payload).user
}

export async function updateAdminUser(userId: string, input: {
  email?: string
  role?: UserRole
  status?: UserStatus
}): Promise<AdminUser> {
  const payload = await requestRaw(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  return z.object({ user: adminUserSchema }).parse(payload).user
}

export async function deleteAdminUser(userId: string): Promise<void> {
  await requestRaw(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE'
  })
}

export async function listUserPacks(userId: string): Promise<StudyPackSummary[]> {
  const payload = await requestRaw(`/api/admin/users/${encodeURIComponent(userId)}/packs`)
  return z.object({ packs: z.array(studyPackSchema) }).parse(payload).packs
}

export async function deleteAdminPack(packId: string): Promise<void> {
  await requestRaw(`/api/admin/packs/${encodeURIComponent(packId)}`, {
    method: 'DELETE'
  })
  await idbDelete(PACK_STORE, packId)
  await idbDelete(DIRTY_STORE, packId)
}

export async function listInvites(): Promise<InviteRecord[]> {
  const payload = await request('/api/admin/invites', invitesResponseSchema)
  return payload.invites
}

export async function createInvite(input: {
  email: string
  role: UserRole
  expiresInDays?: number
}): Promise<InviteCreationResult> {
  return request('/api/admin/invites', inviteCreationResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await requestRaw(`/api/admin/invites/${encodeURIComponent(inviteId)}/revoke`, {
    method: 'POST'
  })
}

export async function getAppSettings(force = false): Promise<AppSettings> {
  if (!force && authConfigCache) {
    return authConfigCache
  }
  const payload = await request('/api/admin/settings', appSettingsResponseSchema)
  authConfigCache = payload.settings
  return authConfigCache
}

export async function updateAppSettings(settings: AppSettings): Promise<AppSettings> {
  const payload = await request('/api/admin/settings', appSettingsResponseSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings })
  })
  authConfigCache = payload.settings
  return authConfigCache
}

// --- Library packs ---------------------------------------------------------

export async function listLibraryPacks(): Promise<LibraryPackSummary[]> {
  const payload = await request('/api/library', libraryPacksResponseSchema)
  return payload.packs
}

export async function importLibraryPack(systemPackId: string): Promise<StudyPackSummary> {
  const payload = await requestRaw(`/api/library/${encodeURIComponent(systemPackId)}/import`, {
    method: 'POST'
  })
  return z.object({ pack: studyPackSchema }).parse(payload).pack
}

export async function promoteToLibrary(packId: string, name: string, description: string): Promise<LibraryPackSummary> {
  const payload = await requestRaw(`/api/library/promote/${encodeURIComponent(packId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  })
  return z.object({ pack: libraryPackSchema }).parse(payload).pack
}

export async function deleteLibraryPack(systemPackId: string): Promise<void> {
  await requestRaw(`/api/library/${encodeURIComponent(systemPackId)}`, {
    method: 'DELETE'
  })
}

// --- Native library pack content -----------------------------------------

export async function getNativePackContent(systemPackId: string): Promise<NativePackContent> {
  return request(`/api/admin/native-packs/${encodeURIComponent(systemPackId)}/content`, nativePackContentSchema)
}

export async function getNativePackQuestion(systemPackId: string, questionId: string): Promise<unknown> {
  const payload = await requestRaw(`/api/admin/native-packs/${encodeURIComponent(systemPackId)}/questions/${encodeURIComponent(questionId)}`)
  return z.object({ question: z.unknown() }).parse(payload).question
}

export async function validateNativePackRevision(systemPackId: string, input: { sourcePath?: string; sourceStudyPackId?: string }): Promise<NativePackDiff> {
  const payload = await requestRaw(`/api/admin/native-packs/${encodeURIComponent(systemPackId)}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  return z.object({ diff: nativePackDiffSchema }).parse(payload).diff
}

export async function publishNativePackRevision(systemPackId: string, input: { sourcePath?: string; sourceStudyPackId?: string }): Promise<{ pack: LibraryPackSummary; diff: NativePackDiff }> {
  const payload = await requestRaw(`/api/admin/native-packs/${encodeURIComponent(systemPackId)}/revisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  return z.object({ pack: libraryPackSchema, diff: nativePackDiffSchema }).parse(payload)
}

export async function updateNativePackQuestion(systemPackId: string, questionId: string, question: unknown, changeSummary: string): Promise<unknown> {
  const payload = await requestRaw(`/api/admin/native-packs/${encodeURIComponent(systemPackId)}/questions/${encodeURIComponent(questionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, changeSummary })
  })
  return z.object({ question: z.unknown() }).parse(payload).question
}

export async function createNativePackQuestion(systemPackId: string, question: unknown, changeSummary: string): Promise<unknown> {
  const payload = await requestRaw(`/api/admin/native-packs/${encodeURIComponent(systemPackId)}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, changeSummary })
  })
  return z.object({ question: z.unknown() }).parse(payload).question
}

export async function deprecateNativePackQuestion(systemPackId: string, questionId: string, changeSummary: string): Promise<unknown> {
  const payload = await requestRaw(`/api/admin/native-packs/${encodeURIComponent(systemPackId)}/questions/${encodeURIComponent(questionId)}/deprecate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changeSummary })
  })
  return z.object({ question: z.unknown() }).parse(payload).question
}

// --- Admin pack utilities --------------------------------------------------

export async function resetAdminPack(packId: string): Promise<number> {
  const payload = await request(`/api/admin/packs/${encodeURIComponent(packId)}/reset`, revisionResponseSchema, {
    method: 'POST'
  })
  return payload.revision
}

export async function getAdminPackProgressSummary(packId: string): Promise<PackProgressSummary> {
  return request(`/api/admin/packs/${encodeURIComponent(packId)}/progress-summary`, packProgressSummarySchema)
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
    setSyncStatus({ state: 'syncing' })
    void flushDirtyProgress({ immediate: true, silent: true }).then(() => {
      if (currentSyncStatus.state === 'syncing') {
        setSyncStatus({ state: 'synced' })
      }
    })
  })

  window.addEventListener('offline', () => {
    setSyncStatus({ state: 'offline' })
  })

  const flushLifecycleChanges = () => {
    void flushDirtyProgress({
      immediate: true,
      keepalive: true,
      silent: true
    })
  }

  window.addEventListener('pagehide', flushLifecycleChanges)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushLifecycleChanges()
    }
  })
}

export async function submitSupportTicket(subject: string, category: string, message: string): Promise<{ ok: boolean; emailSent: boolean }> {
  const payload = await requestRaw('/api/support/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, category, message })
  })
  return payload as { ok: boolean; emailSent: boolean }
}

export async function listSupportTickets(): Promise<import('../types/domain').SupportTicket[]> {
  const payload = await requestRaw('/api/admin/support-tickets')
  return (payload as { tickets: import('../types/domain').SupportTicket[] }).tickets
}

export async function submitQuestionReport(packId: string, questionId: string, category: string, message: string): Promise<{ ok: boolean }> {
  const payload = await requestRaw(`/api/study-packs/${encodeURIComponent(packId)}/questions/${encodeURIComponent(questionId)}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, message })
  })
  return payload as { ok: boolean }
}

export async function listQuestionReports(): Promise<import('../types/domain').QuestionReport[]> {
  const payload = await requestRaw('/api/admin/question-reports')
  return (payload as { reports: import('../types/domain').QuestionReport[] }).reports
}

export { RequestError, showSyncBanner }
