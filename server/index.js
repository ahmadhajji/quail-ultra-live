const crypto = require('crypto')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')
const archiver = require('archiver')
const bcrypt = require('bcryptjs')
const express = require('express')
const session = require('express-session')
const multer = require('multer')
const unzipper = require('unzipper')

const { deleteBlock, normalizeProgress, startBlock } = require('../shared/progress')
const {
  findWorkspaceRoot,
  listWorkspaceManifest,
  loadWorkspaceData,
  safeResolveWorkspaceFile,
  saveProgress,
  withPackPath
} = require('../shared/qbank')

const ROOT_DIR = path.resolve(__dirname, '..')
const DIST_DIR = path.join(ROOT_DIR, 'dist')
const WEB_DIR = path.join(ROOT_DIR, 'web')
const DATA_DIR = path.join(ROOT_DIR, 'data')
const PACKS_DIR = path.join(DATA_DIR, 'study-packs')
const DB_PATH = path.join(DATA_DIR, 'quail-ultra-live.db')
const PORT = parseInt(process.env.PORT || '3000', 10)
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me'
const DEFAULT_REGISTRATION_MODE = process.env.ALLOW_REGISTRATION === 'false' ? 'closed' : 'invite-only'
const MAX_UPLOAD_FILE_SIZE = 1024 * 1024 * 1024
const ADMIN_BOOTSTRAP_USERNAME = 'ahmad'

const app = express()
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
const uploadAny = upload.any()

function nowIso() {
  return new Date().toISOString()
}

function createTokenHash(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

async function ensureDirectories() {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.mkdir(PACKS_DIR, { recursive: true })
}

function initDb() {
  const db = new DatabaseSync(DB_PATH)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS study_packs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      question_count INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      last_client_instance_id TEXT NOT NULL DEFAULT '',
      last_client_mutation_seq INTEGER NOT NULL DEFAULT 0,
      last_client_updated_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_by TEXT NOT NULL DEFAULT '',
      used_at TEXT NOT NULL DEFAULT '',
      revoked_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(used_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  ensureColumn(db, 'users', 'email', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'users', 'role', "TEXT NOT NULL DEFAULT 'user'")
  ensureColumn(db, 'users', 'status', "TEXT NOT NULL DEFAULT 'active'")
  ensureColumn(db, 'users', 'updated_at', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'study_packs', 'last_client_instance_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'study_packs', 'last_client_mutation_seq', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'study_packs', 'last_client_updated_at', "TEXT NOT NULL DEFAULT ''")
  db.prepare("UPDATE users SET updated_at = created_at WHERE updated_at = ''").run()
  ensureSetting(db, 'registration_mode', DEFAULT_REGISTRATION_MODE)
  ensureBootstrapAdmin(db, ADMIN_BOOTSTRAP_USERNAME)
  return db
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  const exists = columns.some(function hasColumn(column) {
    return column.name === columnName
  })
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

function ensureSetting(db, key, value) {
  const existing = db.prepare('SELECT key FROM app_settings WHERE key = ?').get(key)
  if (!existing) {
    db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, nowIso())
  }
}

function ensureBootstrapAdmin(db, username) {
  const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username)
  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), existing.id)
    return
  }

  const tempPassword = crypto.randomUUID()
  const passwordHash = bcrypt.hashSync(tempPassword, 10)
  const userId = crypto.randomUUID()
  const timestamp = nowIso()
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)
  `).run(userId, username, '', passwordHash, timestamp, timestamp)
  console.warn(`[quail-ultra-live] Bootstrapped admin "${username}" with temporary password: ${tempPassword}`)
}

let db
const importSessions = new Map()

function jsonError(res, status, message) {
  res.status(status).json({ error: message })
}

function getRegistrationMode() {
  const setting = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('registration_mode')
  return setting && typeof setting.value === 'string' ? setting.value : DEFAULT_REGISTRATION_MODE
}

function setRegistrationMode(nextMode) {
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?').run(nextMode, nowIso(), 'registration_mode')
  return getRegistrationMode()
}

function getCurrentUser(req) {
  if (!req.session.userId) {
    return null
  }
  const row = db.prepare('SELECT id, username, email, role, status, created_at FROM users WHERE id = ?').get(req.session.userId)
  return row || null
}

function requireAuth(req, res, next) {
  const user = getCurrentUser(req)
  if (!user) {
    return jsonError(res, 401, 'Authentication required')
  }
  if (user.status !== 'active') {
    return jsonError(res, 403, 'This account is disabled')
  }
  req.user = user
  next()
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return jsonError(res, 403, 'Admin access required')
  }
  next()
}

function sanitizePackName(input, fallback) {
  const trimmed = String(input || '').trim()
  if (trimmed) {
    return trimmed
  }
  return fallback
}

function packSummary(row) {
  return {
    id: row.id,
    name: row.name,
    questionCount: row.question_count,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function adminUserSummary(row) {
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

function inviteSummary(row) {
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

function getPublicOrigin(req) {
  const forwardedProto = req.get('x-forwarded-proto')
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol
  return `${protocol}://${req.get('host')}`
}

