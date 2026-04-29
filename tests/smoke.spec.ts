import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

test('health endpoint responds', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.ok()).toBeTruthy()
  await expect(response.json()).resolves.toMatchObject({
    ok: true
  })
})

test('home page renders auth and pack UI', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Quail Ultra Live')).toBeVisible()
  await expect(page.getByText('Account Access')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
  await expect(page.getByText(/Account creation is|invite-only|registration/i)).toBeVisible()
})

test('legacy html routes redirect to clean SPA routes', async ({ page }) => {
  const response = await page.goto('/overview.html?pack=pack-1')
  expect(response?.status()).toBeGreaterThanOrEqual(200)
  await page.waitForURL('**/overview?pack=pack-1')
  expect(page.url()).toContain('/overview?pack=pack-1')
})

test('authenticated import-to-exam progress flow', async ({ page }) => {
  const userId = `e2e-${Date.now()}`
  const packId = `${userId}-pack`
  const dataDir = process.env.QUAIL_DATA_DIR || path.resolve('output/playwright-data')
  const workspaceDir = path.join(dataDir, 'study-packs', packId, 'workspace')
  await fs.rm(workspaceDir, { recursive: true, force: true })
  await fs.mkdir(path.dirname(workspaceDir), { recursive: true })
  await fs.cp(path.resolve('contracts/quail-ultra-qbank/v1/fixtures/legacy-pack-minimal'), workspaceDir, { recursive: true })

  const { createRepository, buildPasswordHash } = await import('../build/server/repository.js')
  const repository = createRepository()
  await repository.init()
  await repository.createUser({
    id: userId,
    username: userId,
    email: `${userId}@example.test`,
    passwordHash: await buildPasswordHash('password123'),
    role: 'user',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
  await repository.createPack({
    id: packId,
    userId,
    name: 'E2E Legacy Pack',
    workspacePath: workspaceDir,
    questionCount: 1,
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
  ;(repository as any).db?.close?.()

  const loginResponse = await page.request.post('/api/auth/login', {
    data: { username: userId, password: 'password123' }
  })
  expect(loginResponse.ok()).toBeTruthy()

  const startResponse = await page.request.post(`/api/study-packs/${packId}/blocks/start`, {
    data: {
      blockqlist: ['001'],
      preferences: { mode: 'tutor', timeperq: '', qpoolstr: 'all', tagschosenstr: '', allsubtagsenabled: true }
    }
  })
  expect(startResponse.ok()).toBeTruthy()
  const started = await startResponse.json()

  await page.goto(`/examview?pack=${packId}&block=${started.blockKey}`)
  await expect(page.getByText(/Question|diagnosis|stem/i).first()).toBeVisible()
  await page.locator('.exam-choice-selector').first().click()
  await expect(page.getByRole('button', { name: 'Submit Answer' })).toBeEnabled()
  await page.getByRole('button', { name: 'Submit Answer' }).click()
  await expect(page.getByRole('button', { name: 'Answer Submitted' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Answer Submitted' })).toBeVisible()

  const qbankResponse = await page.request.get(`/api/study-packs/${packId}/qbankinfo?block=${started.blockKey}`)
  expect(qbankResponse.ok()).toBeTruthy()
  const qbank = await qbankResponse.json()
  expect(qbank.qbankinfo.progress.blockhist[started.blockKey].questionStates[0].submitted).toBe(true)
})
