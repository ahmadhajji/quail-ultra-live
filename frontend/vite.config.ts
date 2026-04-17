import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const frontendRoot = path.resolve(__dirname)
const repoRoot = path.resolve(frontendRoot, '..')

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  publicDir: path.resolve(frontendRoot, 'public'),
  build: {
    outDir: path.resolve(repoRoot, 'dist'),
    emptyOutDir: true
  },
  test: {
    environment: 'jsdom',
    setupFiles: path.resolve(frontendRoot, 'src/test/setup.ts')
  }
})
