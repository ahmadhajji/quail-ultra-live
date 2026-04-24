// One-shot screenshot script for the exam top bar round-2 refinements.
// Spins up an in-memory-like flow: starts the server, registers a user,
// uploads a stub pack via the JSON API, starts a block, and snapshots the
// exam view. Artifacts land in .snapshots/topbar-r2/.

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const OUT = join(process.cwd(), '.snapshots', 'topbar-r2')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

try {
  await page.goto(`${BASE}/`)
  await page.screenshot({ path: join(OUT, 'home.png'), fullPage: false })
  console.log('saved home.png')
} catch (error) {
  console.error('screenshot failed:', error)
} finally {
  await browser.close()
}