async function deletePackRow(row) {
  if (!row) {
    return
  }
  db.prepare('DELETE FROM study_packs WHERE id = ?').run(row.id)
  await fsp.rm(path.dirname(row.workspace_path), { recursive: true, force: true })
}

function getPackById(packId) {
  return db.prepare(
    'SELECT id, user_id, name, workspace_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs WHERE id = ?'
  ).get(packId)
}

function getPackForUser(userId, packId) {
  return db.prepare(
    'SELECT id, user_id, name, workspace_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs WHERE id = ? AND user_id = ?'
  ).get(packId, userId)
}

async function loadPackForUser(userId, packId, blockToOpen) {
  const row = getPackForUser(userId, packId)
  if (!row) {
    return null
  }
  const qbankinfo = await loadWorkspaceData(row.workspace_path)
  return {
    row: row,
    qbankinfo: withPackPath(qbankinfo, row.id, row.revision, blockToOpen)
  }
}

async function persistPackProgress(packRow, qbankinfo, nextRevision, syncMetadata) {
  normalizeProgress(qbankinfo.progress, qbankinfo)
  await saveProgress(packRow.workspace_path, qbankinfo.progress)
  const updatedAt = nowIso()
  const nextInstanceId = syncMetadata && syncMetadata.clientInstanceId ? syncMetadata.clientInstanceId : (packRow.last_client_instance_id || '')
  const nextMutationSeq = syncMetadata && Number.isFinite(syncMetadata.clientMutationSeq) ? syncMetadata.clientMutationSeq : (packRow.last_client_mutation_seq || 0)
  const nextClientUpdatedAt = syncMetadata && syncMetadata.clientUpdatedAt ? syncMetadata.clientUpdatedAt : (packRow.last_client_updated_at || '')
  db.prepare(`
    UPDATE study_packs
    SET revision = ?, updated_at = ?, last_client_instance_id = ?, last_client_mutation_seq = ?, last_client_updated_at = ?
    WHERE id = ?
  `).run(nextRevision, updatedAt, nextInstanceId, nextMutationSeq, nextClientUpdatedAt, packRow.id)
  return nextRevision
}

async function writeUploadFiles(targetDir, files) {
  await fsp.mkdir(targetDir, { recursive: true })
  for (const file of files) {
    const relativeName = file.originalname.split('\\').join('/')
    const absolutePath = path.resolve(targetDir, relativeName)
    if (!absolutePath.startsWith(path.resolve(targetDir))) {
      throw new Error(`Invalid upload path: ${relativeName}`)
    }
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true })
    if (file.path) {
      await fsp.copyFile(file.path, absolutePath)
      await fsp.unlink(file.path).catch(function ignoreUnlinkError() {})
    } else {
      await fsp.writeFile(absolutePath, file.buffer)
    }
  }
}

