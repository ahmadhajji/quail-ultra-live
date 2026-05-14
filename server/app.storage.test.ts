import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

function listen(app: any): Promise<{ server: http.Server; origin: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Unable to bind test server.')
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` })
    })
  })
}

describe('storage import limits', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('rejects presigned upload batches without valid declared sizes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quail-storage-api-'))
    let server: http.Server | undefined

    try {
      process.env = {
        ...originalEnv,
        QUAIL_DATA_DIR: tempDir,
        QUAIL_STORAGE_BACKEND: 'railway',
        SESSION_SECRET: 'test-secret',
        S3_ENDPOINT: 'http://127.0.0.1:9',
        S3_REGION: 'us-east-1',
        S3_BUCKET: 'test-bucket',
        S3_ACCESS_KEY_ID: 'test',
        S3_SECRET_ACCESS_KEY: 'test'
      }
      vi.resetModules()

      const { createRepository, buildPasswordHash } = await import('./repository')
      const repository = createRepository()
      await repository.init()
      await repository.createUser({
        id: 'viewer',
        username: 'viewer',
        email: 'viewer@example.test',
        passwordHash: await buildPasswordHash('password'),
        role: 'user',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
      await repository.createImportSession({
        id: 'session-1',
        userId: 'viewer',
        requestedName: 'Pack',
        stagingPrefix: 'imports/session-1',
        state: 'uploading',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
      ;(repository as any).db.close()

      const { createApp } = await import('./app')
      const { createSessionToken } = await import('./auth')
      const { SESSION_COOKIE_NAME } = await import('./config')
      const runtime = await createApp()
      const bound = await listen(runtime.app)
      server = bound.server
      const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken('viewer')}`

      const response = await fetch(`${bound.origin}/api/study-packs/import/upload-urls`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: 'session-1',
          files: [{ relativePath: 'questions/q1.json' }]
        })
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Each upload must declare a valid file size.' })
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
