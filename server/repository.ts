// @ts-nocheck
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import bcrypt from 'bcryptjs'
import { neon } from '@neondatabase/serverless'
import {
  DATA_DIR,
  DEFAULT_REGISTRATION_MODE,
  LOCAL_DB_PATH,
  getDatabaseUrl,
  getStorageBackend
} from './config'

function nowIso() {
  return new Date().toISOString()
}

function createTokenHash(rawToken: string) {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

type ImportSessionInput = {
  id: string
  userId: string
  requestedName: string
  tempRoot?: string
  uploadRoot?: string
  stagingPrefix?: string
  state?: 'uploading' | 'finalizing' | 'completed' | 'failed'
  error?: string
  packId?: string
  createdAt?: string
  updatedAt?: string
}

type AnswerAnalyticsInput = {
  systemPackId: string
  questionId: string
  userId: string
  selectedChoice: string
  correctChoice: string
  answeredAt: string
}

export interface AppRepository {
  backend: 'local' | 'cloud'
  init(): Promise<void>
  getRegistrationMode(): Promise<'invite-only' | 'closed'>
  setRegistrationMode(nextMode: 'invite-only' | 'closed'): Promise<'invite-only' | 'closed'>
  getUserById(userId: string): Promise<any | null>
  getUserByUsername(username: string): Promise<any | null>
  createUser(input: {
    id: string
    username: string
    email: string
    passwordHash: string
    role: 'user' | 'admin'
    status: 'active' | 'disabled'
    createdAt: string
    updatedAt: string
  }): Promise<void>
  listUsers(): Promise<any[]>
  updateUser(userId: string, input: { email: string, role: 'user' | 'admin', status: 'active' | 'disabled', updatedAt: string }): Promise<void>
  deleteUser(userId: string): Promise<void>
  getInviteByTokenHash(tokenHash: string): Promise<any | null>
  getInviteById(inviteId: string): Promise<any | null>
  listInvites(): Promise<any[]>
  createInvite(input: {
    id: string
    email: string
    tokenHash: string
    role: 'user' | 'admin'
    createdBy: string
    createdAt: string
    updatedAt: string
    expiresAt: string
  }): Promise<void>
  markInviteUsed(inviteId: string, userId: string, timestamp: string): Promise<void>
  revokeInvite(inviteId: string, timestamp: string): Promise<void>
  listPacksForUser(userId: string): Promise<any[]>
  listAllPacks(): Promise<any[]>
  getPackById(packId: string): Promise<any | null>
  getPackForUser(userId: string, packId: string): Promise<any | null>
  createPack(input: {
    id: string
    userId: string
    name: string
    workspacePath: string
    questionCount: number
    revision: number
    createdAt: string
    updatedAt: string
    progressOverridePath?: string
  }): Promise<void>
  updatePack(packId: string, input: {
    revision: number
    updatedAt: string
    questionCount?: number
    lastClientInstanceId?: string
    lastClientMutationSeq?: number
    lastClientUpdatedAt?: string
  }): Promise<void>
  deletePack(packId: string): Promise<void>
  createImportSession(input: ImportSessionInput): Promise<void>
  getImportSession(sessionId: string): Promise<any | null>
  updateImportSession(sessionId: string, input: Partial<ImportSessionInput>): Promise<void>
  deleteImportSession(sessionId: string): Promise<void>
  listSystemPacks(): Promise<any[]>
  getSystemPackById(systemPackId: string): Promise<any | null>
  getSystemPackByWorkspacePath(workspacePath: string): Promise<any | null>
  createSystemPack(input: {
    id: string
    name: string
    description: string
    questionCount: number
    workspacePath: string
    createdAt: string
    updatedAt: string
  }): Promise<void>
  updateSystemPack(systemPackId: string, input: {
    questionCount: number
    updatedAt: string
  }): Promise<void>
  deleteSystemPack(systemPackId: string): Promise<void>
  recordAnswerAnalytics(input: AnswerAnalyticsInput[]): Promise<void>
  listAnswerDistribution(systemPackId: string, questionIds: string[], excludeUserId: string): Promise<any[]>
  deleteAnswerAnalyticsForSystemPack(systemPackId: string): Promise<void>
  createSupportTicket(input: { id: string; userId: string; subject: string; category: string; message: string; createdAt: string }): Promise<void>
  listSupportTickets(): Promise<any[]>
  createQuestionReport(input: { id: string; packId: string; questionId: string; userId: string; category: string; message: string; createdAt: string }): Promise<void>
  listQuestionReports(): Promise<any[]>
  readinessCheck(): Promise<void>
}

abstract class BaseRepository implements AppRepository {
  abstract backend: 'local' | 'cloud'
  abstract init(): Promise<void>
  abstract getRegistrationMode(): Promise<'invite-only' | 'closed'>
  abstract setRegistrationMode(nextMode: 'invite-only' | 'closed'): Promise<'invite-only' | 'closed'>
  abstract getUserById(userId: string): Promise<any | null>
  abstract getUserByUsername(username: string): Promise<any | null>
  abstract createUser(input: any): Promise<void>
  abstract listUsers(): Promise<any[]>
  abstract updateUser(userId: string, input: any): Promise<void>
  abstract deleteUser(userId: string): Promise<void>
  abstract getInviteByTokenHash(tokenHash: string): Promise<any | null>
  abstract getInviteById(inviteId: string): Promise<any | null>
  abstract listInvites(): Promise<any[]>
  abstract createInvite(input: any): Promise<void>
  abstract markInviteUsed(inviteId: string, userId: string, timestamp: string): Promise<void>
  abstract revokeInvite(inviteId: string, timestamp: string): Promise<void>
  abstract listPacksForUser(userId: string): Promise<any[]>
  abstract listAllPacks(): Promise<any[]>
  abstract getPackById(packId: string): Promise<any | null>
  abstract getPackForUser(userId: string, packId: string): Promise<any | null>
  abstract createPack(input: any): Promise<void>
  abstract updatePack(packId: string, input: any): Promise<void>
  abstract deletePack(packId: string): Promise<void>
  abstract createImportSession(input: ImportSessionInput): Promise<void>
  abstract getImportSession(sessionId: string): Promise<any | null>
  abstract updateImportSession(sessionId: string, input: Partial<ImportSessionInput>): Promise<void>
  abstract deleteImportSession(sessionId: string): Promise<void>
  abstract listSystemPacks(): Promise<any[]>
  abstract getSystemPackById(systemPackId: string): Promise<any | null>
  abstract getSystemPackByWorkspacePath(workspacePath: string): Promise<any | null>
  abstract createSystemPack(input: any): Promise<void>
  abstract updateSystemPack(systemPackId: string, input: any): Promise<void>
  abstract deleteSystemPack(systemPackId: string): Promise<void>
  abstract recordAnswerAnalytics(input: AnswerAnalyticsInput[]): Promise<void>
  abstract listAnswerDistribution(systemPackId: string, questionIds: string[], excludeUserId: string): Promise<any[]>
  abstract deleteAnswerAnalyticsForSystemPack(systemPackId: string): Promise<void>
  abstract createSupportTicket(input: { id: string; userId: string; subject: string; category: string; message: string; createdAt: string }): Promise<void>
  abstract listSupportTickets(): Promise<any[]>
  abstract createQuestionReport(input: { id: string; packId: string; questionId: string; userId: string; category: string; message: string; createdAt: string }): Promise<void>
  abstract listQuestionReports(): Promise<any[]>
  abstract readinessCheck(): Promise<void>

  async countUsers(): Promise<number> {
    return (await this.listUsers()).length
  }
}

class LocalRepository extends BaseRepository {
  backend = 'local' as const
  db: any

  async init(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true })
    const { DatabaseSync } = require('node:sqlite')
    this.db = new DatabaseSync(LOCAL_DB_PATH)
    this.db.exec(`
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
        FOREIGN KEY(created_by) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS import_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        requested_name TEXT NOT NULL DEFAULT '',
        temp_root TEXT NOT NULL DEFAULT '',
        upload_root TEXT NOT NULL DEFAULT '',
        staging_prefix TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'uploading',
        error TEXT NOT NULL DEFAULT '',
        pack_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS system_packs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        question_count INTEGER NOT NULL DEFAULT 0,
        workspace_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS question_reports (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL DEFAULT '',
        question_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS question_answer_analytics (
        system_pack_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        selected_choice TEXT NOT NULL,
        correct_choice TEXT NOT NULL DEFAULT '',
        answered_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (system_pack_id, question_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_question_answer_analytics_question
        ON question_answer_analytics (system_pack_id, question_id);
    `)
    // Lazily add progress_override_path to study_packs for existing installs.
    // The plan specifies: user-uploaded packs keep progress in their workspace,
    // library packs override the progress directory so progress is per-user.
    const columnInfo = this.db.prepare("PRAGMA table_info('study_packs')").all()
    const hasOverride = columnInfo.some((column: any) => column.name === 'progress_override_path')
    if (!hasOverride) {
      this.db.exec("ALTER TABLE study_packs ADD COLUMN progress_override_path TEXT NOT NULL DEFAULT ''")
    }
    this.migrateInviteTableIfNeeded()
    this.ensureSetting('registration_mode', DEFAULT_REGISTRATION_MODE)
    this.seedExplicitLocalAdmin()
  }

  migrateInviteTableIfNeeded() {
    const foreignKeys = this.db.prepare("PRAGMA foreign_key_list('invites')").all()
    const usedByHasForeignKey = foreignKeys.some((constraint: any) => constraint.from === 'used_by')
    if (!usedByHasForeignKey) {
      return
    }
    this.db.exec('PRAGMA foreign_keys = OFF')
    try {
      this.db.exec(`
        BEGIN;
        CREATE TABLE invites__new (
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
          FOREIGN KEY(created_by) REFERENCES users(id)
        );
        INSERT INTO invites__new (id, email, token_hash, role, created_by, created_at, updated_at, expires_at, used_by, used_at, revoked_at)
        SELECT id, email, token_hash, role, created_by, created_at, updated_at, expires_at, COALESCE(used_by, ''), COALESCE(used_at, ''), COALESCE(revoked_at, '')
        FROM invites;
        DROP TABLE invites;
        ALTER TABLE invites__new RENAME TO invites;
        COMMIT;
      `)
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Ignore rollback failures and surface the original migration error.
      }
      throw error
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON')
    }
  }

  ensureSetting(key: string, value: string) {
    const existing = this.db.prepare('SELECT key FROM app_settings WHERE key = ?').get(key)
    if (!existing) {
      this.db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, nowIso())
    }
  }

  seedExplicitLocalAdmin() {
    const username = String(process.env.LOCAL_BOOTSTRAP_ADMIN_USERNAME || '').trim()
    const password = String(process.env.LOCAL_BOOTSTRAP_ADMIN_PASSWORD || '')
    if (!username || !password) {
      return
    }
    const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existing) {
      return
    }
    const timestamp = nowIso()
    this.db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, '', ?, 'admin', 'active', ?, ?)
    `).run(crypto.randomUUID(), username, bcrypt.hashSync(password, 10), timestamp, timestamp)
  }

  async getRegistrationMode() {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get('registration_mode')
    return (row?.value || DEFAULT_REGISTRATION_MODE) as 'invite-only' | 'closed'
  }

  async setRegistrationMode(nextMode: 'invite-only' | 'closed') {
    this.db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?').run(nextMode, nowIso(), 'registration_mode')
    return nextMode
  }

  async getUserById(userId: string) {
    return this.db.prepare('SELECT id, username, email, role, status, created_at FROM users WHERE id = ?').get(userId) || null
  }

  async getUserByUsername(username: string) {
    return this.db.prepare('SELECT id, username, email, role, status, password_hash, created_at, updated_at FROM users WHERE username = ?').get(username) || null
  }

  async createUser(input: any) {
    this.db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.username, input.email, input.passwordHash, input.role, input.status, input.createdAt, input.updatedAt)
  }

  async listUsers() {
    return this.db.prepare(`
      SELECT users.id, users.username, users.email, users.role, users.status, users.created_at, users.updated_at,
        COUNT(study_packs.id) AS pack_count
      FROM users
      LEFT JOIN study_packs ON study_packs.user_id = users.id
      GROUP BY users.id
      ORDER BY users.created_at ASC
    `).all()
  }

  async updateUser(userId: string, input: any) {
    this.db.prepare('UPDATE users SET email = ?, role = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(input.email, input.role, input.status, input.updatedAt, userId)
  }

  async deleteUser(userId: string) {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  }

  async getInviteByTokenHash(tokenHash: string) {
    return this.db.prepare(`
      SELECT id, email, role, expires_at, used_at, revoked_at
      FROM invites
      WHERE token_hash = ?
    `).get(tokenHash) || null
  }

  async getInviteById(inviteId: string) {
    return this.db.prepare('SELECT id, used_at, revoked_at FROM invites WHERE id = ?').get(inviteId) || null
  }

  async listInvites() {
    return this.db.prepare(`
      SELECT invites.id, invites.email, invites.role, invites.created_at, invites.expires_at, invites.used_at, invites.revoked_at,
        created_by_user.username AS created_by_username,
        used_by_user.username AS used_by_username
      FROM invites
      LEFT JOIN users AS created_by_user ON created_by_user.id = invites.created_by
      LEFT JOIN users AS used_by_user ON used_by_user.id = NULLIF(invites.used_by, '')
      ORDER BY invites.created_at DESC
    `).all()
  }

  async createInvite(input: any) {
    this.db.prepare(`
      INSERT INTO invites (id, email, token_hash, role, created_by, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.email, input.tokenHash, input.role, input.createdBy, input.createdAt, input.updatedAt, input.expiresAt)
  }

  async markInviteUsed(inviteId: string, userId: string, timestamp: string) {
    this.db.prepare('UPDATE invites SET used_by = ?, used_at = ?, updated_at = ? WHERE id = ?').run(userId, timestamp, timestamp, inviteId)
  }

  async revokeInvite(inviteId: string, timestamp: string) {
    this.db.prepare('UPDATE invites SET revoked_at = ?, updated_at = ? WHERE id = ?').run(timestamp, timestamp, inviteId)
  }

  async listPacksForUser(userId: string) {
    return this.db.prepare(
      'SELECT id, user_id, name, workspace_path, progress_override_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(userId)
  }

  async listAllPacks() {
    return this.db.prepare(
      'SELECT id, user_id, name, workspace_path, progress_override_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs ORDER BY created_at ASC'
    ).all()
  }

  async getPackById(packId: string) {
    return this.db.prepare(
      'SELECT id, user_id, name, workspace_path, progress_override_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs WHERE id = ?'
    ).get(packId) || null
  }

  async getPackForUser(userId: string, packId: string) {
    return this.db.prepare(
      'SELECT id, user_id, name, workspace_path, progress_override_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs WHERE id = ? AND user_id = ?'
    ).get(packId, userId) || null
  }

  async createPack(input: any) {
    this.db.prepare(`
      INSERT INTO study_packs (
        id, user_id, name, workspace_path, progress_override_path, question_count, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.userId, input.name, input.workspacePath, input.progressOverridePath || '', input.questionCount, input.revision, input.createdAt, input.updatedAt)
  }

  async updatePack(packId: string, input: any) {
    const nextQuestionCount = Number.isFinite(Number(input.questionCount)) ? Number(input.questionCount) : -1
    this.db.prepare(`
      UPDATE study_packs
      SET question_count = CASE WHEN ? >= 0 THEN ? ELSE question_count END,
        revision = ?, updated_at = ?, last_client_instance_id = ?, last_client_mutation_seq = ?, last_client_updated_at = ?
      WHERE id = ?
    `).run(
      nextQuestionCount,
      nextQuestionCount,
      input.revision,
      input.updatedAt,
      input.lastClientInstanceId || '',
      input.lastClientMutationSeq || 0,
      input.lastClientUpdatedAt || '',
      packId
    )
  }

  async deletePack(packId: string) {
    this.db.prepare('DELETE FROM study_packs WHERE id = ?').run(packId)
  }

  async createImportSession(input: ImportSessionInput) {
    const createdAt = input.createdAt || nowIso()
    const updatedAt = input.updatedAt || createdAt
    this.db.prepare(`
      INSERT INTO import_sessions (
        id, user_id, requested_name, temp_root, upload_root, staging_prefix, state, error, pack_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.userId,
      input.requestedName || '',
      input.tempRoot || '',
      input.uploadRoot || '',
      input.stagingPrefix || '',
      input.state || 'uploading',
      input.error || '',
      input.packId || '',
      createdAt,
      updatedAt
    )
  }

  async getImportSession(sessionId: string) {
    return this.db.prepare('SELECT * FROM import_sessions WHERE id = ?').get(sessionId) || null
  }

  async updateImportSession(sessionId: string, input: Partial<ImportSessionInput>) {
    const existing = await this.getImportSession(sessionId)
    if (!existing) {
      return
    }
    this.db.prepare(`
      UPDATE import_sessions
      SET requested_name = ?, temp_root = ?, upload_root = ?, staging_prefix = ?, state = ?, error = ?, pack_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.requestedName ?? existing.requested_name,
      input.tempRoot ?? existing.temp_root,
      input.uploadRoot ?? existing.upload_root,
      input.stagingPrefix ?? existing.staging_prefix,
      input.state ?? existing.state,
      input.error ?? existing.error,
      input.packId ?? existing.pack_id,
      input.updatedAt ?? nowIso(),
      sessionId
    )
  }

  async deleteImportSession(sessionId: string) {
    this.db.prepare('DELETE FROM import_sessions WHERE id = ?').run(sessionId)
  }

  async listSystemPacks() {
    return this.db.prepare(
      'SELECT id, name, description, question_count, workspace_path, created_at, updated_at FROM system_packs ORDER BY created_at DESC'
    ).all()
  }

  async getSystemPackById(systemPackId: string) {
    return this.db.prepare(
      'SELECT id, name, description, question_count, workspace_path, created_at, updated_at FROM system_packs WHERE id = ?'
    ).get(systemPackId) || null
  }

  async getSystemPackByWorkspacePath(workspacePath: string) {
    return this.db.prepare(
      'SELECT id, name, description, question_count, workspace_path, created_at, updated_at FROM system_packs WHERE workspace_path = ?'
    ).get(workspacePath) || null
  }

  async createSystemPack(input: any) {
    this.db.prepare(`
      INSERT INTO system_packs (id, name, description, question_count, workspace_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.name, input.description || '', input.questionCount, input.workspacePath, input.createdAt, input.updatedAt)
  }

  async updateSystemPack(systemPackId: string, input: any) {
    this.db.prepare('UPDATE system_packs SET question_count = ?, updated_at = ? WHERE id = ?')
      .run(input.questionCount, input.updatedAt, systemPackId)
  }

  async deleteSystemPack(systemPackId: string) {
    this.db.prepare('DELETE FROM system_packs WHERE id = ?').run(systemPackId)
  }

  async recordAnswerAnalytics(input: AnswerAnalyticsInput[]) {
    if (input.length === 0) {
      return
    }
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO question_answer_analytics (
        system_pack_id, question_id, user_id, selected_choice, correct_choice, answered_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.db.exec('BEGIN')
    try {
      for (const item of input) {
        const timestamp = nowIso()
        statement.run(
          item.systemPackId,
          item.questionId,
          item.userId,
          item.selectedChoice,
          item.correctChoice,
          item.answeredAt,
          timestamp,
          timestamp
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Ignore rollback failures and surface the insert error.
      }
      throw error
    }
  }

  async listAnswerDistribution(systemPackId: string, questionIds: string[], excludeUserId: string) {
    const ids = [...new Set(questionIds.filter(Boolean))]
    if (!systemPackId || ids.length === 0) {
      return []
    }
    const placeholders = ids.map(() => '?').join(', ')
    return this.db.prepare(`
      SELECT question_id, selected_choice, COUNT(*) AS answer_count
      FROM question_answer_analytics
      WHERE system_pack_id = ? AND user_id != ? AND question_id IN (${placeholders})
      GROUP BY question_id, selected_choice
      ORDER BY question_id ASC, selected_choice ASC
    `).all(systemPackId, excludeUserId, ...ids)
  }

  async deleteAnswerAnalyticsForSystemPack(systemPackId: string) {
    this.db.prepare('DELETE FROM question_answer_analytics WHERE system_pack_id = ?').run(systemPackId)
  }

  async createSupportTicket(input: { id: string; userId: string; subject: string; category: string; message: string; createdAt: string }) {
    this.db.prepare(
      'INSERT INTO support_tickets (id, user_id, subject, category, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(input.id, input.userId, input.subject, input.category, input.message, input.createdAt)
  }

  async listSupportTickets() {
    return this.db.prepare(
      'SELECT st.id, st.user_id, st.subject, st.category, st.message, st.created_at, COALESCE(u.username, \'\') AS username FROM support_tickets st LEFT JOIN users u ON u.id = st.user_id ORDER BY st.created_at DESC'
    ).all()
  }

  async createQuestionReport(input: { id: string; packId: string; questionId: string; userId: string; category: string; message: string; createdAt: string }) {
    this.db.prepare(
      'INSERT INTO question_reports (id, pack_id, question_id, user_id, category, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(input.id, input.packId, input.questionId, input.userId, input.category, input.message, input.createdAt)
  }

  async listQuestionReports() {
    return this.db.prepare(
      'SELECT qr.id, qr.pack_id, qr.question_id, qr.user_id, qr.category, qr.message, qr.created_at, COALESCE(u.username, \'\') AS username FROM question_reports qr LEFT JOIN users u ON u.id = qr.user_id ORDER BY qr.created_at DESC'
    ).all()
  }

  async readinessCheck() {
    const key = '__readiness__'
    const timestamp = nowIso()
    this.db.prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, timestamp, timestamp)
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
  }
}

class CloudRepository extends BaseRepository {
  backend = 'cloud' as const
  sql = neon(getDatabaseUrl())

  async init(): Promise<void> {
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS study_packs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        question_count INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        last_client_instance_id TEXT NOT NULL DEFAULT '',
        last_client_mutation_seq INTEGER NOT NULL DEFAULT 0,
        last_client_updated_at TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `)
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'user',
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_by TEXT NOT NULL DEFAULT '',
        used_at TEXT NOT NULL DEFAULT '',
        revoked_at TEXT NOT NULL DEFAULT ''
      )
    `)
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `)
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS import_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_name TEXT NOT NULL DEFAULT '',
        temp_root TEXT NOT NULL DEFAULT '',
        upload_root TEXT NOT NULL DEFAULT '',
        staging_prefix TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'uploading',
        error TEXT NOT NULL DEFAULT '',
        pack_id TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `)
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS system_packs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        question_count INTEGER NOT NULL DEFAULT 0,
        workspace_path TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `)
    // Lazily add progress_override_path for library packs.
    await this.sql.query(`
      ALTER TABLE study_packs ADD COLUMN IF NOT EXISTS progress_override_path TEXT NOT NULL DEFAULT ''
    `)
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL
      )
    `)
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS question_reports (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL DEFAULT '',
        question_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL
      )
    `)
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS question_answer_analytics (
        system_pack_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        selected_choice TEXT NOT NULL,
        correct_choice TEXT NOT NULL DEFAULT '',
        answered_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (system_pack_id, question_id, user_id)
      )
    `)
    await this.sql.query(`
      CREATE INDEX IF NOT EXISTS idx_question_answer_analytics_question
        ON question_answer_analytics (system_pack_id, question_id)
    `)
    const existing = await this.sql.query('SELECT key FROM app_settings WHERE key = $1', ['registration_mode'])
    if (!existing[0]) {
      await this.sql.query('INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)', ['registration_mode', DEFAULT_REGISTRATION_MODE, nowIso()])
    }
  }

  async getRegistrationMode() {
    const rows = await this.sql.query('SELECT value FROM app_settings WHERE key = $1', ['registration_mode'])
    return ((rows[0] && rows[0].value) || DEFAULT_REGISTRATION_MODE) as 'invite-only' | 'closed'
  }

  async setRegistrationMode(nextMode: 'invite-only' | 'closed') {
    await this.sql.query('UPDATE app_settings SET value = $1, updated_at = $2 WHERE key = $3', [nextMode, nowIso(), 'registration_mode'])
    return nextMode
  }

  async getUserById(userId: string) {
    const rows = await this.sql.query('SELECT id, username, email, role, status, created_at FROM users WHERE id = $1', [userId])
    return rows[0] || null
  }

  async getUserByUsername(username: string) {
    const rows = await this.sql.query('SELECT id, username, email, role, status, password_hash, created_at, updated_at FROM users WHERE username = $1', [username])
    return rows[0] || null
  }

  async createUser(input: any) {
    await this.sql.query(`
      INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [input.id, input.username, input.email, input.passwordHash, input.role, input.status, input.createdAt, input.updatedAt])
  }

  async listUsers() {
    return this.sql.query(`
      SELECT users.id, users.username, users.email, users.role, users.status, users.created_at, users.updated_at,
        COUNT(study_packs.id)::int AS pack_count
      FROM users
      LEFT JOIN study_packs ON study_packs.user_id = users.id
      GROUP BY users.id
      ORDER BY users.created_at ASC
    `)
  }

  async updateUser(userId: string, input: any) {
    await this.sql.query('UPDATE users SET email = $1, role = $2, status = $3, updated_at = $4 WHERE id = $5', [input.email, input.role, input.status, input.updatedAt, userId])
  }

  async deleteUser(userId: string) {
    await this.sql.query('DELETE FROM users WHERE id = $1', [userId])
  }

  async getInviteByTokenHash(tokenHash: string) {
    const rows = await this.sql.query(`
      SELECT id, email, role, expires_at, used_at, revoked_at
      FROM invites
      WHERE token_hash = $1
    `, [tokenHash])
    return rows[0] || null
  }

  async getInviteById(inviteId: string) {
    const rows = await this.sql.query('SELECT id, used_at, revoked_at FROM invites WHERE id = $1', [inviteId])
    return rows[0] || null
  }

  async listInvites() {
    return this.sql.query(`
      SELECT invites.id, invites.email, invites.role, invites.created_at, invites.expires_at, invites.used_at, invites.revoked_at,
        created_by_user.username AS created_by_username,
        used_by_user.username AS used_by_username
      FROM invites
      LEFT JOIN users AS created_by_user ON created_by_user.id = invites.created_by
      LEFT JOIN users AS used_by_user ON used_by_user.id = NULLIF(invites.used_by, '')
      ORDER BY invites.created_at DESC
    `)
  }

  async createInvite(input: any) {
    await this.sql.query(`
      INSERT INTO invites (id, email, token_hash, role, created_by, created_at, updated_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [input.id, input.email, input.tokenHash, input.role, input.createdBy, input.createdAt, input.updatedAt, input.expiresAt])
  }

  async markInviteUsed(inviteId: string, userId: string, timestamp: string) {
    await this.sql.query('UPDATE invites SET used_by = $1, used_at = $2, updated_at = $2 WHERE id = $3', [userId, timestamp, inviteId])
  }

  async revokeInvite(inviteId: string, timestamp: string) {
    await this.sql.query('UPDATE invites SET revoked_at = $1, updated_at = $1 WHERE id = $2', [timestamp, inviteId])
  }

  async listPacksForUser(userId: string) {
    return this.sql.query(
      'SELECT id, user_id, name, workspace_path, progress_override_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    )
  }

  async listAllPacks() {
    return this.sql.query(
      'SELECT id, user_id, name, workspace_path, progress_override_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs ORDER BY created_at ASC'
    )
  }

  async getPackById(packId: string) {
    const rows = await this.sql.query(
      'SELECT id, user_id, name, workspace_path, progress_override_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs WHERE id = $1',
      [packId]
    )
    return rows[0] || null
  }

  async getPackForUser(userId: string, packId: string) {
    const rows = await this.sql.query(
      'SELECT id, user_id, name, workspace_path, progress_override_path, question_count, revision, last_client_instance_id, last_client_mutation_seq, last_client_updated_at, created_at, updated_at FROM study_packs WHERE id = $1 AND user_id = $2',
      [packId, userId]
    )
    return rows[0] || null
  }

  async createPack(input: any) {
    await this.sql.query(`
      INSERT INTO study_packs (
        id, user_id, name, workspace_path, progress_override_path, question_count, revision, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [input.id, input.userId, input.name, input.workspacePath, input.progressOverridePath || '', input.questionCount, input.revision, input.createdAt, input.updatedAt])
  }

  async updatePack(packId: string, input: any) {
    const nextQuestionCount = Number.isFinite(Number(input.questionCount)) ? Number(input.questionCount) : -1
    await this.sql.query(`
      UPDATE study_packs
      SET question_count = CASE WHEN $1 >= 0 THEN $2 ELSE question_count END,
        revision = $3, updated_at = $4, last_client_instance_id = $5, last_client_mutation_seq = $6, last_client_updated_at = $7
      WHERE id = $8
    `, [
      nextQuestionCount,
      nextQuestionCount,
      input.revision,
      input.updatedAt,
      input.lastClientInstanceId || '',
      input.lastClientMutationSeq || 0,
      input.lastClientUpdatedAt || '',
      packId
    ])
  }

  async deletePack(packId: string) {
    await this.sql.query('DELETE FROM study_packs WHERE id = $1', [packId])
  }

  async createImportSession(input: ImportSessionInput) {
    const createdAt = input.createdAt || nowIso()
    const updatedAt = input.updatedAt || createdAt
    await this.sql.query(`
      INSERT INTO import_sessions (
        id, user_id, requested_name, temp_root, upload_root, staging_prefix, state, error, pack_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      input.id,
      input.userId,
      input.requestedName || '',
      input.tempRoot || '',
      input.uploadRoot || '',
      input.stagingPrefix || '',
      input.state || 'uploading',
      input.error || '',
      input.packId || '',
      createdAt,
      updatedAt
    ])
  }

  async getImportSession(sessionId: string) {
    const rows = await this.sql.query('SELECT * FROM import_sessions WHERE id = $1', [sessionId])
    return rows[0] || null
  }

  async updateImportSession(sessionId: string, input: Partial<ImportSessionInput>) {
    const existing = await this.getImportSession(sessionId)
    if (!existing) {
      return
    }
    await this.sql.query(`
      UPDATE import_sessions
      SET requested_name = $1, temp_root = $2, upload_root = $3, staging_prefix = $4, state = $5, error = $6, pack_id = $7, updated_at = $8
      WHERE id = $9
    `, [
      input.requestedName ?? existing.requested_name,
      input.tempRoot ?? existing.temp_root,
      input.uploadRoot ?? existing.upload_root,
      input.stagingPrefix ?? existing.staging_prefix,
      input.state ?? existing.state,
      input.error ?? existing.error,
      input.packId ?? existing.pack_id,
      input.updatedAt ?? nowIso(),
      sessionId
    ])
  }

  async deleteImportSession(sessionId: string) {
    await this.sql.query('DELETE FROM import_sessions WHERE id = $1', [sessionId])
  }

  async listSystemPacks() {
    return this.sql.query(
      'SELECT id, name, description, question_count, workspace_path, created_at, updated_at FROM system_packs ORDER BY created_at DESC'
    )
  }

  async getSystemPackById(systemPackId: string) {
    const rows = await this.sql.query(
      'SELECT id, name, description, question_count, workspace_path, created_at, updated_at FROM system_packs WHERE id = $1',
      [systemPackId]
    )
    return rows[0] || null
  }

  async getSystemPackByWorkspacePath(workspacePath: string) {
    const rows = await this.sql.query(
      'SELECT id, name, description, question_count, workspace_path, created_at, updated_at FROM system_packs WHERE workspace_path = $1',
      [workspacePath]
    )
    return rows[0] || null
  }

  async createSystemPack(input: any) {
    await this.sql.query(`
      INSERT INTO system_packs (id, name, description, question_count, workspace_path, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [input.id, input.name, input.description || '', input.questionCount, input.workspacePath, input.createdAt, input.updatedAt])
  }

  async updateSystemPack(systemPackId: string, input: any) {
    await this.sql.query(
      'UPDATE system_packs SET question_count = $1, updated_at = $2 WHERE id = $3',
      [input.questionCount, input.updatedAt, systemPackId]
    )
  }

  async deleteSystemPack(systemPackId: string) {
    await this.sql.query('DELETE FROM system_packs WHERE id = $1', [systemPackId])
  }

  async recordAnswerAnalytics(input: AnswerAnalyticsInput[]) {
    for (const item of input) {
      const timestamp = nowIso()
      await this.sql.query(`
        INSERT INTO question_answer_analytics (
          system_pack_id, question_id, user_id, selected_choice, correct_choice, answered_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (system_pack_id, question_id, user_id) DO NOTHING
      `, [
        item.systemPackId,
        item.questionId,
        item.userId,
        item.selectedChoice,
        item.correctChoice,
        item.answeredAt,
        timestamp,
        timestamp
      ])
    }
  }

  async listAnswerDistribution(systemPackId: string, questionIds: string[], excludeUserId: string) {
    const ids = [...new Set(questionIds.filter(Boolean))]
    if (!systemPackId || ids.length === 0) {
      return []
    }
    const placeholders = ids.map((_, index) => `$${index + 3}`).join(', ')
    return this.sql.query(`
      SELECT question_id, selected_choice, COUNT(*)::int AS answer_count
      FROM question_answer_analytics
      WHERE system_pack_id = $1 AND user_id != $2 AND question_id IN (${placeholders})
      GROUP BY question_id, selected_choice
      ORDER BY question_id ASC, selected_choice ASC
    `, [systemPackId, excludeUserId, ...ids])
  }

  async deleteAnswerAnalyticsForSystemPack(systemPackId: string) {
    await this.sql.query('DELETE FROM question_answer_analytics WHERE system_pack_id = $1', [systemPackId])
  }

  async createSupportTicket(input: { id: string; userId: string; subject: string; category: string; message: string; createdAt: string }) {
    await this.sql.query(
      'INSERT INTO support_tickets (id, user_id, subject, category, message, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [input.id, input.userId, input.subject, input.category, input.message, input.createdAt]
    )
  }

  async listSupportTickets() {
    return this.sql.query(
      "SELECT st.id, st.user_id, st.subject, st.category, st.message, st.created_at, COALESCE(u.username, '') AS username FROM support_tickets st LEFT JOIN users u ON u.id = st.user_id ORDER BY st.created_at DESC"
    )
  }

  async createQuestionReport(input: { id: string; packId: string; questionId: string; userId: string; category: string; message: string; createdAt: string }) {
    await this.sql.query(
      'INSERT INTO question_reports (id, pack_id, question_id, user_id, category, message, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [input.id, input.packId, input.questionId, input.userId, input.category, input.message, input.createdAt]
    )
  }

  async listQuestionReports() {
    return this.sql.query(
      "SELECT qr.id, qr.pack_id, qr.question_id, qr.user_id, qr.category, qr.message, qr.created_at, COALESCE(u.username, '') AS username FROM question_reports qr LEFT JOIN users u ON u.id = qr.user_id ORDER BY qr.created_at DESC"
    )
  }

  async readinessCheck() {
    const key = '__readiness__'
    const timestamp = nowIso()
    await this.sql.query(
      'INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at',
      [key, timestamp, timestamp]
    )
    await this.sql.query('DELETE FROM app_settings WHERE key = $1', [key])
  }
}

export function buildPasswordHash(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export function comparePassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash)
}

export function createInviteToken(): { rawToken: string, tokenHash: string } {
  const rawToken = crypto.randomUUID()
  return {
    rawToken,
    tokenHash: createTokenHash(rawToken)
  }
}

export function hashInviteToken(rawToken: string): string {
  return createTokenHash(rawToken)
}

export function createRepository(): AppRepository {
  if (getStorageBackend() === 'cloud') {
    return new CloudRepository()
  }
  return new LocalRepository()
}
