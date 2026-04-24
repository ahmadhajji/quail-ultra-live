import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

async function loadRepository(tempDir: string) {
  vi.resetModules()
  process.env = {
    ...originalEnv,
    QUAIL_DATA_DIR: tempDir,
    QUAIL_STORAGE_BACKEND: 'railway'
  }
  return import('./repository')
}

describe('local repository invite schema', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('migrates the legacy invite schema and still allows invite creation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quail-invite-schema-'))
    const dbPath = path.join(tempDir, 'quail-ultra-live.db')
    const adminId = 'admin-user-1'

    try {
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(dbPath)
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL DEFAULT '',
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE invites (
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
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `)
      db.prepare(`
        INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(adminId, 'admin', 'admin@quail.test', 'hash', 'admin', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      db.close()

      const { createRepository } = await loadRepository(tempDir)
      const repository = createRepository()
      await repository.init()
      await repository.createInvite({
        id: 'invite-1',
        email: 'student@example.com',
        tokenHash: 'token-hash-1',
        role: 'user',
        createdBy: adminId,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-08T00:00:00.000Z'
      })

      const invites = await repository.listInvites()
      expect(invites).toHaveLength(1)
      expect(invites[0].email).toBe('student@example.com')

      const migratedDb = new DatabaseSync(dbPath)
      const foreignKeys = migratedDb.prepare("PRAGMA foreign_key_list('invites')").all()
      migratedDb.close()
      expect(foreignKeys.some((constraint: any) => constraint.from === 'used_by')).toBe(false)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
