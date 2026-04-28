import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

async function writeWorkspace(workspaceDir: string) {
  await fs.mkdir(workspaceDir, { recursive: true })
  await fs.writeFile(path.join(workspaceDir, 'index.json'), JSON.stringify({ '101': { 0: 'General' }, '102': { 0: 'General' } }))
  await fs.writeFile(path.join(workspaceDir, 'tagnames.json'), JSON.stringify({ tagnames: { 0: 'System' } }))
  await fs.writeFile(path.join(workspaceDir, 'choices.json'), JSON.stringify({
    '101': { options: ['A', 'B', 'C'], correct: 'B' },
    '102': { options: ['A', 'B', 'C'], correct: 'A' }
  }))
  await fs.writeFile(path.join(workspaceDir, 'groups.json'), JSON.stringify({}))
  await fs.writeFile(path.join(workspaceDir, 'panes.json'), JSON.stringify({}))
  await fs.writeFile(path.join(workspaceDir, 'progress.json'), JSON.stringify({ blockhist: {}, tagbuckets: {} }))
  await fs.writeFile(path.join(workspaceDir, '101-q.html'), '<p>Question 101</p>')
  await fs.writeFile(path.join(workspaceDir, '101-s.html'), '<p>Correct Answer: B</p>')
  await fs.writeFile(path.join(workspaceDir, '102-q.html'), '<p>Question 102</p>')
  await fs.writeFile(path.join(workspaceDir, '102-s.html'), '<p>Correct Answer: A</p>')
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

describe('question stats API', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('returns library-only peer distributions with privacy threshold behavior', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quail-question-stats-api-'))
    let server: http.Server | undefined

    try {
      process.env = {
        ...originalEnv,
        QUAIL_DATA_DIR: tempDir,
        QUAIL_STORAGE_BACKEND: 'local',
        SESSION_SECRET: 'test-secret'
      }
      vi.resetModules()
      const workspaceDir = path.join(tempDir, 'system-pack-workspace')
      const privateWorkspaceDir = path.join(tempDir, 'private-pack-workspace')
      await writeWorkspace(workspaceDir)
      await writeWorkspace(privateWorkspaceDir)

      const { createRepository, buildPasswordHash } = await import('./repository')
      const repository = createRepository()
      await repository.init()
      for (const userId of ['viewer', 'peer-1', 'peer-2', 'peer-3', 'peer-4']) {
        await repository.createUser({
          id: userId,
          username: userId,
          email: `${userId}@example.test`,
          passwordHash: await buildPasswordHash('password'),
          role: 'user',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        })
      }
      await repository.createSystemPack({
        id: 'system-1',
        name: 'Library Pack',
        description: '',
        questionCount: 2,
        workspacePath: workspaceDir,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
      await repository.createPack({
        id: 'library-pack',
        userId: 'viewer',
        name: 'Library Pack',
        workspacePath: workspaceDir,
        questionCount: 2,
        revision: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
      await repository.createPack({
        id: 'private-pack',
        userId: 'viewer',
        name: 'Private Pack',
        workspacePath: privateWorkspaceDir,
        questionCount: 2,
        revision: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
      await repository.recordAnswerAnalytics([
        { systemPackId: 'system-1', questionId: '101', userId: 'peer-1', selectedChoice: 'B', correctChoice: 'B', answeredAt: '2026-01-01T00:00:00.000Z' },
        { systemPackId: 'system-1', questionId: '101', userId: 'peer-2', selectedChoice: 'B', correctChoice: 'B', answeredAt: '2026-01-01T00:00:00.000Z' },
        { systemPackId: 'system-1', questionId: '101', userId: 'peer-3', selectedChoice: 'A', correctChoice: 'B', answeredAt: '2026-01-01T00:00:00.000Z' },
        { systemPackId: 'system-1', questionId: '101', userId: 'viewer', selectedChoice: 'C', correctChoice: 'B', answeredAt: '2026-01-01T00:00:00.000Z' },
        { systemPackId: 'system-1', questionId: '102', userId: 'peer-4', selectedChoice: 'A', correctChoice: 'A', answeredAt: '2026-01-01T00:00:00.000Z' }
      ])
      ;(repository as any).db.close()

      const { createApp } = await import('./app')
      const { createSessionToken } = await import('./auth')
      const { SESSION_COOKIE_NAME } = await import('./config')
      const createdApp = await createApp()
      const bound = await listen(createdApp.app)
      server = bound.server
      const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken('viewer')}`

      const response = await fetch(`${bound.origin}/api/study-packs/library-pack/question-stats?ids=101,102,999`, {
        headers: { cookie }
      })
      expect(response.status).toBe(200)
      const body: any = await response.json()
      expect(body.stats['101']).toMatchObject({
        eligible: true,
        peerCount: 3,
        correctChoice: 'B',
        correctPercent: 67,
        choices: {
          A: { count: 1, percent: 33 },
          B: { count: 2, percent: 67 },
          C: { count: 0, percent: 0 }
        }
      })
      expect(body.stats['102']).toMatchObject({
        eligible: true,
        peerCount: 1,
        correctPercent: null,
        choices: {
          A: { count: null, percent: null }
        }
      })
      expect(body.stats['999']).toMatchObject({
        eligible: false,
        peerCount: 0,
        choices: {}
      })

      const privateResponse = await fetch(`${bound.origin}/api/study-packs/private-pack/question-stats?ids=101`, {
        headers: { cookie }
      })
      expect(privateResponse.status).toBe(200)
      const privateBody: any = await privateResponse.json()
      expect(privateBody.stats['101']).toMatchObject({
        eligible: false,
        peerCount: 0,
        correctPercent: null
      })

      const missingResponse = await fetch(`${bound.origin}/api/study-packs/missing-pack/question-stats?ids=101`, {
        headers: { cookie }
      })
      expect(missingResponse.status).toBe(404)
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
