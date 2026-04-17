import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentMatchGlobs: [
      ['shared/**/*.test.ts', 'node'],
      ['server/**/*.test.ts', 'node'],
      ['tests/unit/**/*.test.ts', 'node']
    ],
    setupFiles: ['./frontend/src/test/setup.ts'],
    include: [
      'frontend/src/**/*.test.ts',
      'frontend/src/**/*.test.tsx',
      'shared/**/*.test.ts',
      'server/**/*.test.ts',
      'tests/unit/**/*.test.ts'
    ]
  }
})
