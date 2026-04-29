import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

async function writeWorkspace(workspaceDir: string) {
  await fs.mkdir(workspaceDir, { recursive: true })
  await fs.writeFile(path.join(workspaceDir, 'index.json'), JSON.stringify({ '101': { 0: 'General' } }))
  await fs.writeFile(path.join(workspaceDir, 'tagnames.json'), JSON.stringify({ tagnames: { 0: 'System' } }))
  await fs.writeFile(path.join(workspaceDir, 'choices.json'), JSON.stringify({ '101': { options: ['A', 'B'], correct: 'B' } }))
  await fs.writeFile(path.join(workspaceDir, 'groups.json'), JSON.stringify({}))
  await fs.writeFile(path.join(workspaceDir, 'panes.json'), JSON.stringify({}))
  await fs.writeFile(path.join(workspaceDir, 'progress.json'), JSON.stringify({ blockhist: {}, tagbuckets: {} }))
  await fs.writeFile(path.join(workspaceDir, '101-q.html'), '<p>Question 101</p>')
  await fs.writeFile(path.join(workspaceDir, '101-s.html'), '<p>Correct Answer: B</p>')
}

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

describe('progress sync API', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('rejects stale base revisions with current server state', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quail-progress-api-'))
    let server: http.Server | undefined

    try {
      process.env = {
        ...originalEnv,
        QUAIL_DATA_DIR: tempDir,
        QUAIL_STORAGE_BACKEND: 'local',
        SESSION_SECRET: 'test-secret'
      }
      vi.resetModules()
      const workspaceDir = path.join(tempDir, 'workspace')
      await writeWorkspace(workspaceDir)

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
      await repository.createPack({
        id: 'pack-1',
        userId: 'viewer',
        name: 'Pack',
        workspacePath: workspaceDir,
        questionCount: 1,
        revision: 2,
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

      const response = await fetch(`${bound.origin}/api/study-packs/pack-1/progress`, {
        method: 'PUT',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          baseRevision: 1,
          clientInstanceId: 'tab-1',
          clientMutationSeq: 1,
          clientUpdatedAt: '2026-01-01T00:00:01.000Z',
          progress: { blockhist: {}, tagbuckets: {} }
        })
      })

      expect(response.status).toBe(409)
      const body: any = await response.json()
      expect(body.serverRevision).toBe(2)
      expect(body.qbankinfo.revision).toBe(2)
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
