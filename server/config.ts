import fs from 'node:fs'
import path from 'node:path'

export type StorageBackend = 'local' | 'cloud' | 'railway'
export type UploadMode = 'multipart' | 'vercel-blob' | 'presigned'

const rootDir = fs.existsSync(path.join(__dirname, '..', 'package.json'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '..', '..')

export const ROOT_DIR = rootDir
export const DIST_DIR = path.join(ROOT_DIR, 'dist')
export const DATA_DIR = path.resolve(process.env.QUAIL_DATA_DIR || path.join(ROOT_DIR, 'data'))
export const PACKS_DIR = path.join(DATA_DIR, 'study-packs')
export const LOCAL_DB_PATH = path.join(DATA_DIR, 'quail-ultra-live.db')
export const PORT = parseInt(process.env.PORT || '3000', 10)
export const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me'
export const SESSION_COOKIE_NAME = 'quail_session'
export const DEFAULT_REGISTRATION_MODE = process.env.ALLOW_REGISTRATION === 'false' ? 'closed' : 'invite-only'
export const MAX_UPLOAD_FILE_SIZE = 1024 * 1024 * 1024

export function getStorageBackend(): StorageBackend {
  const explicit = String(process.env.QUAIL_STORAGE_BACKEND || '').trim().toLowerCase()
  if (explicit === 'local' || explicit === 'cloud' || explicit === 'railway') {
    return explicit
  }
  // Vercel previews may exist before all production storage env vars are wired.
  // Only opt into the cloud backend when both required services are configured.
  if (process.env.DATABASE_URL && process.env.BLOB_READ_WRITE_TOKEN) {
    return 'cloud'
  }
  return 'local'
}

export function usesCloudStorage(): boolean {
  return getStorageBackend() === 'cloud'
}

export function getUploadMode(): UploadMode {
  const backend = getStorageBackend()
  if (backend === 'cloud') {
    return 'vercel-blob'
  }
  if (backend === 'railway') {
    return 'presigned'
  }
  return 'multipart'
}

export function usesDirectUploads(): boolean {
  return getUploadMode() !== 'multipart'
}

export function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)
}

export function isRailwayRuntime(): boolean {
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_PROJECT_ID)
}

export function validateRuntimeConfig(): void {
  const productionLike = process.env.NODE_ENV === 'production' || isRailwayRuntime()
  if (!productionLike) {
    return
  }
  const errors: string[] = []
  if (isRailwayRuntime() && process.env.NODE_ENV !== 'production') {
    errors.push('NODE_ENV=production is required on Railway.')
  }
  if (SESSION_SECRET === 'dev-session-secret-change-me' || SESSION_SECRET.trim().length < 32) {
    errors.push('SESSION_SECRET must be set to a strong value of at least 32 characters.')
  }
  if (isRailwayRuntime() && getStorageBackend() !== 'railway') {
    errors.push('QUAIL_STORAGE_BACKEND=railway is required on Railway.')
  }
  if (isRailwayRuntime() && DATA_DIR !== path.resolve('/data')) {
    errors.push('QUAIL_DATA_DIR=/data is required on Railway.')
  }
  if (getStorageBackend() === 'railway') {
    for (const group of [
      ['S3_ENDPOINT', 'AWS_ENDPOINT_URL'],
      ['S3_REGION', 'AWS_DEFAULT_REGION'],
      ['S3_BUCKET', 'AWS_S3_BUCKET_NAME'],
      ['S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'],
      ['S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY']
    ]) {
      if (!group.some((name) => String(process.env[name] || '').trim())) {
        errors.push(`${group.join(' or ')} is required for Railway bucket storage.`)
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Unsafe production configuration:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }
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

function requireAnyEnv(names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || '').trim()
    if (value) {
      return value
    }
  }
  throw new Error(`${names.join(' or ')} is required for the railway storage backend.`)
}

export function getS3Endpoint(): string {
  const value = requireAnyEnv(['S3_ENDPOINT', 'AWS_ENDPOINT_URL'])
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

export function getS3Region(): string {
  return requireAnyEnv(['S3_REGION', 'AWS_DEFAULT_REGION'])
}

export function getS3Bucket(): string {
  return requireAnyEnv(['S3_BUCKET', 'AWS_S3_BUCKET_NAME'])
}

export function getS3AccessKeyId(): string {
  return requireAnyEnv(['S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'])
}

export function getS3SecretAccessKey(): string {
  return requireAnyEnv(['S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'])
}

export function shouldUseS3PathStyle(): boolean {
  return String(process.env.S3_FORCE_PATH_STYLE || 'true').trim().toLowerCase() !== 'false'
}

export function getResendApiKey(): string | null {
  const value = String(process.env.RESEND_API_KEY || '').trim()
  return value || null
}

export function getResendFromAddress(): string {
  const value = String(process.env.RESEND_FROM_EMAIL || '').trim()
  return value || 'Quail Ultra <onboarding@resend.dev>'
}
