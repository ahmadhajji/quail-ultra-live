import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules()
  process.env = {
    ...originalEnv,
    ...env
  }
  return import('./config')
}

describe('config', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('defaults to the local backend', async () => {
    const config = await loadConfig({
      QUAIL_STORAGE_BACKEND: undefined,
      DATABASE_URL: undefined,
      BLOB_READ_WRITE_TOKEN: undefined
    })

    expect(config.getStorageBackend()).toBe('local')
    expect(config.getUploadMode()).toBe('multipart')
    expect(config.usesDirectUploads()).toBe(false)
  })

  it('selects the cloud backend when Vercel storage env vars are present', async () => {
    const config = await loadConfig({
      QUAIL_STORAGE_BACKEND: undefined,
      DATABASE_URL: 'postgres://example',
      BLOB_READ_WRITE_TOKEN: 'blob-token'
    })

    expect(config.getStorageBackend()).toBe('cloud')
    expect(config.getUploadMode()).toBe('vercel-blob')
    expect(config.usesDirectUploads()).toBe(true)
  })

  it('selects the railway backend only when explicitly configured', async () => {
    const config = await loadConfig({
      QUAIL_STORAGE_BACKEND: 'railway',
      QUAIL_DATA_DIR: '/tmp/quail-data'
    })

    expect(config.getStorageBackend()).toBe('railway')
    expect(config.getUploadMode()).toBe('presigned')
    expect(config.usesDirectUploads()).toBe(true)
    expect(config.DATA_DIR).toBe(path.resolve('/tmp/quail-data'))
    expect(config.LOCAL_DB_PATH).toBe(path.join(path.resolve('/tmp/quail-data'), 'quail-ultra-live.db'))
  })
})