async function extractZipFile(targetDir, zipPath) {
  await fsp.mkdir(targetDir, { recursive: true })
  await fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: targetDir }))
    .promise()
  await fsp.unlink(zipPath).catch(function ignoreUnlinkError() {})
}

function getImportSession(sessionId, userId) {
  const session = importSessions.get(sessionId)
  if (!session || session.userId !== userId) {
    return null
  }
  return session
}

async function createImportSession(userId, requestedName) {
  const sessionId = crypto.randomUUID()
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'quail-ultra-live-import-'))
  const uploadRoot = path.join(tempRoot, 'upload')
  await fsp.mkdir(uploadRoot, { recursive: true })

  importSessions.set(sessionId, {
    id: sessionId,
    userId: userId,
    requestedName: requestedName,
    tempRoot: tempRoot,
    uploadRoot: uploadRoot,
    state: 'uploading',
    error: '',
    pack: null,
    createdAt: nowIso()
  })

  return sessionId
}

async function cleanupImportSession(sessionId) {
  const session = importSessions.get(sessionId)
  if (!session) {
    return
  }
  importSessions.delete(sessionId)
  if (session.tempRoot) {
    await fsp.rm(session.tempRoot, { recursive: true, force: true })
  }
}

function summarizeImportSession(session) {
  return {
    sessionId: session.id,
    status: session.state,
    error: session.error || '',
    pack: session.pack || null
  }
}

function scheduleImportSessionExpiry(sessionId) {
  const timer = setTimeout(function expireImportSession() {
    importSessions.delete(sessionId)
  }, 1000 * 60 * 15)

  if (typeof timer.unref === 'function') {
    timer.unref()
  }
}

function finalizeImportSession(sessionId) {
  const session = importSessions.get(sessionId)
  if (!session || session.state !== 'uploading') {
    return
  }

  session.state = 'finalizing'
  session.error = ''
  console.log(`Finalizing study-pack import session ${sessionId}`)

  ;(async function runImportFinalization() {
    const startedAt = Date.now()

    try {
      const pack = await finalizeImportedPack(session.userId, session.uploadRoot, session.requestedName)
      session.pack = packSummary(pack)
      session.state = 'completed'
      console.log(`Completed study-pack import session ${sessionId} in ${Date.now() - startedAt}ms`)
    } catch (error) {
      session.error = error && error.message ? error.message : 'Import failed'
      session.state = 'failed'
      console.error(`Failed study-pack import session ${sessionId}`, error)
    } finally {
      if (session.tempRoot) {
        await fsp.rm(session.tempRoot, { recursive: true, force: true })
      }
      session.tempRoot = ''
      session.uploadRoot = ''
      scheduleImportSessionExpiry(sessionId)
    }
  })().catch(function onImportFinalizationError(error) {
    session.error = error && error.message ? error.message : 'Import failed'
    session.state = 'failed'
    console.error(`Unexpected import finalization error for session ${sessionId}`, error)
    scheduleImportSessionExpiry(sessionId)
  })
}

