import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./frontend/src/test/setup.ts'],
    include: ['frontend/src/**/*.test.ts', 'frontend/src/**/*.test.tsx']
  }
})
