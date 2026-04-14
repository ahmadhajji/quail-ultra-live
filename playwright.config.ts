import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const useExternalServer = Boolean(process.env.E2E_BASE_URL)

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: 'npm run start:server',
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          PORT: '3000',
          SESSION_SECRET: 'ci-session-secret',
          ALLOW_REGISTRATION: 'true'
        }
      }
})
