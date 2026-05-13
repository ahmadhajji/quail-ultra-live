// @ts-nocheck
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { handleUpload } from '@vercel/blob/client'
import { clearSessionCookie, readSessionUserId, setSessionCookie } from './auth'
import {
  DEFAULT_REGISTRATION_MODE,
  DATA_DIR,
  DIST_DIR,
  MAX_UPLOAD_FILE_SIZE,
  PORT,
  PACKS_DIR,
  ROOT_DIR,
  getUploadMode,
  getStorageBackend,
  validateRuntimeConfig,
  usesDirectUploads
} from './config'
import { buildPasswordHash, comparePassword, createInviteToken, createRepository, hashInviteToken } from './repository'
import { checkS3Readiness, copyS3Prefix, createPresignedUpload } from './s3'
import { copyBlobPrefix, createWorkspaceStore } from './workspace-store'
import { isEmailConfigured, sendInviteEmail, sendSupportEmail, sendQuestionReportEmail } from './email'
import { legacyPageRedirectTarget, routePathFor } from './routes'
import { findWorkspaceRoot, loadWorkspaceData } from '../shared/qbank'
import { NATIVE_QBANK_MANIFEST, validateNativeQbankDirectory } from '../shared/native-qbank'
import {
  activeNativeQuestionCount,
  diffNativePackManifests,
  sha256Json,
  summarizeNativeQuestion
} from '../shared/native-pack-admin'
import { deleteBlock, normalizeProgress, startBlock } from '../shared/progress'
import { buildQuestionStats, collectNewlySubmittedAnswers } from './answer-stats'
import { safeResolveWithin, validateStrictRelativePath } from '../shared/path-utils'

function nowIso() {
  return new Date().toISOString()
}

function jsonError(res: any, status: number, message: string) {
  res.status(status).json({ error: message })
}

const MAX_IMPORT_FILE_COUNT = 20000
const MAX_IMPORT_TOTAL_SIZE = 4 * 1024 * 1024 * 1024
const MAX_ZIP_ENTRY_COUNT = 20000
const MAX_ZIP_UNCOMPRESSED_SIZE = 4 * 1024 * 1024 * 1024

function sanitizePackName(input: string, fallback: string) {
  const trimmed = String(input || '').trim()
  return trimmed || fallback
}

function validateNativeQuestionId(value: string): string {
  const qid = String(value || '').trim()
  if (!qid || qid.includes('/') || qid.includes('\\')) {
    throw new Error('Invalid native question id')
  }
  validateStrictRelativePath(`${qid}.json`)
  return qid
}

function packSummary(row: any) {
  return {
    id: row.id,
    name: row.name,
    questionCount: Number(row.question_count || 0),
    revision: Number(row.revision || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseQuestionStatsIds(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : [value]
  const ids = rawValues
    .flatMap((entry) => String(entry || '').split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)
  return [...new Set(ids)].slice(0, 100)
}

function adminUserSummary(row: any) {
  return {
    id: row.id,
    username: row.username,
    email: row.email || '',
    role: row.role || 'user',
    status: row.status || 'active',
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
    pack_count: Number(row.pack_count || 0)
  }
}

function inviteSummary(row: any) {
  return {
    id: row.id,
    email: row.email,
    role: row.role || 'user',
    created_at: row.created_at,
    expires_at: row.expires_at,
    used_at: row.used_at || '',
    revoked_at: row.revoked_at || '',
    used_by_username: row.used_by_username || '',
    created_by_username: row.created_by_username || ''
  }
}

function getPublicOrigin(req: any) {
  const forwardedProto = req.get('x-forwarded-proto')
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol
  return `${protocol}://${req.get('host')}`
}

function redirectToSpaPath(req: any, res: any, targetPath: string) {
  const searchIndex = req.originalUrl.indexOf('?')
  const search = searchIndex > -1 ? req.originalUrl.slice(searchIndex) : ''
  res.redirect(302, `${targetPath}${search}`)
}

function summarizeMulterError(error: any) {
  if (!(error instanceof multer.MulterError)) {
    return error && error.message ? error.message : 'Upload failed'
  }
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return 'One of the uploaded files exceeded the current per-file upload limit.'
    case 'LIMIT_FILE_COUNT':
      return 'Too many files were selected for a single upload request.'
    case 'LIMIT_UNEXPECTED_FILE':
      return 'Unexpected upload field received.'
    default:
      return error.message || 'Upload failed'
  }
}

function asyncRoute(handler: any) {
  return function wrappedHandler(req: any, res: any, next: any) {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

function safeRelativeUploadPath(value: string) {
  try {
    return validateStrictRelativePath(value)
  } catch {
    throw new Error('Invalid upload path')
  }
}

async function writeUploadedFiles(targetDir: string, files: any[]) {
  if (files.length > MAX_IMPORT_FILE_COUNT) {
    throw new Error('Too many files were selected for a single import.')
  }
  const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0)
  if (totalSize > MAX_IMPORT_TOTAL_SIZE) {
    throw new Error('Selected files exceed the aggregate import limit.')
  }
  await fsp.mkdir(targetDir, { recursive: true })
  for (const file of files) {
    const relativeName = safeRelativeUploadPath(file.originalname)
    const absolutePath = safeResolveWithin(targetDir, relativeName)
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true })
    if (file.path) {
      await fsp.copyFile(file.path, absolutePath)
      await fsp.unlink(file.path).catch(() => {})
    } else {
      await fsp.writeFile(absolutePath, file.buffer)
    }
  }
}

async function extractZipToDirectory(targetDir: string, zipPath: string) {
  const unzipper = await import('unzipper')
  await fsp.mkdir(targetDir, { recursive: true })
  try {
    const parser = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }))
    let entryCount = 0
    let uncompressedBytes = 0
    for await (const entry of parser) {
      const relativeName = safeRelativeUploadPath(entry.path)
      const absolutePath = safeResolveWithin(targetDir, relativeName)
      entryCount += 1
      if (entryCount > MAX_ZIP_ENTRY_COUNT) {
        entry.autodrain()
        throw new Error('Zip import contains too many entries.')
      }
      if (entry.type === 'Directory') {
        await fsp.mkdir(absolutePath, { recursive: true })
        entry.autodrain()
        continue
      }
      const declaredSize = Number(entry.vars?.uncompressedSize || 0)
      if (declaredSize > MAX_UPLOAD_FILE_SIZE) {
        entry.autodrain()
        throw new Error('Zip import contains a file over the per-file upload limit.')
      }
      await fsp.mkdir(path.dirname(absolutePath), { recursive: true })
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(absolutePath)
        entry.on('data', (chunk: Buffer) => {
          uncompressedBytes += chunk.length
          if (uncompressedBytes > MAX_ZIP_UNCOMPRESSED_SIZE) {
            entry.destroy(new Error('Zip import exceeds the expanded-size limit.'))
            output.destroy()
          }
        })
        entry.pipe(output)
        output.on('finish', resolve)
        output.on('error', reject)
        entry.on('error', reject)
      })
    }
  } finally {
    await fsp.unlink(zipPath).catch(() => {})
  }
}

function parseImportSessionIdFromPathname(pathname: string) {
  const normalized = safeRelativeUploadPath(pathname)
  const parts = normalized.split('/')
  if (parts.length < 3 || parts[0] !== 'imports' || !parts[1]) {
    throw new Error('Invalid import staging path')
  }
  return {
    sessionId: parts[1],
    pathname: normalized
  }
}

