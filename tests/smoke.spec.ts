import { test, expect } from '@playwright/test'

test('home page loads', async ({ page }) => {
  test.skip(!process.env.E2E_BASE_URL, 'Set E2E_BASE_URL to run the live smoke test.')
  await page.goto('/')
  await expect(page.getByText('Quail Ultra Live')).toBeVisible()
})
