// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { neon } from '@neondatabase/serverless'
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
  process.env.QUAIL_STORAGE_BACKEND = 'cloud'

  const repository = createRepository()
  await repository.init()
  const workspaceStore = createWorkspaceStore()
  const sql = neon(String(process.env.DATABASE_URL || ''))
  const localDb = new DatabaseSync(args.dbPath)

  const settings = tableExists(localDb, 'app_settings')
    ? localDb.prepare('SELECT key, value, updated_at FROM app_settings').all()
    : []
  for (const row of settings) {
    await sql.query(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `, [row.key, row.value, row.updated_at])
  }

  const userColumns = getColumnNames(localDb, 'users')
  const users = localDb.prepare(`SELECT ${userColumns.join(', ')} FROM users`).all()
  for (const row of users) {
    const username = String(row.username || '').trim()
    const inferredRole = username === 'ahmad' ? 'admin' : 'user'
    await sql.query(`
      INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `, [
      row.id,
      username,
      row.email || '',
      row.password_hash,
      row.role || inferredRole,
      row.status || 'active',
      row.created_at,
      row.updated_at || row.created_at
    ])
  }

  const invites = tableExists(localDb, 'invites')
    ? localDb.prepare('SELECT id, email, token_hash, role, created_by, created_at, updated_at, expires_at, used_by, used_at, revoked_at FROM invites').all()
    : []
  for (const row of invites) {
    await sql.query(`
      INSERT INTO invites (id, email, token_hash, role, created_by, created_at, updated_at, expires_at, used_by, used_at, revoked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        token_hash = EXCLUDED.token_hash,
        role = EXCLUDED.role,
        created_by = EXCLUDED.created_by,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        expires_at = EXCLUDED.expires_at,
        used_by = EXCLUDED.used_by,
        used_at = EXCLUDED.used_at,
        revoked_at = EXCLUDED.revoked_at
    `, [row.id, row.email, row.token_hash, row.role || 'user', row.created_by, row.created_at, row.updated_at, row.expires_at, row.used_by || '', row.used_at || '', row.revoked_at || ''])
  }

  const packColumns = getColumnNames(localDb, 'study_packs')
  const packs = localDb.prepare(`SELECT ${packColumns.join(', ')} FROM study_packs ORDER BY created_at ASC`).all()

  for (const row of packs) {
    const sourceWorkspace = resolvePackWorkspace(args.packsDir, row)
    const finalPrefix = `packs/${row.id}/workspace`
    await workspaceStore.importWorkspaceFromLocalDirectory(sourceWorkspace, finalPrefix)
    await sql.query(`
      INSERT INTO study_packs (
        id, user_id, name, workspace_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        workspace_path = EXCLUDED.workspace_path,
        question_count = EXCLUDED.question_count,
        revision = EXCLUDED.revision,
        last_client_instance_id = EXCLUDED.last_client_instance_id,
        last_client_mutation_seq = EXCLUDED.last_client_mutation_seq,
        last_client_updated_at = EXCLUDED.last_client_updated_at,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `, [
      row.id,
      row.user_id,
      row.name,
      finalPrefix,
      Number(row.question_count || 0),
      Number(row.revision || 0),
      hasColumn(localDb, 'study_packs', 'last_client_instance_id') ? (row.last_client_instance_id || '') : '',
      hasColumn(localDb, 'study_packs', 'last_client_mutation_seq') ? Number(row.last_client_mutation_seq || 0) : 0,
      hasColumn(localDb, 'study_packs', 'last_client_updated_at') ? (row.last_client_updated_at || '') : '',
      row.created_at,
      row.updated_at
    ])
    console.log(`Migrated pack ${row.id} -> ${finalPrefix}`)
  }

  const remoteCounts = {
    users: Number((await sql.query('SELECT COUNT(*)::int AS count FROM users'))[0]?.count || 0),
    invites: Number((await sql.query('SELECT COUNT(*)::int AS count FROM invites'))[0]?.count || 0),
    packs: Number((await sql.query('SELECT COUNT(*)::int AS count FROM study_packs'))[0]?.count || 0)
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
    remote: remoteCounts
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
