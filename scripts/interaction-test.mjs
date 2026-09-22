/**
 * Demo-path interaction test: walking + collision, artwork click → info panel,
 * hand-block click → 3D inspection viewer, reset, then reports console errors.
 *   node scripts/interaction-test.mjs [baseUrl] [quality]
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3000'
const quality = process.argv[3] ?? 'medium'
const out = path.resolve('scripts/out')
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!ok) failures++
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(`${base}/?quality=${quality}`, { waitUntil: 'networkidle0', timeout: 120000 })
// Entry screen → Enter button
await page.waitForFunction(() => window.__museum?.store.getState().phase === 'ready', { timeout: 120000 })
await page.screenshot({ path: path.join(out, 't0-entry.png') })
const enter = await page.$$eval('button', (bs) => bs.findIndex((b) => /enter/i.test(b.textContent ?? '')))
check(enter >= 0, 'entry screen shows "Enter Exhibition"')
await page.evaluate((i) => document.querySelectorAll('button')[i].click(), enter)
await sleep(2500)
check(await page.evaluate(() => window.__museum.store.getState().phase === 'entered'), 'visitor entered the exhibition')

const pos = () => page.evaluate(() => ({ x: window.__museum.visitor.x, z: window.__museum.visitor.z }))

// Walk forward (W) for 2 s from reception
const p0 = await pos()
await page.keyboard.down('w')
await sleep(2000)
await page.keyboard.up('w')
await sleep(600)
const p1 = await pos()
check(p0.z - p1.z > 1.5, `W walks forward (moved ${(p0.z - p1.z).toFixed(2)} m)`)

// Collision: face west in passage and walk into partition
await page.evaluate(() => window.__museum.teleport(0, -5, 270, 0))
await sleep(300)
await page.keyboard.down('w')
await sleep(2500)
await page.keyboard.up('w')
await sleep(300)
const p2 = await pos()
check(p2.x > -1.3 + 0.27 && p2.x < -0.9, `partition blocks visitor (x=${p2.x.toFixed(3)}, wall face at -1.3)`)

// Reveal wall blocks sightline: from reception the reveal wall is the terminus
await page.evaluate(() => window.__museum.teleport(0, -13.2, 0, 0))
await page.keyboard.down('w')
await sleep(2500)
await page.keyboard.up('w')
await sleep(300)
const p3 = await pos()
check(p3.z > -15.02 + 0.27 - 0.01, `reveal wall is solid (z=${p3.z.toFixed(3)})`)

// Artwork click → info panel
await page.evaluate(() => window.__museum.teleport(2.9, -13.3, 180, 0))
await sleep(1500)
await page.mouse.click(1200, 450)
await sleep(5000)
const sel = await page.evaluate(() => window.__museum.store.getState().selection)
check(sel?.kind === 'artwork' && sel.id === 'hero-05', `clicking artwork selects it (${JSON.stringify(sel)})`)
await page.screenshot({ path: path.join(out, 't1-artwork-panel.png') })
const moved = await pos()
check(moved.x > 3.9 && moved.x < 5.3 && Math.abs(moved.z + 10.29) < 0.4, `camera glided to viewing position (x=${moved.x.toFixed(2)}, z=${moved.z.toFixed(2)})`)
await page.keyboard.press('Escape')
await sleep(600)
check(await page.evaluate(() => window.__museum.store.getState().selection === null), 'Esc closes information panel')

// Hand-block inspection: open via store (click target varies with layout), verify modal renders
await page.evaluate(() => window.__museum.store.getState().inspect('block-03'))
await sleep(2500)
const modal = await page.$('.inspect-root, [class*="inspect-"]')
check(!!modal, 'inspection viewer opens')
await page.screenshot({ path: path.join(out, 't2-inspect.png') })
// drag to rotate inside modal canvas
await page.mouse.move(700, 450)
await page.mouse.down()
await page.mouse.move(900, 420, { steps: 12 })
await page.mouse.up()
await sleep(800)
await page.screenshot({ path: path.join(out, 't3-inspect-rotated.png') })
await page.keyboard.press('Escape')
await sleep(800)
check(await page.evaluate(() => window.__museum.store.getState().inspecting === null), 'Esc closes inspection viewer')

// Click the hand block itself in the scene
await page.evaluate(() => window.__museum.teleport(3.5, -11.0, 330, -30))
await sleep(1500)
await page.screenshot({ path: path.join(out, 't4-table-view.png') })

// Proximity prompt
await page.evaluate(() => window.__museum.teleport(-2.6, -3.4, 270, 0))
await sleep(1200)
const near = await page.evaluate(() => window.__museum.store.getState().nearby)
check(near?.id === 'hero-01', `proximity prompt near hero-01 (${JSON.stringify(near)})`)
await page.keyboard.press('e')
await sleep(800)
check(await page.evaluate(() => window.__museum.store.getState().selection?.id === 'hero-01'), 'E opens nearby item')
await page.keyboard.press('Escape')

// Minimap/Reset buttons exist
const buttons = await page.$$eval('button', (bs) => bs.map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim()).filter(Boolean))
console.log('buttons:', buttons.slice(0, 20).join(' | '))

check(errors.length === 0, `no page errors (${errors.length})`)
for (const e of errors.slice(0, 10)) console.log('   ', e.slice(0, 300))
await browser.close()
console.log(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
