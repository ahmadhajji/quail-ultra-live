/* Capture home + exam-chrome screenshots in light and dark mode.
 * Not run by CI — invoked manually via `node tests/capture-theme.mjs`. */
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100'
const OUT = '.snapshots/theme-pass'

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  console.log(`captured ${name}`)
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t)
    try { window.localStorage.setItem('quail-theme', t) } catch {}
  }, theme)
  await page.waitForTimeout(200)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  // Home (unauthenticated, light)
  await page.goto(BASE + '/')
  await page.waitForLoadState('networkidle')
  await setTheme(page, 'light')
  await shoot(page, 'home-light')
  await setTheme(page, 'dark')
  await shoot(page, 'home-dark')

  // Library
  await page.goto(BASE + '/library')
  await page.waitForLoadState('networkidle')
  await setTheme(page, 'light')
  await shoot(page, 'library-light')
  await setTheme(page, 'dark')
  await shoot(page, 'library-dark')

  await browser.close()
  console.log('done')
}

main().catch((err) => { console.error(err); process.exit(1) })
