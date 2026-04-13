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
  await expect(page.getByText('Account-backed Study Packs')).toBeVisible()
  await expect(page.getByText('Account Access')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
  await expect(page.getByText(/invite-only|registration/i)).toBeVisible()
})