export async function createApp() {
  validateRuntimeConfig()
  const repository = createRepository()
  const workspaceStore = createWorkspaceStore()
  const storageBackend = getStorageBackend()
  const uploadMode = getUploadMode()
  const directUploads = usesDirectUploads()
  await repository.init()

  const upload = multer({
    storage: multer.diskStorage({
      destination: function destination(_req, _file, callback) {
        callback(null, os.tmpdir())
      },
      filename: function filename(_req, file, callback) {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
        callback(null, `${Date.now()}-${crypto.randomUUID()}-${safeName}`)
      }
    }),
    limits: {
      fileSize: MAX_UPLOAD_FILE_SIZE,
      files: 20000
    }
  })

  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use('/vendor', express.static(path.join(ROOT_DIR, 'node_modules')))
  app.use(express.static(DIST_DIR, { index: false }))

  async function loadCurrentUser(req: any) {
    const userId = readSessionUserId(req.headers.cookie)
    if (!userId) {
      return null
    }
    return repository.getUserById(userId)
  }

  app.use(asyncRoute(async function attachUser(req: any, _res: any, next: any) {
    req.user = await loadCurrentUser(req)
    next()
  }))

  function requireAuth(req: any, res: any, next: any) {
    if (!req.user) {
      return jsonError(res, 401, 'Authentication required')
    }
    if (req.user.status !== 'active') {
      return jsonError(res, 403, 'This account is disabled')
    }
    return next()
  }

  function requireAdmin(req: any, res: any, next: any) {
    if (!req.user || req.user.role !== 'admin') {
      return jsonError(res, 403, 'Admin access required')
    }
    return next()
  }

  async function summarizeImportSession(row: any) {
    if (!row) {
      return null
    }
    const pack = row.pack_id ? await repository.getPackById(row.pack_id) : null
    return {
      sessionId: row.id,
      status: row.state,
      error: row.error || '',
      pack: pack ? packSummary(pack) : null
    }
  }

  async function deletePackRow(row: any) {
    if (!row) {
      return
    }
    await repository.deletePack(row.id)
    // Library user-packs share a system workspace — we must only remove the
    // per-user progress directory, never the shared workspace.
    if (row.progress_override_path) {
      await workspaceStore.deleteWorkspace(row.progress_override_path)
    } else {
      const systemPack = await repository.getSystemPackByWorkspacePath(row.workspace_path)
      if (!systemPack) {
        await workspaceStore.deleteWorkspace(row.workspace_path)
      }
    }
  }

  async function loadPackForUser(userId: string, packId: string, blockToOpen: string) {
    const row = await repository.getPackForUser(userId, packId)
    if (!row) {
      return null
    }
    const loaded = await workspaceStore.loadPack(row, blockToOpen)
    return {
      row,
      qbankinfo: loaded.qbankinfo
    }
  }

  async function persistPackProgress(packRow: any, qbankinfo: any, nextRevision: number, syncMetadata?: any) {
    normalizeProgress(qbankinfo.progress, qbankinfo)
    const progressPath = packRow.progress_override_path || packRow.workspace_path
    await workspaceStore.savePackProgress(progressPath, qbankinfo.progress)
    const updatedAt = nowIso()
    await repository.updatePack(packRow.id, {
      revision: nextRevision,
      updatedAt,
      lastClientInstanceId: syncMetadata?.clientInstanceId || packRow.last_client_instance_id || '',
      lastClientMutationSeq: Number.isFinite(syncMetadata?.clientMutationSeq) ? syncMetadata.clientMutationSeq : (packRow.last_client_mutation_seq || 0),
      lastClientUpdatedAt: syncMetadata?.clientUpdatedAt || packRow.last_client_updated_at || ''
    })
    return nextRevision
  }

  async function finalizeImportSession(row: any) {
    if (!row) {
      return null
    }
    if (row.state === 'completed' || row.state === 'failed') {
      return summarizeImportSession(row)
    }

    await repository.updateImportSession(row.id, {
      state: 'finalizing',
      error: '',
      updatedAt: nowIso()
    })

    let finalRow = await repository.getImportSession(row.id)
    try {
      const packId = crypto.randomUUID()
      const finalized = await workspaceStore.finalizeImportedWorkspace(finalRow, packId)
      const timestamp = nowIso()
      await repository.createPack({
        id: packId,
        userId: finalRow.user_id,
        name: sanitizePackName(finalRow.requested_name, finalized.packName),
        workspacePath: finalized.workspacePath,
        questionCount: finalized.questionCount,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      await repository.updateImportSession(finalRow.id, {
        state: 'completed',
        error: '',
        packId,
        updatedAt: timestamp
      })
    } catch (error: any) {
      await repository.updateImportSession(finalRow.id, {
        state: 'failed',
        error: error?.message || 'Import failed',
        updatedAt: nowIso()
      })
    } finally {
      if (storageBackend === 'local') {
        finalRow = await repository.getImportSession(row.id)
        await workspaceStore.cancelImportWorkspace(finalRow)
      }
    }

    return summarizeImportSession(await repository.getImportSession(row.id))
  }

  app.get('/api/health', function health(_req: any, res: any) {
    res.json({ ok: true })
  })

  app.get('/api/ready', asyncRoute(async function ready(_req: any, res: any) {
    await fsp.mkdir(DATA_DIR, { recursive: true })
    const probe = path.join(DATA_DIR, `.ready-${process.pid}-${Date.now()}`)
    await fsp.writeFile(probe, 'ok')
    await fsp.unlink(probe)
    await repository.readinessCheck()
    if (storageBackend === 'railway') {
      await checkS3Readiness()
    }
    res.json({ ok: true, storageBackend })
  }))

  app.get('/api/auth/session', function sessionInfo(req: any, res: any) {
    res.json({ user: req.user || null })
  })

  app.get('/api/auth/config', asyncRoute(async function authConfig(_req: any, res: any) {
    res.json({
      settings: {
        registrationMode: await repository.getRegistrationMode(),
        storageBackend,
        uploadMode,
        directBlobUploads: directUploads
      }
    })
  }))

  app.post('/api/auth/register', asyncRoute(async function register(req: any, res: any) {
    if (await repository.getRegistrationMode() !== 'invite-only') {
      return jsonError(res, 403, 'Registration is currently closed')
    }

    const username = String(req.body.username || '').trim()
    const password = String(req.body.password || '')
    const email = String(req.body.email || '').trim().toLowerCase()
    const inviteToken = String(req.body.inviteToken || '').trim()
    if (!username || !password || !email || !inviteToken) {
      return jsonError(res, 400, 'Username, password, email, and invite token are required')
    }

    const existing = await repository.getUserByUsername(username)
    if (existing) {
      return jsonError(res, 409, 'Username already exists')
    }

    const invite = await repository.getInviteByTokenHash(hashInviteToken(inviteToken))
    if (!invite) {
      return jsonError(res, 404, 'Invite not found')
    }
    if (invite.revoked_at) {
      return jsonError(res, 409, 'Invite has been revoked')
    }
    if (invite.used_at) {
      return jsonError(res, 409, 'Invite has already been used')
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return jsonError(res, 409, 'Invite has expired')
    }
    if (String(invite.email || '').toLowerCase() !== email) {
      return jsonError(res, 400, 'Invite email does not match')
    }

    const userId = crypto.randomUUID()
    const timestamp = nowIso()
    await repository.createUser({
      id: userId,
      username,
      email,
      passwordHash: await buildPasswordHash(password),
      role: invite.role || 'user',
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    })
    await repository.markInviteUsed(invite.id, userId, timestamp)
    setSessionCookie(res, userId)
    res.json({ user: await repository.getUserById(userId) })
  }))

  app.post('/api/auth/login', asyncRoute(async function login(req: any, res: any) {
    const username = String(req.body.username || '').trim()
    const password = String(req.body.password || '')
    if (!username || !password) {
      return jsonError(res, 400, 'Username and password are required')
    }

    const user = await repository.getUserByUsername(username)
    if (!user) {
      return jsonError(res, 401, 'Invalid username or password')
    }
    if (!(await comparePassword(password, user.password_hash))) {
      return jsonError(res, 401, 'Invalid username or password')
    }
    if (user.status !== 'active') {
      return jsonError(res, 403, 'This account is disabled')
    }

    setSessionCookie(res, user.id)
    res.json({ user: await repository.getUserById(user.id) })
  }))

  app.post('/api/auth/logout', function logout(_req: any, res: any) {
    clearSessionCookie(res)
    res.json({ ok: true })
  })

  app.get('/api/admin/settings', requireAuth, requireAdmin, asyncRoute(async function getAdminSettings(_req: any, res: any) {
    res.json({
      settings: {
        registrationMode: await repository.getRegistrationMode()
      }
    })
  }))

  app.put('/api/admin/settings', requireAuth, requireAdmin, asyncRoute(async function updateAdminSettings(req: any, res: any) {
    const requestedMode = String(req.body?.settings?.registrationMode || '').trim()
    if (requestedMode !== 'invite-only' && requestedMode !== 'closed') {
      return jsonError(res, 400, 'registrationMode must be invite-only or closed')
    }
    res.json({
      settings: {
        registrationMode: await repository.setRegistrationMode(requestedMode)
      }
    })
  }))

  app.get('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async function listAdminUsers(_req: any, res: any) {
    const rows = await repository.listUsers()
    res.json({ users: rows.map(adminUserSummary) })
  }))

  app.post('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async function createAdminUser(req: any, res: any) {
    const username = String(req.body.username || '').trim()
    const password = String(req.body.password || '')
    const email = String(req.body.email || '').trim().toLowerCase()
    const role = req.body.role === 'admin' ? 'admin' : 'user'
    if (!username || !password || !email) {
      return jsonError(res, 400, 'Username, password, and email are required')
    }
    if (await repository.getUserByUsername(username)) {
      return jsonError(res, 409, 'Username already exists')
    }
    const userId = crypto.randomUUID()
    const timestamp = nowIso()
    await repository.createUser({
      id: userId,
      username,
      email,
      passwordHash: await buildPasswordHash(password),
      role,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    })
    const created = await repository.getUserById(userId)
    res.status(201).json({ user: adminUserSummary({ ...created, updated_at: timestamp, pack_count: 0 }) })
  }))

  app.patch('/api/admin/users/:userId', requireAuth, requireAdmin, asyncRoute(async function updateAdminUser(req: any, res: any) {
    const existing = await repository.getUserById(String(req.params.userId || ''))
    if (!existing) {
      return jsonError(res, 404, 'User not found')
    }
    const nextEmail = req.body.email !== undefined ? String(req.body.email || '').trim().toLowerCase() : existing.email
    const nextRole = req.body.role === 'admin' ? 'admin' : (req.body.role === 'user' ? 'user' : existing.role)
    const nextStatus = req.body.status === 'disabled' ? 'disabled' : (req.body.status === 'active' ? 'active' : existing.status)
    if (!nextEmail) {
      return jsonError(res, 400, 'Email is required')
    }
    if (existing.id === req.user.id && nextRole !== 'admin') {
      return jsonError(res, 400, 'You cannot remove your own admin access')
    }
    if (existing.id === req.user.id && nextStatus !== 'active') {
      return jsonError(res, 400, 'You cannot disable your own account')
    }
    await repository.updateUser(existing.id, {
      email: nextEmail,
      role: nextRole,
      status: nextStatus,
      updatedAt: nowIso()
    })
    const updatedRows = await repository.listUsers()
    const updated = updatedRows.find((row: any) => row.id === existing.id)
    res.json({ user: adminUserSummary(updated) })
  }))

  app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, asyncRoute(async function deleteAdminUser(req: any, res: any) {
    const userId = String(req.params.userId || '')
    if (userId === req.user.id) {
      return jsonError(res, 400, 'You cannot delete your own account')
    }
    const user = await repository.getUserById(userId)
    if (!user) {
      return jsonError(res, 404, 'User not found')
    }
    const packs = await repository.listPacksForUser(userId)
    for (const packRow of packs) {
      await deletePackRow(packRow)
    }
    await repository.deleteUser(userId)
    res.json({ ok: true })
  }))

  app.get('/api/admin/users/:userId/packs', requireAuth, requireAdmin, asyncRoute(async function listAdminUserPacks(req: any, res: any) {
    const user = await repository.getUserById(String(req.params.userId || ''))
    if (!user) {
      return jsonError(res, 404, 'User not found')
    }
    const rows = await repository.listPacksForUser(user.id)
    res.json({ packs: rows.map(packSummary) })
  }))

  app.delete('/api/admin/packs/:packId', requireAuth, requireAdmin, asyncRoute(async function deleteAdminPack(req: any, res: any) {
    const row = await repository.getPackById(String(req.params.packId || ''))
    if (!row) {
      return jsonError(res, 404, 'Study pack not found')
    }
    await deletePackRow(row)
    res.json({ ok: true })
  }))

  app.post('/api/admin/packs/:packId/reset', requireAuth, requireAdmin, asyncRoute(async function resetAdminPack(req: any, res: any) {
    const row = await repository.getPackById(String(req.params.packId || ''))
    if (!row) {
      return jsonError(res, 404, 'Study pack not found')
    }
    const loaded = await workspaceStore.loadPack(row, '')
    loaded.qbankinfo.progress = {
      blockhist: {},
      tagbuckets: {}
    }
    normalizeProgress(loaded.qbankinfo.progress, loaded.qbankinfo)
    const nextRevision = await persistPackProgress(row, loaded.qbankinfo, Number(row.revision || 0) + 1)
    res.json({ revision: nextRevision })
  }))

  app.get('/api/admin/packs/:packId/progress-summary', requireAuth, requireAdmin, asyncRoute(async function getAdminPackProgress(req: any, res: any) {
    const row = await repository.getPackById(String(req.params.packId || ''))
    if (!row) {
      return jsonError(res, 404, 'Study pack not found')
    }
    const loaded = await workspaceStore.loadPack(row, '')
    const progress = loaded.qbankinfo.progress
    const blockhist = progress.blockhist || {}
    const blockKeys = Object.keys(blockhist)
    let completedBlocks = 0
    let correctCount = 0
    for (const key of blockKeys) {
      const block = blockhist[key]
      if (!block) continue
      if (block.complete) {
        completedBlocks += 1
        correctCount += Number(block.numcorrect || 0)
      }
    }
    const primaryTag = loaded.qbankinfo.tagnames.tagnames['0'] ?? ''
    let totalQuestions = 0
    let unusedCount = 0
    const primaryBuckets = progress.tagbuckets?.[primaryTag] ?? {}
    for (const subtag of Object.keys(primaryBuckets)) {
      const bucket = primaryBuckets[subtag]
      if (!bucket) continue
      totalQuestions += bucket.all?.length || 0
      unusedCount += bucket.unused?.length || 0
    }
    // "Incorrect" in the plan = currently-incorrect questions (the bucket).
    let incorrectCount = 0
    for (const subtag of Object.keys(primaryBuckets)) {
      const bucket = primaryBuckets[subtag]
      if (!bucket) continue
      incorrectCount += bucket.incorrects?.length || 0
    }
    res.json({
      totalBlocks: blockKeys.length,
      completedBlocks,
      totalQuestions,
      correctCount,
      unusedCount,
      incorrectCount
    })
  }))

  app.get('/api/admin/invites', requireAuth, requireAdmin, asyncRoute(async function listAdminInvites(_req: any, res: any) {
    const rows = await repository.listInvites()
    res.json({ invites: rows.map(inviteSummary) })
  }))

  app.post('/api/admin/invites', requireAuth, requireAdmin, asyncRoute(async function createAdminInvite(req: any, res: any) {
    const email = String(req.body.email || '').trim().toLowerCase()
    const role = req.body.role === 'admin' ? 'admin' : 'user'
    const expiresInDaysRaw = Number(req.body.expiresInDays || 7)
    const expiresInDays = Number.isFinite(expiresInDaysRaw) ? Math.min(Math.max(Math.round(expiresInDaysRaw), 1), 90) : 7
    if (!email) {
      return jsonError(res, 400, 'Email is required')
    }
    const { rawToken, tokenHash } = createInviteToken()
    const inviteId = crypto.randomUUID()
    const createdAt = nowIso()
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    await repository.createInvite({
      id: inviteId,
      email,
      tokenHash,
      role,
      createdBy: req.user.id,
      createdAt,
      updatedAt: createdAt,
      expiresAt
    })
    const created = (await repository.listInvites()).find((row: any) => row.id === inviteId)
    const inviteUrl = new URL('/', getPublicOrigin(req))
    inviteUrl.searchParams.set('invite', rawToken)
    inviteUrl.searchParams.set('email', email)
    const inviteUrlString = inviteUrl.toString()
    // Fire-and-forget: we return the response immediately so invite creation
    // never blocks on email delivery. Errors are logged, not surfaced.
    const emailConfigured = isEmailConfigured()
    if (emailConfigured) {
      void sendInviteEmail(email, inviteUrlString).catch((error) => {
        console.warn('Failed to send invite email:', error)
      })
    }
    res.status(201).json({
      invite: inviteSummary(created),
      inviteUrl: inviteUrlString,
      emailSent: emailConfigured
    })
  }))

  app.post('/api/admin/invites/:inviteId/revoke', requireAuth, requireAdmin, asyncRoute(async function revokeAdminInvite(req: any, res: any) {
    const invite = await repository.getInviteById(String(req.params.inviteId || ''))
    if (!invite) {
      return jsonError(res, 404, 'Invite not found')
    }
    if (invite.used_at) {
      return jsonError(res, 409, 'Used invites cannot be revoked')
    }
    if (!invite.revoked_at) {
      await repository.revokeInvite(invite.id, nowIso())
    }
    res.json({ ok: true })
  }))

  // --- Library (system packs) ------------------------------------------------
  //
  // Library packs are admin-curated study packs shared across all users. Each
  // user that "activates" a library pack gets their own per-user progress while
  // reading the shared workspace. See workspace-store `progress_override_path`.

  function systemPackSummary(row: any) {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      questionCount: Number(row.question_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  async function readJsonFile(filePath: string) {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'))
  }

  async function writeJsonFile(filePath: string, value: any) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    await fsp.writeFile(filePath, JSON.stringify(value, null, 2))
  }

  function firstTextFromBlocks(blocks: any[] | undefined): string {
    if (!Array.isArray(blocks)) {
      return ''
    }
    const parts: string[] = []
    for (const block of blocks) {
      if (block?.type === 'paragraph' && typeof block.text === 'string') {
        parts.push(block.text)
      } else if (block?.type === 'list' && Array.isArray(block.items)) {
        parts.push(...block.items.filter((item: unknown): item is string => typeof item === 'string'))
      } else if (block?.type === 'table' && Array.isArray(block.rows)) {
        for (const row of block.rows) {
          if (Array.isArray(row)) {
            parts.push(row.filter((cell: unknown): cell is string => typeof cell === 'string').join(' '))
          }
        }
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  }

  function computeQuestionContentHash(question: any): string {
    const clone = JSON.parse(JSON.stringify(question))
    if (clone?.integrity && typeof clone.integrity === 'object') {
      clone.integrity.contentHash = ''
    }
    return sha256Json(clone)
  }

  function computeManifestHash(manifest: any): string {
    const clone = JSON.parse(JSON.stringify(manifest))
    if (clone?.revision && typeof clone.revision === 'object') {
      clone.revision.hash = ''
    }
    return sha256Json(clone)
  }

  function manifestEntryFromQuestion(question: any, existingEntry: any = {}, changeSummary = '') {
    const qid = validateNativeQuestionId(String(question.id))
    const orderedChoices = Array.isArray(question?.choices)
      ? [...question.choices].sort((a, b) => Number(a?.displayOrder ?? 0) - Number(b?.displayOrder ?? 0))
      : []
    return {
      ...existingEntry,
      id: qid,
      path: validateStrictRelativePath(String(existingEntry.path || `questions/${qid}.json`)),
      status: question.status,
      ...(existingEntry.replacesQuestionId ? { replacesQuestionId: existingEntry.replacesQuestionId } : {}),
      ...(changeSummary ? { changeSummary } : (existingEntry.changeSummary ? { changeSummary: existingEntry.changeSummary } : {})),
      titlePreview: firstTextFromBlocks(question?.stem?.blocks) || existingEntry.titlePreview || question.id,
      tags: question.tags,
      contentHash: question.integrity.contentHash,
      source: {
        documentId: question.source?.documentId || '',
        slideNumber: question.source?.slideNumber || 1,
        questionIndex: question.source?.questionIndex || 1
      },
      answerSummary: {
        correctChoiceId: question.answerKey?.correctChoiceId || '',
        choices: orderedChoices.map((choice) => ({
          id: String(choice.id),
          label: String(choice.label || choice.id),
          displayOrder: Number(choice.displayOrder || 1)
        }))
      }
    }
  }

  function rebuildTagIndex(questionIndex: any[]) {
    const fields = ['rotation', 'subject', 'system', 'topic']
    const next: Record<string, string[]> = {}
    for (const field of fields) {
      const values = new Set<string>()
      for (const entry of questionIndex) {
        const value = entry?.tags?.[field]
        if (typeof value === 'string' && value.trim()) {
          values.add(value.trim())
        }
      }
      next[field] = Array.from(values).sort((left, right) => left.localeCompare(right))
    }
    return next
  }

  async function resolveNativeSourceWorkspace(body: any) {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'quail-native-source-'))
    const sourceStudyPackId = String(body?.sourceStudyPackId || '').trim()
    const sourcePath = String(body?.sourcePath || '').trim()

    if (sourceStudyPackId) {
      const sourcePack = await repository.getPackById(sourceStudyPackId)
      if (!sourcePack) {
        throw new Error('Source study pack not found.')
      }
      const materialized = await workspaceStore.materializeWorkspace(sourcePack.workspace_path)
      const workspaceRoot = await findWorkspaceRoot(materialized)
      await fsp.cp(workspaceRoot, tempRoot, { recursive: true })
      await fsp.rm(materialized, { recursive: true, force: true })
      return tempRoot
    }

    if (sourcePath) {
      const workspaceRoot = await findWorkspaceRoot(path.resolve(sourcePath))
      await fsp.cp(workspaceRoot, tempRoot, { recursive: true })
      return tempRoot
    }

    await fsp.rm(tempRoot, { recursive: true, force: true })
    throw new Error('Provide sourcePath or sourceStudyPackId.')
  }

  async function materializeSystemNativePack(systemPack: any) {
    const workspaceRoot = await workspaceStore.materializeWorkspace(systemPack.workspace_path)
    const manifestPath = path.join(workspaceRoot, NATIVE_QBANK_MANIFEST)
    if (!fs.existsSync(manifestPath)) {
      return {
        workspaceRoot,
        native: false,
        manifest: null,
        validation: null
      }
    }
    const validation = await validateNativeQbankDirectory(workspaceRoot)
    return {
      workspaceRoot,
      native: true,
      manifest: validation.manifest ?? await readJsonFile(manifestPath),
      validation
    }
  }

  async function loadNativeQuestionDocuments(workspaceRoot: string, manifest: any) {
    const questions: Record<string, any> = {}
    for (const entry of Array.isArray(manifest?.questionIndex) ? manifest.questionIndex : []) {
      const questionPath = safeResolveWithin(workspaceRoot, String(entry.path || ''))
      questions[String(entry.id)] = await readJsonFile(questionPath)
    }
    return questions
  }

  async function rewriteNativeManifestFromQuestions(workspaceRoot: string, manifest: any, questions: Record<string, any>, changeSummary = '') {
    const currentEntries = new Map((Array.isArray(manifest.questionIndex) ? manifest.questionIndex : []).map((entry: any) => [String(entry.id), entry]))
    const questionIndex = Object.values(questions)
      .sort((left: any, right: any) => String(left.id).localeCompare(String(right.id)))
      .map((question: any) => {
        question.integrity ??= {}
        question.integrity.contentHash = computeQuestionContentHash(question)
        return manifestEntryFromQuestion(question, currentEntries.get(String(question.id)) || {}, changeSummary)
      })

    const previousHash = String(manifest?.revision?.hash || '')
    manifest.questionIndex = questionIndex
    manifest.tagIndex = rebuildTagIndex(questionIndex)
    manifest.updatedAt = nowIso()
    manifest.validation = {
      status: 'passed',
      errors: [],
      warnings: Array.isArray(manifest?.validation?.warnings) ? manifest.validation.warnings : [],
      blockedQuestionCount: questionIndex.filter((entry: any) => entry.status === 'blocked').length
    }
    manifest.revision = {
      number: Number(manifest?.revision?.number || 0) + 1,
      previousHash,
      hash: ''
    }
    manifest.revision.hash = computeManifestHash(manifest)

    for (const entry of questionIndex) {
      await writeJsonFile(safeResolveWithin(workspaceRoot, entry.path), questions[entry.id])
    }
    await writeJsonFile(safeResolveWithin(workspaceRoot, NATIVE_QBANK_MANIFEST), manifest)
    return manifest
  }

  async function prepareNativeWorkspaceForPublish(workspaceRoot: string, currentManifest?: any) {
    const manifestPath = path.join(workspaceRoot, NATIVE_QBANK_MANIFEST)
    const manifest = await readJsonFile(manifestPath)
    if (currentManifest) {
      const nextRevision = Math.max(Number(manifest?.revision?.number || 0), Number(currentManifest?.revision?.number || 0) + 1)
      manifest.updatedAt = nowIso()
      manifest.revision = {
        number: nextRevision,
        previousHash: String(currentManifest?.revision?.hash || manifest?.revision?.previousHash || ''),
        hash: ''
      }
      manifest.revision.hash = computeManifestHash(manifest)
      await writeJsonFile(manifestPath, manifest)
    }
    return loadWorkspaceData(workspaceRoot)
  }

  async function publishPreparedNativeWorkspace(systemPack: any, workspaceRoot: string, qbankinfo: any) {
    const timestamp = nowIso()
    const questionCount = Object.keys(qbankinfo.index || {}).length
    await workspaceStore.replaceWorkspaceFromLocalDirectory(systemPack.workspace_path, workspaceRoot)
    await repository.updateSystemPack(systemPack.id, {
      questionCount,
      updatedAt: timestamp
    })

    const userPacks = await repository.listAllPacks()
    for (const userPack of userPacks) {
      if (userPack.workspace_path !== systemPack.workspace_path) {
        continue
      }
      await repository.updatePack(userPack.id, {
        questionCount,
        revision: Number(userPack.revision || 0) + 1,
        updatedAt: timestamp
      })
    }
  }

  app.get('/api/library', requireAuth, asyncRoute(async function listLibrary(_req: any, res: any) {
    const rows = await repository.listSystemPacks()
    res.json({ packs: rows.map(systemPackSummary) })
  }))

  // Admins promote one of their own finalized study packs to the library.
  // This is the pragmatic alternative to a dedicated upload-and-finalize flow:
  // admins already use the standard import flow, and "Promote to Library"
  // reuses the resulting workspace as the shared library workspace.
  app.post('/api/library/promote/:packId', requireAuth, requireAdmin, asyncRoute(async function promoteLibrary(req: any, res: any) {
    const row = await repository.getPackById(String(req.params.packId || ''))
    if (!row) {
      return jsonError(res, 404, 'Study pack not found')
    }
    if (row.progress_override_path) {
      return jsonError(res, 400, 'Cannot promote an imported library pack.')
    }
    const name = String(req.body?.name || row.name || '').trim() || row.name
    const description = String(req.body?.description || '').trim()
    const systemPackId = crypto.randomUUID()
    const timestamp = nowIso()
    // Move the pack's workspace to a dedicated system-pack location so the
    // shared workspace is decoupled from the admin's personal account.
    let systemWorkspacePath = row.workspace_path
    if (storageBackend === 'local') {
      const finalRoot = path.join(ROOT_DIR, 'data', 'system-packs', systemPackId)
      await fsp.mkdir(finalRoot, { recursive: true })
      systemWorkspacePath = path.join(finalRoot, 'workspace')
      await fsp.cp(row.workspace_path, systemWorkspacePath, { recursive: true })
    } else if (storageBackend === 'cloud') {
      systemWorkspacePath = `system-packs/${systemPackId}/workspace`
      await copyBlobPrefix(row.workspace_path, systemWorkspacePath)
    } else {
      systemWorkspacePath = `system-packs/${systemPackId}/workspace`
      await copyS3Prefix(row.workspace_path, systemWorkspacePath)
    }
    await repository.createSystemPack({
      id: systemPackId,
      name,
      description,
      questionCount: Number(row.question_count || 0),
      workspacePath: systemWorkspacePath,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    await deletePackRow(row)
    res.status(201).json({ pack: systemPackSummary(await repository.getSystemPackById(systemPackId)) })
  }))

  app.delete('/api/library/:id', requireAuth, requireAdmin, asyncRoute(async function deleteLibraryPack(req: any, res: any) {
    const systemPack = await repository.getSystemPackById(String(req.params.id || ''))
    if (!systemPack) {
      return jsonError(res, 404, 'Library pack not found')
    }
    // Remove any user packs that reference this system pack.
    const userPacks = await repository.listAllPacks()
    for (const userPack of userPacks) {
      if (userPack.workspace_path === systemPack.workspace_path) {
        await deletePackRow(userPack)
      }
    }
    await repository.deleteAnswerAnalyticsForSystemPack(systemPack.id)
    await repository.deleteSystemPack(systemPack.id)
    if (storageBackend !== 'railway') {
      await workspaceStore.deleteWorkspace(systemPack.workspace_path)
    }
    res.json({ ok: true })
  }))

  app.post('/api/library/:id/import', requireAuth, asyncRoute(async function importLibraryPack(req: any, res: any) {
    const systemPack = await repository.getSystemPackById(String(req.params.id || ''))
    if (!systemPack) {
      return jsonError(res, 404, 'Library pack not found')
    }
    // Prevent duplicate imports per user (same shared workspace).
    const existingPacks = await repository.listPacksForUser(req.user.id)
    const duplicate = existingPacks.find((p: any) => p.workspace_path === systemPack.workspace_path)
    if (duplicate) {
      return res.status(200).json({ pack: packSummary(duplicate) })
    }
    const userPackId = crypto.randomUUID()
    const timestamp = nowIso()
    let progressOverridePath: string
    if (storageBackend === 'local') {
      progressOverridePath = path.join(ROOT_DIR, 'data', 'study-packs', userPackId, 'progress')
    } else {
      progressOverridePath = `study-packs/${userPackId}/progress`
    }
    await workspaceStore.initProgressOverride(systemPack.workspace_path, progressOverridePath)
    await repository.createPack({
      id: userPackId,
      userId: req.user.id,
      name: systemPack.name,
      workspacePath: systemPack.workspace_path,
      progressOverridePath,
      questionCount: Number(systemPack.question_count || 0),
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    const created = await repository.getPackById(userPackId)
    res.status(201).json({ pack: packSummary(created) })
  }))

  app.get('/api/admin/native-packs/:packId/content', requireAuth, requireAdmin, asyncRoute(async function getNativePackContent(req: any, res: any) {
    const systemPack = await repository.getSystemPackById(String(req.params.packId || ''))
    if (!systemPack) {
      return jsonError(res, 404, 'Library pack not found')
    }
    const materialized = await materializeSystemNativePack(systemPack)
    try {
      if (!materialized.native || !materialized.manifest) {
        return res.json({
          pack: systemPackSummary(systemPack),
          native: false,
          error: 'This library pack is legacy. Dynamic content editing is available for native packs only.'
        })
      }
      const questions = materialized.validation?.questions || await loadNativeQuestionDocuments(materialized.workspaceRoot, materialized.manifest)
      const questionSummaries = (materialized.manifest.questionIndex || []).map((entry: any) => (
        summarizeNativeQuestion(entry, questions[String(entry.id)])
      ))
      res.json({
        pack: systemPackSummary(systemPack),
        native: true,
        manifest: {
          packId: materialized.manifest.packId,
          title: materialized.manifest.title,
          revision: materialized.manifest.revision,
          validation: materialized.manifest.validation,
          activeQuestionCount: activeNativeQuestionCount(materialized.manifest),
          totalQuestionCount: questionSummaries.length
        },
        validation: {
          ok: Boolean(materialized.validation?.ok),
          errors: materialized.validation?.errors || [],
          warnings: materialized.validation?.warnings || []
        },
        questions: questionSummaries
      })
    } finally {
      await fsp.rm(materialized.workspaceRoot, { recursive: true, force: true })
    }
  }))

  app.get('/api/admin/native-packs/:packId/questions/:qid', requireAuth, requireAdmin, asyncRoute(async function getNativePackQuestion(req: any, res: any) {
    const systemPack = await repository.getSystemPackById(String(req.params.packId || ''))
    if (!systemPack) {
      return jsonError(res, 404, 'Library pack not found')
    }
    const materialized = await materializeSystemNativePack(systemPack)
    try {
      if (!materialized.native || !materialized.manifest) {
        return jsonError(res, 400, 'This library pack is legacy.')
      }
      const entry = (materialized.manifest.questionIndex || []).find((item: any) => String(item.id) === String(req.params.qid || ''))
      if (!entry) {
        return jsonError(res, 404, 'Question not found')
      }
      const question = await readJsonFile(safeResolveWithin(materialized.workspaceRoot, entry.path))
      res.json({ question })
    } finally {
      await fsp.rm(materialized.workspaceRoot, { recursive: true, force: true })
    }
  }))

  app.post('/api/admin/native-packs/:packId/validate', requireAuth, requireAdmin, asyncRoute(async function validateNativeRevision(req: any, res: any) {
    const systemPack = await repository.getSystemPackById(String(req.params.packId || ''))
    if (!systemPack) {
      return jsonError(res, 404, 'Library pack not found')
    }
    const current = await materializeSystemNativePack(systemPack)
    let sourceRoot = ''
    try {
      if (!current.native || !current.manifest) {
        return jsonError(res, 400, 'This library pack is legacy. Native revisions can only target native library packs.')
      }
      sourceRoot = await resolveNativeSourceWorkspace(req.body)
      const sourceValidation = await validateNativeQbankDirectory(sourceRoot)
      const incomingManifest = sourceValidation.manifest || (fs.existsSync(path.join(sourceRoot, NATIVE_QBANK_MANIFEST)) ? await readJsonFile(path.join(sourceRoot, NATIVE_QBANK_MANIFEST)) : null)
      const diff = incomingManifest
        ? diffNativePackManifests(current.manifest, incomingManifest, current.manifest.packId)
        : diffNativePackManifests(current.manifest, {}, current.manifest.packId)
      diff.errors.push(...sourceValidation.errors)
      diff.warnings.push(...sourceValidation.warnings)
      diff.canPublish = diff.errors.length === 0
      res.json({ diff, validation: { ok: sourceValidation.ok, errors: sourceValidation.errors, warnings: sourceValidation.warnings } })
    } finally {
      if (sourceRoot) {
        await fsp.rm(sourceRoot, { recursive: true, force: true })
      }
      await fsp.rm(current.workspaceRoot, { recursive: true, force: true })
    }
  }))

  app.post('/api/admin/native-packs/:packId/revisions', requireAuth, requireAdmin, asyncRoute(async function publishNativeRevision(req: any, res: any) {
    const systemPack = await repository.getSystemPackById(String(req.params.packId || ''))
    if (!systemPack) {
      return jsonError(res, 404, 'Library pack not found')
    }
    const current = await materializeSystemNativePack(systemPack)
    let sourceRoot = ''
    try {
      if (!current.native || !current.manifest) {
        return jsonError(res, 400, 'This library pack is legacy. Native revisions can only target native library packs.')
      }
      sourceRoot = await resolveNativeSourceWorkspace(req.body)
      const sourceValidation = await validateNativeQbankDirectory(sourceRoot)
      if (!sourceValidation.manifest) {
        return jsonError(res, 400, 'Incoming pack is missing a native manifest.')
      }
      const diff = diffNativePackManifests(current.manifest, sourceValidation.manifest, current.manifest.packId)
      diff.errors.push(...sourceValidation.errors)
      diff.warnings.push(...sourceValidation.warnings)
      diff.canPublish = diff.errors.length === 0
      if (!diff.canPublish || !sourceValidation.ok) {
        return res.status(400).json({ diff, validation: { ok: sourceValidation.ok, errors: sourceValidation.errors, warnings: sourceValidation.warnings } })
      }
      const prepared = await prepareNativeWorkspaceForPublish(sourceRoot, current.manifest)
      await publishPreparedNativeWorkspace(systemPack, sourceRoot, prepared)
      const updated = await repository.getSystemPackById(systemPack.id)
      res.json({ pack: systemPackSummary(updated), diff })
    } finally {
      if (sourceRoot) {
        await fsp.rm(sourceRoot, { recursive: true, force: true })
      }
      await fsp.rm(current.workspaceRoot, { recursive: true, force: true })
    }
  }))

  app.patch('/api/admin/native-packs/:packId/questions/:qid', requireAuth, requireAdmin, asyncRoute(async function updateNativeQuestion(req: any, res: any) {
    const systemPack = await repository.getSystemPackById(String(req.params.packId || ''))
    if (!systemPack) {
      return jsonError(res, 404, 'Library pack not found')
    }
    const materialized = await materializeSystemNativePack(systemPack)
    try {
      if (!materialized.native || !materialized.manifest) {
        return jsonError(res, 400, 'This library pack is legacy.')
      }
      const qid = validateNativeQuestionId(String(req.params.qid || ''))
      const questions = await loadNativeQuestionDocuments(materialized.workspaceRoot, materialized.manifest)
      const question = req.body?.question
      if (!question || typeof question !== 'object' || String(question.id || '') !== qid) {
        return jsonError(res, 400, 'Request body must include a full question document with the matching id.')
      }
      if (!questions[qid]) {
        return jsonError(res, 404, 'Question not found')
      }
      questions[qid] = question
      await rewriteNativeManifestFromQuestions(materialized.workspaceRoot, materialized.manifest, questions, String(req.body?.changeSummary || 'Manual admin edit'))
      const validation = await validateNativeQbankDirectory(materialized.workspaceRoot)
      if (!validation.ok) {
        return res.status(400).json({ validation: { ok: false, errors: validation.errors, warnings: validation.warnings } })
      }
      const prepared = await prepareNativeWorkspaceForPublish(materialized.workspaceRoot)
      await publishPreparedNativeWorkspace(systemPack, materialized.workspaceRoot, prepared)
      res.json({ question: questions[qid], validation: { ok: true, errors: [], warnings: validation.warnings } })
    } finally {
      await fsp.rm(materialized.workspaceRoot, { recursive: true, force: true })
    }
  }))

  app.post('/api/admin/native-packs/:packId/questions', requireAuth, requireAdmin, asyncRoute(async function createNativeQuestion(req: any, res: any) {
    const systemPack = await repository.getSystemPackById(String(req.params.packId || ''))
    if (!systemPack) {
      return jsonError(res, 404, 'Library pack not found')
    }
    const materialized = await materializeSystemNativePack(systemPack)
    try {
      if (!materialized.native || !materialized.manifest) {
        return jsonError(res, 400, 'This library pack is legacy.')
      }
      const question = req.body?.question
      const qid = validateNativeQuestionId(String(question?.id || ''))
      if (!question || typeof question !== 'object' || !qid) {
        return jsonError(res, 400, 'Request body must include a full question document with an id.')
      }
      const questions = await loadNativeQuestionDocuments(materialized.workspaceRoot, materialized.manifest)
      if (questions[qid]) {
        return jsonError(res, 409, 'Question id already exists.')
      }
      questions[qid] = question
      materialized.manifest.questionIndex.push({ id: qid, path: validateStrictRelativePath(`questions/${qid}.json`) })
      await rewriteNativeManifestFromQuestions(materialized.workspaceRoot, materialized.manifest, questions, String(req.body?.changeSummary || 'Manual admin add'))
      const validation = await validateNativeQbankDirectory(materialized.workspaceRoot)
      if (!validation.ok) {
        return res.status(400).json({ validation: { ok: false, errors: validation.errors, warnings: validation.warnings } })
      }
      const prepared = await prepareNativeWorkspaceForPublish(materialized.workspaceRoot)
      await publishPreparedNativeWorkspace(systemPack, materialized.workspaceRoot, prepared)
      res.status(201).json({ question, validation: { ok: true, errors: [], warnings: validation.warnings } })
    } finally {
      await fsp.rm(materialized.workspaceRoot, { recursive: true, force: true })
    }
  }))

  app.post('/api/admin/native-packs/:packId/questions/:qid/deprecate', requireAuth, requireAdmin, asyncRoute(async function deprecateNativeQuestion(req: any, res: any) {
    const systemPack = await repository.getSystemPackById(String(req.params.packId || ''))
    if (!systemPack) {
      return jsonError(res, 404, 'Library pack not found')
    }
    const materialized = await materializeSystemNativePack(systemPack)
    try {
      if (!materialized.native || !materialized.manifest) {
        return jsonError(res, 400, 'This library pack is legacy.')
      }
      const qid = validateNativeQuestionId(String(req.params.qid || ''))
      const questions = await loadNativeQuestionDocuments(materialized.workspaceRoot, materialized.manifest)
      const question = questions[qid]
      if (!question) {
        return jsonError(res, 404, 'Question not found')
      }
      question.status = 'deprecated'
      question.quality ??= {}
      question.quality.reviewStatus = question.quality.reviewStatus || 'edited'
      questions[qid] = question
      await rewriteNativeManifestFromQuestions(materialized.workspaceRoot, materialized.manifest, questions, String(req.body?.changeSummary || 'Deprecated by admin'))
      const validation = await validateNativeQbankDirectory(materialized.workspaceRoot)
      if (!validation.ok) {
        return res.status(400).json({ validation: { ok: false, errors: validation.errors, warnings: validation.warnings } })
      }
      const prepared = await prepareNativeWorkspaceForPublish(materialized.workspaceRoot)
      await publishPreparedNativeWorkspace(systemPack, materialized.workspaceRoot, prepared)
      res.json({ question, validation: { ok: true, errors: [], warnings: validation.warnings } })
    } finally {
      await fsp.rm(materialized.workspaceRoot, { recursive: true, force: true })
    }
  }))

  app.get('/api/study-packs', requireAuth, asyncRoute(async function listPacks(req: any, res: any) {
    const rows = await repository.listPacksForUser(req.user.id)
    res.json({ packs: rows.map(packSummary) })
  }))

  app.post('/api/study-packs/import/folder-session', requireAuth, asyncRoute(async function beginFolderImport(req: any, res: any) {
    const sessionId = crypto.randomUUID()
    const timestamp = nowIso()
    if (storageBackend !== 'local') {
      await repository.createImportSession({
        id: sessionId,
        userId: req.user.id,
        requestedName: String(req.body.packName || ''),
        stagingPrefix: `imports/${sessionId}`,
        state: 'uploading',
        createdAt: timestamp,
        updatedAt: timestamp
      })
    } else {
      const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'quail-ultra-live-import-'))
      const uploadRoot = path.join(tempRoot, 'upload')
      await fsp.mkdir(uploadRoot, { recursive: true })
      await repository.createImportSession({
        id: sessionId,
        userId: req.user.id,
        requestedName: String(req.body.packName || ''),
        tempRoot,
        uploadRoot,
        state: 'uploading',
        createdAt: timestamp,
        updatedAt: timestamp
      })
    }
    res.json({ sessionId })
  }))

  app.post('/api/study-packs/import/uploads', asyncRoute(async function handleClientBlobUploads(req: any, res: any) {
    if (uploadMode !== 'vercel-blob') {
      return jsonError(res, 404, 'Direct blob uploads are not enabled for this environment')
    }
    const body = req.body
    const response = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname: string) => {
        const currentUser = await loadCurrentUser(req)
        if (!currentUser) {
          throw new Error('Authentication required')
        }
        const parsed = parseImportSessionIdFromPathname(pathname)
        const session = await repository.getImportSession(parsed.sessionId)
        if (!session || session.user_id !== currentUser.id) {
          throw new Error('Import session not found')
        }
        if (session.state !== 'uploading') {
          throw new Error('Import session is no longer accepting files')
        }
        if (!pathname.startsWith(`${session.staging_prefix}/`)) {
          throw new Error('Upload path does not match the active import session')
        }
        return {
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: MAX_UPLOAD_FILE_SIZE,
          validUntil: Date.now() + 15 * 60 * 1000,
          tokenPayload: JSON.stringify({ sessionId: session.id, userId: currentUser.id })
        }
      },
      onUploadCompleted: async () => {}
    })
    res.json(response)
  }))

  app.post('/api/study-packs/import/upload-urls', requireAuth, asyncRoute(async function createImportUploadUrls(req: any, res: any) {
    if (uploadMode !== 'presigned') {
      return jsonError(res, 404, 'Presigned uploads are not enabled for this environment')
    }
    const session = await repository.getImportSession(String(req.body?.sessionId || ''))
    if (!session || session.user_id !== req.user.id) {
      return jsonError(res, 404, 'Import session not found')
    }
    if (session.state !== 'uploading') {
      return jsonError(res, 409, 'Import session is no longer accepting files')
    }
    const files = Array.isArray(req.body?.files) ? req.body.files : []
    if (files.length === 0) {
      return jsonError(res, 400, 'Select files to upload')
    }
    if (files.length > MAX_IMPORT_FILE_COUNT) {
      return jsonError(res, 413, 'Too many files were selected for a single import.')
    }
    const validatedFiles = []
    let declaredTotalSize = 0
    for (const entry of files) {
      let relativePath: string
      try {
        relativePath = safeRelativeUploadPath(String(entry?.relativePath || ''))
      } catch (_error) {
        return jsonError(res, 400, 'Invalid upload path')
      }
      const declaredSize = Number(entry?.size)
      if (!Number.isFinite(declaredSize) || declaredSize < 0) {
        return jsonError(res, 400, 'Each upload must declare a valid file size.')
      }
      if (declaredSize > MAX_UPLOAD_FILE_SIZE) {
        return jsonError(res, 413, 'One of the uploaded files exceeded the current per-file upload limit.')
      }
      declaredTotalSize += declaredSize
      if (declaredTotalSize > MAX_IMPORT_TOTAL_SIZE) {
        return jsonError(res, 413, 'Selected files exceed the aggregate import limit.')
      }
      validatedFiles.push({ relativePath, contentType: String(entry?.contentType || '').trim() || undefined })
    }
    const uploads = await Promise.all(validatedFiles.map(async (entry: any) => {
      const relativePath = entry.relativePath
      const pathname = `${session.staging_prefix}/${relativePath}`
      const upload = await createPresignedUpload(pathname, entry.contentType)
      return {
        relativePath,
        url: upload.url,
        headers: upload.headers
      }
    }))
    res.json({ uploads })
  }))

  app.post('/api/study-packs/import/folder-session/:sessionId/files', requireAuth, upload.any(), asyncRoute(async function addFolderImportFiles(req: any, res: any) {
    if (uploadMode !== 'multipart') {
      return jsonError(res, 410, 'This deployment uses direct object-storage uploads instead of server-side multipart upload batches.')
    }
    const session = await repository.getImportSession(String(req.params.sessionId || ''))
    if (!session || session.user_id !== req.user.id) {
      return jsonError(res, 404, 'Import session not found')
    }
    if (session.state !== 'uploading') {
      return jsonError(res, 409, 'Import session is no longer accepting files')
    }
    if (!req.files || req.files.length === 0) {
      return jsonError(res, 400, 'Select folder files to upload')
    }
    await writeUploadedFiles(session.upload_root, req.files)
    res.json({ ok: true, filesReceived: req.files.length })
  }))

  app.get('/api/study-packs/import/folder-session/:sessionId', requireAuth, asyncRoute(async function getFolderImportStatus(req: any, res: any) {
    const session = await repository.getImportSession(String(req.params.sessionId || ''))
    if (!session || session.user_id !== req.user.id) {
      return jsonError(res, 404, 'Import session not found')
    }
    res.json(await summarizeImportSession(session))
  }))

  app.post('/api/study-packs/import/folder-session/:sessionId/complete', requireAuth, asyncRoute(async function completeFolderImport(req: any, res: any) {
    const session = await repository.getImportSession(String(req.params.sessionId || ''))
    if (!session || session.user_id !== req.user.id) {
      return jsonError(res, 404, 'Import session not found')
    }
    const summary = await finalizeImportSession(session)
    if (!summary) {
      return jsonError(res, 404, 'Import session not found')
    }
    if (summary.status === 'completed') {
      return res.json(summary)
    }
    if (summary.status === 'failed') {
      return res.status(400).json(summary)
    }
    return res.status(202).json(summary)
  }))

  app.delete('/api/study-packs/import/folder-session/:sessionId', requireAuth, asyncRoute(async function cancelFolderImport(req: any, res: any) {
    const session = await repository.getImportSession(String(req.params.sessionId || ''))
    if (!session || session.user_id !== req.user.id) {
      return jsonError(res, 404, 'Import session not found')
    }
    if (session.state === 'finalizing') {
      return jsonError(res, 409, 'Import is currently being finalized')
    }
    await workspaceStore.cancelImportWorkspace(session)
    await repository.deleteImportSession(session.id)
    res.json({ ok: true })
  }))

  app.post('/api/study-packs/import', requireAuth, upload.any(), asyncRoute(async function importPack(req: any, res: any) {
    if (uploadMode !== 'multipart') {
      return jsonError(res, 410, 'Zip imports now upload through direct object-storage staging on this deployment.')
    }
    const importType = req.body.importType === 'zip' ? 'zip' : 'folder'
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'quail-ultra-live-'))
    try {
      if (importType === 'zip') {
        if (!req.files || req.files.length !== 1) {
          return jsonError(res, 400, 'Provide exactly one zip file')
        }
        await extractZipToDirectory(tempRoot, req.files[0].path)
      } else {
        if (!req.files || req.files.length === 0) {
          return jsonError(res, 400, 'Select a study-pack folder to upload')
        }
        await writeUploadedFiles(tempRoot, req.files)
      }
      const packId = crypto.randomUUID()
      const finalized = await workspaceStore.importWorkspaceFromLocalDirectory(tempRoot, path.join(PACKS_DIR, packId, 'workspace'))
      const timestamp = nowIso()
      await repository.createPack({
        id: packId,
        userId: req.user.id,
        name: sanitizePackName(String(req.body.packName || ''), finalized.packName),
        workspacePath: path.join(ROOT_DIR, 'data', 'study-packs', packId, 'workspace'),
        questionCount: finalized.questionCount,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      const pack = await repository.getPackById(packId)
      res.json({ pack: packSummary(pack) })
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true })
    }
  }))

  app.get('/api/study-packs/:packId/qbankinfo', requireAuth, asyncRoute(async function getQbank(req: any, res: any) {
    const pack = await loadPackForUser(req.user.id, req.params.packId, String(req.query.block || ''))
    if (!pack) {
      return jsonError(res, 404, 'Study pack not found')
    }
    res.json({ qbankinfo: pack.qbankinfo, pack: packSummary(pack.row) })
  }))

  app.get('/api/study-packs/:packId/question-stats', requireAuth, asyncRoute(async function getQuestionStats(req: any, res: any) {
    const pack = await loadPackForUser(req.user.id, req.params.packId, '')
    if (!pack) {
      return jsonError(res, 404, 'Study pack not found')
    }
    const ids = parseQuestionStatsIds(req.query.ids)
    const systemPack = await repository.getSystemPackByWorkspacePath(pack.row.workspace_path)
    const eligible = Boolean(systemPack)
    const rows = eligible
      ? await repository.listAnswerDistribution(systemPack.id, ids, req.user.id)
      : []
    res.json({
      stats: buildQuestionStats({
        ids,
        eligible,
        choices: pack.qbankinfo.choices || {},
        rows
      })
    })
  }))

  app.get('/api/study-packs/:packId/manifest', requireAuth, asyncRoute(async function getManifest(req: any, res: any) {
    const row = await repository.getPackForUser(req.user.id, req.params.packId)
    if (!row) {
      return jsonError(res, 404, 'Study pack not found')
    }
    res.json({
      files: await workspaceStore.listManifest(row.workspace_path),
      revision: Number(row.revision || 0)
    })
  }))

  app.get('/api/study-packs/:packId/file/*', requireAuth, asyncRoute(async function getPackFile(req: any, res: any) {
    const row = await repository.getPackForUser(req.user.id, req.params.packId)
    if (!row) {
      return jsonError(res, 404, 'Study pack not found')
    }
    try {
      const file = await workspaceStore.getPackFile(row.workspace_path, String(req.params[0] || ''))
      if (file.kind === 'path') {
        if (!fs.existsSync(file.absolutePath)) {
          return jsonError(res, 404, 'File not found')
        }
        return res.sendFile(file.absolutePath)
      }
      res.setHeader('Content-Type', file.contentType || 'application/octet-stream')
      file.stream.pipe(res)
    } catch (error: any) {
      return jsonError(res, 400, error?.message || 'Invalid file path')
    }
  }))

  app.post('/api/study-packs/:packId/blocks/start', requireAuth, asyncRoute(async function startPackBlock(req: any, res: any) {
    const pack = await loadPackForUser(req.user.id, req.params.packId, '')
    if (!pack) {
      return jsonError(res, 404, 'Study pack not found')
    }
    const blockqlist = Array.isArray(req.body.blockqlist) ? req.body.blockqlist : []
    if (blockqlist.length === 0) {
      return jsonError(res, 400, 'No questions selected')
    }
    const blockKey = startBlock(pack.qbankinfo, blockqlist, req.body.preferences || {})
    const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, Number(pack.row.revision || 0) + 1)
    res.json({ blockKey, revision: nextRevision })
  }))

  app.put('/api/study-packs/:packId/progress', requireAuth, asyncRoute(async function savePackProgress(req: any, res: any) {
    const pack = await loadPackForUser(req.user.id, req.params.packId, '')
    if (!pack) {
      return jsonError(res, 404, 'Study pack not found')
    }
    const incomingProgress = req.body.progress
    if (!incomingProgress || typeof incomingProgress !== 'object') {
      return jsonError(res, 400, 'Progress payload is required')
    }
    const baseRevision = Number(req.body.baseRevision)
    const currentRevision = Number(pack.row.revision || 0)
    if (!Number.isFinite(baseRevision)) {
      return jsonError(res, 400, 'baseRevision is required')
    }
    if (baseRevision !== currentRevision) {
      return res.status(409).json({
        error: 'Progress revision conflict',
        serverRevision: currentRevision,
        qbankinfo: pack.qbankinfo
      })
    }
    const syncMetadata = {
      clientInstanceId: String(req.body.clientInstanceId || ''),
      clientMutationSeq: Number(req.body.clientMutationSeq || 0),
      clientUpdatedAt: String(req.body.clientUpdatedAt || '')
    }
    if (
      syncMetadata.clientInstanceId &&
      syncMetadata.clientInstanceId === pack.row.last_client_instance_id &&
      Number.isFinite(syncMetadata.clientMutationSeq) &&
      syncMetadata.clientMutationSeq <= Number(pack.row.last_client_mutation_seq || 0)
    ) {
      return res.json({
        revision: currentRevision,
        applied: false,
        serverAcceptedAt: nowIso()
      })
    }
    const previousProgress = structuredClone(pack.qbankinfo.progress)
    pack.qbankinfo.progress = incomingProgress
    normalizeProgress(pack.qbankinfo.progress, pack.qbankinfo)
    const systemPack = await repository.getSystemPackByWorkspacePath(pack.row.workspace_path)
    if (systemPack) {
      await repository.recordAnswerAnalytics(collectNewlySubmittedAnswers({
        systemPackId: systemPack.id,
        userId: req.user.id,
        previousProgress,
        nextProgress: pack.qbankinfo.progress,
        choices: pack.qbankinfo.choices || {},
        answeredAt: nowIso()
      }))
    }
    const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, currentRevision + 1, syncMetadata)
    res.json({ revision: nextRevision, applied: true, serverAcceptedAt: nowIso() })
  }))

  app.delete('/api/study-packs/:packId/blocks/:blockKey', requireAuth, asyncRoute(async function removeBlock(req: any, res: any) {
    const pack = await loadPackForUser(req.user.id, req.params.packId, '')
    if (!pack) {
      return jsonError(res, 404, 'Study pack not found')
    }
    deleteBlock(pack.qbankinfo, req.params.blockKey)
    const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, Number(pack.row.revision || 0) + 1)
    res.json({ revision: nextRevision })
  }))

  app.post('/api/study-packs/:packId/reset', requireAuth, asyncRoute(async function resetPack(req: any, res: any) {
    const pack = await loadPackForUser(req.user.id, req.params.packId, '')
    if (!pack) {
      return jsonError(res, 404, 'Study pack not found')
    }
    pack.qbankinfo.progress = {
      blockhist: {},
      tagbuckets: {}
    }
    normalizeProgress(pack.qbankinfo.progress, pack.qbankinfo)
    const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, Number(pack.row.revision || 0) + 1)
    res.json({ revision: nextRevision })
  }))

  app.delete('/api/study-packs/:packId', requireAuth, asyncRoute(async function deleteStudyPack(req: any, res: any) {
    const row = await repository.getPackForUser(req.user.id, req.params.packId)
    if (!row) {
      return jsonError(res, 404, 'Study pack not found')
    }
    await deletePackRow(row)
    res.json({ ok: true })
  }))

  app.post('/api/support/submit', requireAuth, asyncRoute(async function submitSupportTicket(req: any, res: any) {
    const { subject, category, message } = req.body ?? {}
    if (typeof subject !== 'string' || subject.trim().length === 0 || subject.trim().length > 200) {
      return jsonError(res, 400, 'Subject must be 1–200 characters.')
    }
    const validCategories = ['bug', 'feedback', 'question']
    if (!validCategories.includes(category)) {
      return jsonError(res, 400, 'Invalid category.')
    }
    if (typeof message !== 'string' || message.trim().length === 0 || message.trim().length > 2000) {
      return jsonError(res, 400, 'Message must be 1–2000 characters.')
    }
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    await repository.createSupportTicket({ id, userId: req.user.id, subject: subject.trim(), category, message: message.trim(), createdAt })
    let emailSent = false
    if (isEmailConfigured()) {
      void sendSupportEmail('ahmad2003.hajji@gmail.com', subject.trim(), category, message.trim(), req.user.username).then((sent) => {
        emailSent = sent
      }).catch((error) => {
        console.warn('Failed to send support email:', error)
      })
    }
    res.status(201).json({ ok: true, emailSent })
  }))

  app.get('/api/admin/support-tickets', requireAuth, asyncRoute(async function listSupportTicketsRoute(req: any, res: any) {
    if (req.user.role !== 'admin') {
      return jsonError(res, 403, 'Forbidden')
    }
    const tickets = await repository.listSupportTickets()
    res.json({ tickets })
  }))

  app.post('/api/study-packs/:packId/questions/:qid/report', requireAuth, asyncRoute(async function reportQuestion(req: any, res: any) {
    const { packId, qid } = req.params
    const { category, message = '' } = req.body ?? {}
    const validCategories = ['wrong-answer-key', 'typo-stem', 'bad-explanation', 'other']
    if (!validCategories.includes(category)) {
      return jsonError(res, 400, 'Invalid category.')
    }
    if (typeof message === 'string' && message.length > 2000) {
      return jsonError(res, 400, 'Message must be 2000 characters or fewer.')
    }
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    await repository.createQuestionReport({ id, packId, questionId: qid, userId: req.user.id, category, message: (message || '').trim(), createdAt })
    if (isEmailConfigured()) {
      void sendQuestionReportEmail('ahmad2003.hajji@gmail.com', packId, qid, category, (message || '').trim(), req.user.username).catch((error) => {
        console.warn('Failed to send question report email:', error)
      })
    }
    res.status(201).json({ ok: true })
  }))

  app.get('/api/admin/question-reports', requireAuth, asyncRoute(async function listQuestionReportsRoute(req: any, res: any) {
    if (req.user.role !== 'admin') {
      return jsonError(res, 403, 'Forbidden')
    }
    const reports = await repository.listQuestionReports()
    res.json({ reports })
  }))

  app.use(function apiErrorHandler(error: any, req: any, res: any, next: any) {
    if (!req.path.startsWith('/api/')) {
      return next(error)
    }
    if (res.headersSent) {
      return next(error)
    }
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      return jsonError(res, status, summarizeMulterError(error))
    }
    console.error(error)
    return jsonError(res, 500, error?.message || 'Internal server error')
  })

  app.get('/', function root(_req: any, res: any) {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })

  app.get('/:page(overview|newblock|previousblocks|examview|admin|library|support)', function spaPages(_req: any, res: any) {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })

  app.get('/:page(overview|newblock|previousblocks|examview|admin|library).html', function htmlPages(req: any, res: any) {
    redirectToSpaPath(req, res, legacyPageRedirectTarget(req.params.page))
  })

  app.get(['/loadbank', '/loadbank.html'], function loadbankRedirect(req: any, res: any) {
    redirectToSpaPath(req, res, legacyPageRedirectTarget('loadbank'))
  })

  return {
    app,
    repository,
    workspaceStore,
    storageBackend,
    directBlobUploads: directUploads,
    uploadMode,
    port: PORT,
    routes: {
      studyPacks: routePathFor('study-packs'),
      overview: routePathFor('overview'),
      newblock: routePathFor('newblock')
    }
  }
}
