import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const frontendRoot = path.resolve(__dirname)
const repoRoot = path.resolve(frontendRoot, '..')

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: path.resolve(repoRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(frontendRoot, 'index.html'),
        admin: path.resolve(frontendRoot, 'admin.html'),
        overview: path.resolve(frontendRoot, 'overview.html'),
        newblock: path.resolve(frontendRoot, 'newblock.html'),
        previousblocks: path.resolve(frontendRoot, 'previousblocks.html'),
        examview: path.resolve(frontendRoot, 'examview.html')
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: path.resolve(frontendRoot, 'src/test/setup.ts')
  }
})