function multerErrorMessage(error) {
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

async function finalizeImportedPack(userId, importRoot, requestedName) {
  const workspaceRoot = await findWorkspaceRoot(importRoot)
  const prepared = await loadWorkspaceData(workspaceRoot)
  const packId = crypto.randomUUID()
  const finalRoot = path.join(PACKS_DIR, packId)
  const finalWorkspace = path.join(finalRoot, 'workspace')
  await fsp.mkdir(finalRoot, { recursive: true })
  await fsp.cp(workspaceRoot, finalWorkspace, { recursive: true })

  const questionCount = Object.keys(prepared.index).length
  const timestamp = nowIso()
  const packName = sanitizePackName(requestedName, path.basename(workspaceRoot))

  db.prepare(`
    INSERT INTO study_packs (
      id, user_id, name, workspace_path, question_count, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(packId, userId, packName, finalWorkspace, questionCount, 0, timestamp, timestamp)

  return db.prepare(
    'SELECT id, name, question_count, revision, created_at, updated_at FROM study_packs WHERE id = ?'
  ).get(packId)
}

function routePathFor(pageName) {
  if (pageName === 'study-packs') {
    return '/'
  }
  return `/${pageName}.html`
}

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}))

app.use('/vendor', express.static(path.join(ROOT_DIR, 'node_modules')))
app.use('/assets', express.static(path.join(DIST_DIR, 'assets')))
app.use('/branding', express.static(path.join(WEB_DIR, 'branding')))
app.use('/js', express.static(path.join(WEB_DIR, 'js')))
app.use('/manifest.webmanifest', express.static(path.join(WEB_DIR, 'manifest.webmanifest')))
app.use('/sw.js', express.static(path.join(WEB_DIR, 'sw.js')))
app.use('/quail-ui.css', express.static(path.join(WEB_DIR, 'quail-ui.css')))
app.use('/TextHighlighter.js', express.static(path.join(WEB_DIR, 'TextHighlighter.js')))

app.get('/api/health', function health(_req, res) {
  res.json({ ok: true })
})

app.get('/api/auth/session', function sessionInfo(req, res) {
  const user = getCurrentUser(req)
  res.json({ user: user })
})

app.get('/api/auth/config', function authConfig(_req, res) {
  res.json({
    settings: {
      registrationMode: getRegistrationMode()
    }
  })
})

app.post('/api/auth/register', async function register(req, res) {
  if (getRegistrationMode() !== 'invite-only') {
    return jsonError(res, 403, 'Registration is currently closed')
  }

  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  const email = String(req.body.email || '').trim().toLowerCase()
  const inviteToken = String(req.body.inviteToken || '').trim()
  if (!username || !password || !email || !inviteToken) {
    return jsonError(res, 400, 'Username, password, email, and invite token are required')
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) {
    return jsonError(res, 409, 'Username already exists')
  }

  const invite = db.prepare(`
    SELECT id, email, role, expires_at, used_at, revoked_at
    FROM invites
    WHERE token_hash = ?
  `).get(createTokenHash(inviteToken))
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
  if (invite.email.toLowerCase() !== email) {
    return jsonError(res, 400, 'Invite email does not match')
  }

  const userId = crypto.randomUUID()
  const passwordHash = await bcrypt.hash(password, 10)
  const timestamp = nowIso()
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    userId,
    username,
    email,
    passwordHash,
    invite.role || 'user',
    timestamp,
    timestamp
  )
  db.prepare('UPDATE invites SET used_by = ?, used_at = ?, updated_at = ? WHERE id = ?').run(userId, timestamp, timestamp, invite.id)
  req.session.userId = userId
  res.json({ user: getCurrentUser(req) })
})

app.post('/api/auth/login', async function login(req, res) {
  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  if (!username || !password) {
    return jsonError(res, 400, 'Username and password are required')
  }

  const user = db.prepare('SELECT id, username, email, role, status, password_hash, created_at FROM users WHERE username = ?').get(username)
  if (!user) {
    return jsonError(res, 401, 'Invalid username or password')
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    return jsonError(res, 401, 'Invalid username or password')
  }
  if (user.status !== 'active') {
    return jsonError(res, 403, 'This account is disabled')
  }

  req.session.userId = user.id
  res.json({ user: getCurrentUser(req) })
})

app.post('/api/auth/logout', function logout(req, res) {
  req.session.destroy(function destroyed() {
    res.json({ ok: true })
  })
})

app.get('/api/admin/settings', requireAuth, requireAdmin, function getAdminSettings(_req, res) {
  res.json({
    settings: {
      registrationMode: getRegistrationMode()
    }
  })
})

app.put('/api/admin/settings', requireAuth, requireAdmin, function updateAdminSettings(req, res) {
  const requestedMode = String(req.body && req.body.settings && req.body.settings.registrationMode || '').trim()
  if (requestedMode !== 'invite-only' && requestedMode !== 'closed') {
    return jsonError(res, 400, 'registrationMode must be invite-only or closed')
  }

  res.json({
    settings: {
      registrationMode: setRegistrationMode(requestedMode)
    }
  })
})

app.get('/api/admin/users', requireAuth, requireAdmin, function listAdminUsers(_req, res) {
  const rows = db.prepare(`
    SELECT users.id, users.username, users.email, users.role, users.status, users.created_at, users.updated_at,
      COUNT(study_packs.id) AS pack_count
    FROM users
    LEFT JOIN study_packs ON study_packs.user_id = users.id
    GROUP BY users.id
    ORDER BY users.created_at ASC
  `).all()
  res.json({ users: rows.map(adminUserSummary) })
})

app.post('/api/admin/users', requireAuth, requireAdmin, async function createAdminUser(req, res) {
  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  const email = String(req.body.email || '').trim().toLowerCase()
  const role = req.body.role === 'admin' ? 'admin' : 'user'

  if (!username || !password || !email) {
    return jsonError(res, 400, 'Username, password, and email are required')
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) {
    return jsonError(res, 409, 'Username already exists')
  }

  const userId = crypto.randomUUID()
  const passwordHash = await bcrypt.hash(password, 10)
  const timestamp = nowIso()
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(userId, username, email, passwordHash, role, timestamp, timestamp)

  const created = db.prepare(`
    SELECT id, username, email, role, status, created_at, updated_at, 0 AS pack_count
    FROM users
    WHERE id = ?
  `).get(userId)
  res.status(201).json({ user: adminUserSummary(created) })
})

app.patch('/api/admin/users/:userId', requireAuth, requireAdmin, function updateAdminUser(req, res) {
  const userId = String(req.params.userId || '')
  const existing = db.prepare('SELECT id, username, email, role, status, created_at, updated_at FROM users WHERE id = ?').get(userId)
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

  db.prepare(`
    UPDATE users
    SET email = ?, role = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(nextEmail, nextRole, nextStatus, nowIso(), existing.id)

  const updated = db.prepare(`
    SELECT users.id, users.username, users.email, users.role, users.status, users.created_at, users.updated_at,
      COUNT(study_packs.id) AS pack_count
    FROM users
    LEFT JOIN study_packs ON study_packs.user_id = users.id
    WHERE users.id = ?
    GROUP BY users.id
  `).get(existing.id)
  res.json({ user: adminUserSummary(updated) })
})

app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, async function deleteAdminUser(req, res) {
  const userId = String(req.params.userId || '')
  if (userId === req.user.id) {
    return jsonError(res, 400, 'You cannot delete your own account')
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
  if (!user) {
    return jsonError(res, 404, 'User not found')
  }

  const packs = db.prepare('SELECT id, workspace_path FROM study_packs WHERE user_id = ?').all(userId)
  for (const packRow of packs) {
    await deletePackRow(packRow)
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  res.json({ ok: true })
})

app.get('/api/admin/users/:userId/packs', requireAuth, requireAdmin, function listAdminUserPacks(req, res) {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId)
  if (!user) {
    return jsonError(res, 404, 'User not found')
  }

  const rows = db.prepare(
    'SELECT id, name, question_count, revision, created_at, updated_at FROM study_packs WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.params.userId)
  res.json({ packs: rows.map(packSummary) })
})

app.delete('/api/admin/packs/:packId', requireAuth, requireAdmin, async function deleteAdminPack(req, res) {
  const row = getPackById(req.params.packId)
  if (!row) {
    return jsonError(res, 404, 'Study pack not found')
  }

  await deletePackRow(row)
  res.json({ ok: true })
})

app.get('/api/admin/invites', requireAuth, requireAdmin, function listAdminInvites(_req, res) {
  const rows = db.prepare(`
    SELECT invites.id, invites.email, invites.role, invites.created_at, invites.expires_at, invites.used_at, invites.revoked_at,
      created_by_user.username AS created_by_username,
      used_by_user.username AS used_by_username
    FROM invites
    LEFT JOIN users AS created_by_user ON created_by_user.id = invites.created_by
    LEFT JOIN users AS used_by_user ON used_by_user.id = invites.used_by
    ORDER BY invites.created_at DESC
  `).all()
  res.json({ invites: rows.map(inviteSummary) })
})

app.post('/api/admin/invites', requireAuth, requireAdmin, function createAdminInvite(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase()
  const role = req.body.role === 'admin' ? 'admin' : 'user'
  const expiresInDaysRaw = Number(req.body.expiresInDays || 7)
  const expiresInDays = Number.isFinite(expiresInDaysRaw) ? Math.min(Math.max(Math.round(expiresInDaysRaw), 1), 90) : 7

  if (!email) {
    return jsonError(res, 400, 'Email is required')
  }

  const rawToken = crypto.randomUUID()
  const inviteId = crypto.randomUUID()
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  db.prepare(`
    INSERT INTO invites (id, email, token_hash, role, created_by, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(inviteId, email, createTokenHash(rawToken), role, req.user.id, createdAt, createdAt, expiresAt)

  const created = db.prepare(`
    SELECT invites.id, invites.email, invites.role, invites.created_at, invites.expires_at, invites.used_at, invites.revoked_at,
      created_by_user.username AS created_by_username,
      used_by_user.username AS used_by_username
    FROM invites
    LEFT JOIN users AS created_by_user ON created_by_user.id = invites.created_by
    LEFT JOIN users AS used_by_user ON used_by_user.id = invites.used_by
    WHERE invites.id = ?
  `).get(inviteId)
  const inviteUrl = new URL('/', getPublicOrigin(req))
  inviteUrl.searchParams.set('invite', rawToken)
  inviteUrl.searchParams.set('email', email)

  res.status(201).json({
    invite: inviteSummary(created),
    inviteUrl: inviteUrl.toString()
  })
})

app.post('/api/admin/invites/:inviteId/revoke', requireAuth, requireAdmin, function revokeAdminInvite(req, res) {
  const invite = db.prepare('SELECT id, used_at, revoked_at FROM invites WHERE id = ?').get(req.params.inviteId)
  if (!invite) {
    return jsonError(res, 404, 'Invite not found')
  }
  if (invite.used_at) {
    return jsonError(res, 409, 'Used invites cannot be revoked')
  }
  if (!invite.revoked_at) {
    db.prepare('UPDATE invites SET revoked_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), invite.id)
  }
  res.json({ ok: true })
})

app.get('/api/study-packs', requireAuth, function listPacks(req, res) {
  const rows = db.prepare(
    'SELECT id, name, question_count, revision, created_at, updated_at FROM study_packs WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.user.id)
  res.json({ packs: rows.map(packSummary) })
})

app.post('/api/study-packs/import/folder-session', requireAuth, async function beginFolderImport(req, res) {
  const sessionId = await createImportSession(req.user.id, req.body.packName)
  res.json({ sessionId: sessionId })
})

app.post('/api/study-packs/import/folder-session/:sessionId/files', requireAuth, uploadAny, async function addFolderImportFiles(req, res) {
  const session = getImportSession(req.params.sessionId, req.user.id)
  if (!session) {
    return jsonError(res, 404, 'Import session not found')
  }
  if (session.state !== 'uploading') {
    return jsonError(res, 409, 'Import session is no longer accepting files')
  }
  if (!req.files || req.files.length === 0) {
    return jsonError(res, 400, 'Select folder files to upload')
  }

  await writeUploadFiles(session.uploadRoot, req.files)
  res.json({ ok: true, filesReceived: req.files.length })
})

app.post('/api/study-packs/import/folder-session/:sessionId/complete', requireAuth, async function completeFolderImport(req, res) {
  const session = getImportSession(req.params.sessionId, req.user.id)
  if (!session) {
    return jsonError(res, 404, 'Import session not found')
  }

  if (session.state === 'uploading') {
    finalizeImportSession(req.params.sessionId)
  }

  const summary = summarizeImportSession(session)
  if (summary.status === 'finalizing') {
    return res.status(202).json(summary)
  }

  res.json(summary)
})

app.get('/api/study-packs/import/folder-session/:sessionId', requireAuth, async function getFolderImportStatus(req, res) {
  const session = getImportSession(req.params.sessionId, req.user.id)
  if (!session) {
    return jsonError(res, 404, 'Import session not found')
  }

  res.json(summarizeImportSession(session))
})

app.delete('/api/study-packs/import/folder-session/:sessionId', requireAuth, async function cancelFolderImport(req, res) {
  const session = getImportSession(req.params.sessionId, req.user.id)
  if (!session) {
    return jsonError(res, 404, 'Import session not found')
  }
  if (session.state === 'finalizing') {
    return jsonError(res, 409, 'Import is currently being finalized')
  }
  await cleanupImportSession(req.params.sessionId)
  res.json({ ok: true })
})

app.post('/api/study-packs/import', requireAuth, uploadAny, async function importPack(req, res) {
  const importType = req.body.importType === 'zip' ? 'zip' : 'folder'
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'quail-ultra-live-'))

  try {
    if (importType === 'zip') {
      if (!req.files || req.files.length !== 1) {
        return jsonError(res, 400, 'Provide exactly one zip file')
      }
      await extractZipFile(tempRoot, req.files[0].path)
    } else {
      if (!req.files || req.files.length === 0) {
        return jsonError(res, 400, 'Select a study-pack folder to upload')
      }
      await writeUploadFiles(tempRoot, req.files)
    }

    const pack = await finalizeImportedPack(req.user.id, tempRoot, req.body.packName)
    res.json({ pack: packSummary(pack) })
  } catch (error) {
    jsonError(res, 400, error.message || 'Import failed')
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

app.get('/api/study-packs/:packId/qbankinfo', requireAuth, async function getQbank(req, res) {
  const pack = await loadPackForUser(req.user.id, req.params.packId, req.query.block || '')
  if (!pack) {
    return jsonError(res, 404, 'Study pack not found')
  }
  res.json({ qbankinfo: pack.qbankinfo, pack: packSummary(pack.row) })
})

app.get('/api/study-packs/:packId/manifest', requireAuth, async function getManifest(req, res) {
  const row = getPackForUser(req.user.id, req.params.packId)
  if (!row) {
    return jsonError(res, 404, 'Study pack not found')
  }
  const files = await listWorkspaceManifest(row.workspace_path)
  res.json({ files: files, revision: row.revision })
})

app.get('/api/study-packs/:packId/file/*', requireAuth, async function getPackFile(req, res) {
  const row = getPackForUser(req.user.id, req.params.packId)
  if (!row) {
    return jsonError(res, 404, 'Study pack not found')
  }

  try {
    const relativePath = req.params[0]
    const absolutePath = safeResolveWorkspaceFile(row.workspace_path, relativePath)
    if (!fs.existsSync(absolutePath)) {
      return jsonError(res, 404, 'File not found')
    }
    res.sendFile(absolutePath)
  } catch (error) {
    jsonError(res, 400, error.message || 'Invalid file path')
  }
})

app.post('/api/study-packs/:packId/blocks/start', requireAuth, async function startPackBlock(req, res) {
  const pack = await loadPackForUser(req.user.id, req.params.packId, '')
  if (!pack) {
    return jsonError(res, 404, 'Study pack not found')
  }

  const blockqlist = Array.isArray(req.body.blockqlist) ? req.body.blockqlist : []
  if (blockqlist.length === 0) {
    return jsonError(res, 400, 'No questions selected')
  }

  const blockKey = startBlock(pack.qbankinfo, blockqlist, req.body.preferences || {})
  const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, pack.row.revision + 1)

  res.json({
    blockKey: blockKey,
    revision: nextRevision
  })
})

app.put('/api/study-packs/:packId/progress', requireAuth, async function savePackProgress(req, res) {
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
      revision: pack.row.revision,
      applied: false,
      serverAcceptedAt: nowIso()
    })
  }

  pack.qbankinfo.progress = incomingProgress
  const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, pack.row.revision + 1, syncMetadata)
  res.json({ revision: nextRevision, applied: true, serverAcceptedAt: nowIso() })
})

app.delete('/api/study-packs/:packId/blocks/:blockKey', requireAuth, async function removeBlock(req, res) {
  const pack = await loadPackForUser(req.user.id, req.params.packId, '')
  if (!pack) {
    return jsonError(res, 404, 'Study pack not found')
  }

  deleteBlock(pack.qbankinfo, req.params.blockKey)
  const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, pack.row.revision + 1)
  res.json({ revision: nextRevision })
})

app.post('/api/study-packs/:packId/reset', requireAuth, async function resetPack(req, res) {
  const pack = await loadPackForUser(req.user.id, req.params.packId, '')
  if (!pack) {
    return jsonError(res, 404, 'Study pack not found')
  }

  pack.qbankinfo.progress = {
    blockhist: {},
    tagbuckets: {}
  }
  normalizeProgress(pack.qbankinfo.progress, pack.qbankinfo)
  const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, pack.row.revision + 1)
  res.json({ revision: nextRevision })
})

app.get('/api/study-packs/:packId/export.zip', requireAuth, async function exportPack(req, res) {
  const row = getPackForUser(req.user.id, req.params.packId)
  if (!row) {
    return jsonError(res, 404, 'Study pack not found')
  }

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${row.name.replace(/"/g, '')}.zip"`)

  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('error', function onArchiveError(error) {
    res.destroy(error)
  })
  archive.pipe(res)
  archive.directory(row.workspace_path, false)
  archive.finalize()
})

app.delete('/api/study-packs/:packId', requireAuth, async function deletePack(req, res) {
  const row = getPackForUser(req.user.id, req.params.packId)
  if (!row) {
    return jsonError(res, 404, 'Study pack not found')
  }

  await deletePackRow(row)
  res.json({ ok: true })
})

app.use(function apiErrorHandler(error, req, res, next) {
  if (!req.path.startsWith('/api/')) {
    return next(error)
  }

  if (res.headersSent) {
    return next(error)
  }

  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    return jsonError(res, status, multerErrorMessage(error))
  }

  console.error(error)
  return jsonError(res, 500, error && error.message ? error.message : 'Internal server error')
})

app.get('/', function root(_req, res) {
  res.sendFile(path.join(DIST_DIR, 'index.html'))
})

app.get('/:page(overview|newblock|previousblocks|examview|admin|loadbank).html', function htmlPages(req, res) {
  if (req.params.page === 'loadbank') {
    res.sendFile(path.join(WEB_DIR, 'loadbank.html'))
    return
  }
  res.sendFile(path.join(DIST_DIR, `${req.params.page}.html`))
})

async function bootstrap() {
  await ensureDirectories()
  db = initDb()
  app.listen(PORT, function started() {
    console.log(`Quail Ultra Live listening on http://localhost:${PORT}`)
    console.log(`Primary routes: ${routePathFor('study-packs')}, ${routePathFor('overview')}, ${routePathFor('newblock')}`)
  })
}

bootstrap().catch(function onBootstrapError(error) {
  console.error(error)
  process.exit(1)
})
