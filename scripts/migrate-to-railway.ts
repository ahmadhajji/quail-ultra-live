// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LOCAL_DB_PATH } from '../server/config'
import { createRepository } from '../server/repository'
import { createWorkspaceStore } from '../server/workspace-store'

type Args = {
  snapshotDir: string
  dbPath: string
  packsDir: string
}

function parseArgs(): Args {
  const snapshotDir = path.resolve(process.cwd(), process.argv.includes('--snapshot') ? process.argv[process.argv.indexOf('--snapshot') + 1] : 'data')
  const dbPath = path.resolve(process.cwd(), process.argv.includes('--db') ? process.argv[process.argv.indexOf('--db') + 1] : path.join(snapshotDir, 'quail-ultra-live.db'))
  const packsDir = path.resolve(process.cwd(), process.argv.includes('--packs') ? process.argv[process.argv.indexOf('--packs') + 1] : path.join(snapshotDir, 'study-packs'))
  return { snapshotDir, dbPath, packsDir }
}

function resolvePackWorkspace(packsDir: string, row: any) {
  const preferred = path.join(packsDir, row.id, 'workspace')
  if (fs.existsSync(preferred)) {
    return preferred
  }
  if (row.workspace_path && fs.existsSync(row.workspace_path)) {
    return row.workspace_path
  }
  throw new Error(`Unable to locate workspace for pack ${row.id}`)
}

function tableExists(db: DatabaseSync, tableName: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  return Boolean(row)
}

function getColumnNames(db: DatabaseSync, tableName: string) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row: any) => row.name)
}

function hasColumn(db: DatabaseSync, tableName: string, columnName: string) {
  return getColumnNames(db, tableName).includes(columnName)
}

async function main() {
  const args = parseArgs()
  process.env.QUAIL_STORAGE_BACKEND = 'railway'

  const repository = createRepository()
  await repository.init()
  const workspaceStore = createWorkspaceStore()
  const sourceDb = new DatabaseSync(args.dbPath)
  const targetDb = new DatabaseSync(LOCAL_DB_PATH)

  const settings = tableExists(sourceDb, 'app_settings')
    ? sourceDb.prepare('SELECT key, value, updated_at FROM app_settings').all()
    : []
  for (const row of settings) {
    targetDb.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(row.key, row.value, row.updated_at)
  }

  const userColumns = getColumnNames(sourceDb, 'users')
  const users = sourceDb.prepare(`SELECT ${userColumns.join(', ')} FROM users`).all()
  for (const row of users) {
    const username = String(row.username || '').trim()
    const inferredRole = username === 'ahmad' ? 'admin' : 'user'
    targetDb.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        email = excluded.email,
        password_hash = excluded.password_hash,
        role = excluded.role,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      row.id,
      username,
      row.email || '',
      row.password_hash,
      row.role || inferredRole,
      row.status || 'active',
      row.created_at,
      row.updated_at || row.created_at
    )
  }

  const invites = tableExists(sourceDb, 'invites')
    ? sourceDb.prepare('SELECT id, email, token_hash, role, created_by, created_at, updated_at, expires_at, used_by, used_at, revoked_at FROM invites').all()
    : []
  for (const row of invites) {
    targetDb.prepare(`
      INSERT INTO invites (id, email, token_hash, role, created_by, created_at, updated_at, expires_at, used_by, used_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        token_hash = excluded.token_hash,
        role = excluded.role,
        created_by = excluded.created_by,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        used_by = excluded.used_by,
        used_at = excluded.used_at,
        revoked_at = excluded.revoked_at
    `).run(
      row.id,
      row.email,
      row.token_hash,
      row.role || 'user',
      row.created_by,
      row.created_at,
      row.updated_at,
      row.expires_at,
      row.used_by || '',
      row.used_at || '',
      row.revoked_at || ''
    )
  }

  const packColumns = getColumnNames(sourceDb, 'study_packs')
  const packs = sourceDb.prepare(`SELECT ${packColumns.join(', ')} FROM study_packs ORDER BY created_at ASC`).all()

  for (const row of packs) {
    const sourceWorkspace = resolvePackWorkspace(args.packsDir, row)
    const finalPrefix = `packs/${row.id}/workspace`
    const imported = await workspaceStore.importWorkspaceFromLocalDirectory(sourceWorkspace, finalPrefix)
    targetDb.prepare(`
      INSERT INTO study_packs (
        id, user_id, name, workspace_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        name = excluded.name,
        workspace_path = excluded.workspace_path,
        question_count = excluded.question_count,
        revision = excluded.revision,
        last_client_instance_id = excluded.last_client_instance_id,
        last_client_mutation_seq = excluded.last_client_mutation_seq,
        last_client_updated_at = excluded.last_client_updated_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      row.id,
      row.user_id,
      row.name,
      finalPrefix,
      Number(imported.questionCount || row.question_count || 0),
      Number(row.revision || 0),
      hasColumn(sourceDb, 'study_packs', 'last_client_instance_id') ? (row.last_client_instance_id || '') : '',
      hasColumn(sourceDb, 'study_packs', 'last_client_mutation_seq') ? Number(row.last_client_mutation_seq || 0) : 0,
      hasColumn(sourceDb, 'study_packs', 'last_client_updated_at') ? (row.last_client_updated_at || '') : '',
      row.created_at,
      row.updated_at
    )
    console.log(`Migrated pack ${row.id} -> ${finalPrefix}`)
  }

  const remoteCounts = {
    users: Number(targetDb.prepare('SELECT COUNT(*) AS count FROM users').get()?.count || 0),
    invites: Number(targetDb.prepare('SELECT COUNT(*) AS count FROM invites').get()?.count || 0),
    packs: Number(targetDb.prepare('SELECT COUNT(*) AS count FROM study_packs').get()?.count || 0)
  }

  console.log('Migration complete.')
  console.log(JSON.stringify({
    snapshot: {
      dbPath: args.dbPath,
      packsDir: args.packsDir,
      users: users.length,
      invites: invites.length,
      packs: packs.length
    },
    targetDb: LOCAL_DB_PATH,
    remote: remoteCounts
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
