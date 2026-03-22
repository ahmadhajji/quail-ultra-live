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
const WEB_DIR = path.join(ROOT_DIR, 'web')
const DATA_DIR = path.join(ROOT_DIR, 'data')
const PACKS_DIR = path.join(DATA_DIR, 'study-packs')
const DB_PATH = path.join(DATA_DIR, 'quail-ultra-live.db')
const PORT = parseInt(process.env.PORT || '3000', 10)
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me'
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== 'false'

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 100,
    files: 20000
  }
})

function nowIso() {
  return new Date().toISOString()
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
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS study_packs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      question_count INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `)
  return db
}

let db

function jsonError(res, status, message) {
  res.status(status).json({ error: message })
}

function getCurrentUser(req) {
  if (!req.session.userId) {
    return null
  }
  const row = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.session.userId)
  return row || null
}

function requireAuth(req, res, next) {
  const user = getCurrentUser(req)
  if (!user) {
    return jsonError(res, 401, 'Authentication required')
  }
  req.user = user
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

function getPackForUser(userId, packId) {
  return db.prepare(
    'SELECT id, user_id, name, workspace_path, question_count, revision, created_at, updated_at FROM study_packs WHERE id = ? AND user_id = ?'
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

async function persistPackProgress(packRow, qbankinfo, nextRevision) {
  normalizeProgress(qbankinfo.progress, qbankinfo)
  await saveProgress(packRow.workspace_path, qbankinfo.progress)
  const updatedAt = nowIso()
  db.prepare('UPDATE study_packs SET revision = ?, updated_at = ? WHERE id = ?').run(nextRevision, updatedAt, packRow.id)
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
    await fsp.writeFile(absolutePath, file.buffer)
  }
}

async function extractZipBuffer(targetDir, buffer) {
  await fsp.mkdir(targetDir, { recursive: true })
  const zipPath = path.join(targetDir, 'upload.zip')
  await fsp.writeFile(zipPath, buffer)
  await fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: targetDir }))
    .promise()
  await fsp.unlink(zipPath)
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

app.post('/api/auth/register', async function register(req, res) {
  if (!ALLOW_REGISTRATION) {
    return jsonError(res, 403, 'Registration is disabled')
  }

  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  if (!username || !password) {
    return jsonError(res, 400, 'Username and password are required')
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) {
    return jsonError(res, 409, 'Username already exists')
  }

  const userId = crypto.randomUUID()
  const passwordHash = await bcrypt.hash(password, 10)
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    username,
    passwordHash,
    nowIso()
  )
  req.session.userId = userId
  res.json({ user: getCurrentUser(req) })
})

app.post('/api/auth/login', async function login(req, res) {
  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  if (!username || !password) {
    return jsonError(res, 400, 'Username and password are required')
  }

  const user = db.prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?').get(username)
  if (!user) {
    return jsonError(res, 401, 'Invalid username or password')
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    return jsonError(res, 401, 'Invalid username or password')
  }

  req.session.userId = user.id
  res.json({ user: getCurrentUser(req) })
})

app.post('/api/auth/logout', function logout(req, res) {
  req.session.destroy(function destroyed() {
    res.json({ ok: true })
  })
})

app.get('/api/study-packs', requireAuth, function listPacks(req, res) {
  const rows = db.prepare(
    'SELECT id, name, question_count, revision, created_at, updated_at FROM study_packs WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.user.id)
  res.json({ packs: rows.map(packSummary) })
})

app.post('/api/study-packs/import', requireAuth, upload.any(), async function importPack(req, res) {
  const importType = req.body.importType === 'zip' ? 'zip' : 'folder'
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'quail-ultra-live-'))

  try {
    if (importType === 'zip') {
      if (!req.files || req.files.length !== 1) {
        return jsonError(res, 400, 'Provide exactly one zip file')
      }
      await extractZipBuffer(tempRoot, req.files[0].buffer)
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

  const baseRevision = Number(req.body.baseRevision)
  const force = Boolean(req.body.force)
  if (!force && Number.isInteger(baseRevision) && baseRevision !== pack.row.revision) {
    return res.status(409).json({
      error: 'Revision conflict',
      serverRevision: pack.row.revision,
      qbankinfo: pack.qbankinfo
    })
  }

  pack.qbankinfo.progress = incomingProgress
  const nextRevision = await persistPackProgress(pack.row, pack.qbankinfo, pack.row.revision + 1)
  res.json({ revision: nextRevision })
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

  db.prepare('DELETE FROM study_packs WHERE id = ?').run(row.id)
  await fsp.rm(path.dirname(row.workspace_path), { recursive: true, force: true })
  res.json({ ok: true })
})

app.get('/', function root(_req, res) {
  res.sendFile(path.join(WEB_DIR, 'index.html'))
})

app.get('/:page(overview|newblock|previousblocks|examview|loadbank).html', function htmlPages(req, res) {
  res.sendFile(path.join(WEB_DIR, `${req.params.page}.html`))
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
