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

describe('security hardening middleware', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('sets hardening headers and does not expose node_modules through /vendor', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quail-security-api-'))
    let server: http.Server | undefined

    try {
      process.env = {
        ...originalEnv,
        QUAIL_DATA_DIR: tempDir,
        QUAIL_STORAGE_BACKEND: 'local',
        SESSION_SECRET: 'test-secret'
      }
      vi.resetModules()
      const { createApp } = await import('./app')
      const runtime = await createApp()
      const bound = await listen(runtime.app)
      server = bound.server

      const health = await fetch(`${bound.origin}/api/health`)
      expect(health.headers.get('x-frame-options')).toBe('DENY')
      expect(health.headers.get('x-content-type-options')).toBe('nosniff')
      expect(health.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
      expect(health.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")

      const vendor = await fetch(`${bound.origin}/vendor/bootstrap/package.json`)
      expect(vendor.status).toBe(404)
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('rate limits repeated login attempts', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quail-security-rate-'))
    let server: http.Server | undefined

    try {
      process.env = {
        ...originalEnv,
        QUAIL_DATA_DIR: tempDir,
        QUAIL_STORAGE_BACKEND: 'local',
        SESSION_SECRET: 'test-secret'
      }
      vi.resetModules()
      const { createApp } = await import('./app')
      const runtime = await createApp()
      const bound = await listen(runtime.app)
      server = bound.server

      let lastStatus = 0
      for (let index = 0; index < 21; index += 1) {
        const response = await fetch(`${bound.origin}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: '', password: '' })
        })
        lastStatus = response.status
      }
      expect(lastStatus).toBe(429)
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
