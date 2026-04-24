import { test, expect } from '@playwright/test'

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
