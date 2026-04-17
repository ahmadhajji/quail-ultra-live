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
  DIST_DIR,
  MAX_UPLOAD_FILE_SIZE,
  PORT,
  PACKS_DIR,
  ROOT_DIR,
  getStorageBackend,
  usesCloudStorage
} from './config'
import { buildPasswordHash, comparePassword, createInviteToken, createRepository, hashInviteToken } from './repository'
import { createWorkspaceStore } from './workspace-store'
import { legacyPageRedirectTarget, routePathFor } from './routes'
import { deleteBlock, normalizeProgress, startBlock } from '../shared/progress'

function nowIso() {
  return new Date().toISOString()
}

function jsonError(res: any, status: number, message: string) {
  res.status(status).json({ error: message })
}

function sanitizePackName(input: string, fallback: string) {
  const trimmed = String(input || '').trim()
  return trimmed || fallback
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
  const normalized = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).join('/')
  if (!normalized || normalized.startsWith('.')) {
    throw new Error('Invalid upload path')
  }
  return normalized
}

async function writeUploadedFiles(targetDir: string, files: any[]) {
  await fsp.mkdir(targetDir, { recursive: true })
  for (const file of files) {
    const relativeName = safeRelativeUploadPath(file.originalname)
    const absolutePath = path.resolve(targetDir, relativeName)
    if (!absolutePath.startsWith(path.resolve(targetDir))) {
      throw new Error(`Invalid upload path: ${relativeName}`)
    }
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
  await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: targetDir })).promise()
  await fsp.unlink(zipPath).catch(() => {})
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
  const repository = createRepository()
  const workspaceStore = createWorkspaceStore()
  const storageBackend = getStorageBackend()
  const directBlobUploads = usesCloudStorage()
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
    await workspaceStore.deleteWorkspace(row.workspace_path)
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
    await workspaceStore.savePackProgress(packRow.workspace_path, qbankinfo.progress)
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

  app.get('/api/auth/session', function sessionInfo(req: any, res: any) {
    res.json({ user: req.user || null })
  })

  app.get('/api/auth/config', asyncRoute(async function authConfig(_req: any, res: any) {
    res.json({
      settings: {
        registrationMode: await repository.getRegistrationMode(),
        storageBackend,
        directBlobUploads
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
    res.status(201).json({
      invite: inviteSummary(created),
      inviteUrl: inviteUrl.toString()
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

  app.get('/api/study-packs', requireAuth, asyncRoute(async function listPacks(req: any, res: any) {
    const rows = await repository.listPacksForUser(req.user.id)
    res.json({ packs: rows.map(packSummary) })
  }))

  app.post('/api/study-packs/import/folder-session', requireAuth, asyncRoute(async function beginFolderImport(req: any, res: any) {
    const sessionId = crypto.randomUUID()
    const timestamp = nowIso()
    if (storageBackend === 'cloud') {
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
    if (!directBlobUploads) {
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

  app.post('/api/study-packs/import/folder-session/:sessionId/files', requireAuth, upload.any(), asyncRoute(async function addFolderImportFiles(req: any, res: any) {
    if (directBlobUploads) {
      return jsonError(res, 410, 'This deployment uses direct blob uploads instead of server-side multipart upload batches.')
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
    if (directBlobUploads) {
      return jsonError(res, 410, 'Zip imports now upload through direct blob staging on cloud deployments.')
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
        revision: Number(pack.row.revision || 0),
        applied: false,
        serverAcceptedAt: nowIso()
      })
    }
    pack.qbankinfo.progress = incomingProgress
    const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, Number(pack.row.revision || 0) + 1, syncMetadata)
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

  app.get('/:page(overview|newblock|previousblocks|examview|admin)', function spaPages(_req: any, res: any) {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })

  app.get('/:page(overview|newblock|previousblocks|examview|admin).html', function htmlPages(req: any, res: any) {
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
    directBlobUploads,
    port: PORT,
    routes: {
      studyPacks: routePathFor('study-packs'),
      overview: routePathFor('overview'),
      newblock: routePathFor('newblock')
    }
  }
}
