import fs from 'node:fs'
import path from 'node:path'

export type StorageBackend = 'local' | 'cloud'

const rootDir = fs.existsSync(path.join(__dirname, '..', 'package.json'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '..', '..')

export const ROOT_DIR = rootDir
export const DIST_DIR = path.join(ROOT_DIR, 'dist')
export const DATA_DIR = path.join(ROOT_DIR, 'data')
export const PACKS_DIR = path.join(DATA_DIR, 'study-packs')
export const LOCAL_DB_PATH = path.join(DATA_DIR, 'quail-ultra-live.db')
export const PORT = parseInt(process.env.PORT || '3000', 10)
export const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me'
export const SESSION_COOKIE_NAME = 'quail_session'
export const DEFAULT_REGISTRATION_MODE = process.env.ALLOW_REGISTRATION === 'false' ? 'closed' : 'invite-only'
export const MAX_UPLOAD_FILE_SIZE = 1024 * 1024 * 1024

export function getStorageBackend(): StorageBackend {
  const explicit = String(process.env.QUAIL_STORAGE_BACKEND || '').trim().toLowerCase()
  if (explicit === 'local' || explicit === 'cloud') {
    return explicit
  }
  if (process.env.VERCEL || (process.env.DATABASE_URL && process.env.BLOB_READ_WRITE_TOKEN)) {
    return 'cloud'
  }
  return 'local'
}

export function usesCloudStorage(): boolean {
  return getStorageBackend() === 'cloud'
}

export function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)
}

export function getDatabaseUrl(): string {
  const value = String(process.env.DATABASE_URL || '').trim()
  if (!value) {
    throw new Error('DATABASE_URL is required for the cloud storage backend.')
  }
  return value
}

export function getBlobToken(): string {
  const value = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim()
  if (!value) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required for the cloud storage backend.')
  }
  return value
}
