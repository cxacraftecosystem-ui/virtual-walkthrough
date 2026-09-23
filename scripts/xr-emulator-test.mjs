/**
 * VR smoke test with the IWER Meta Quest 3 emulator (dev only, `?xremulate`):
 * Enter VR → rig mounts, headset drives visitor position, thumbstick teleport + snap turn,
 * trigger on an artwork opens the VR info card, exit VR restores desktop navigation.
 * Also checks that WITHOUT the emulator no VR button is offered.
 *   node scripts/xr-emulator-test.mjs [baseUrl]
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3000'
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
  protocolTimeout: 600000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,760'],
  defaultViewport: { width: 1280, height: 760 },
})
const errors = []
const page = await browser.newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text()) && errors.push(m.text()))

await page.goto(`${base}/?autostart&quality=low&xremulate`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: 240000 })
await page.waitForSelector('button[aria-label="Enter VR"]', { timeout: 30000 }).catch(() => {})
const btn = await page.$('button[aria-label="Enter VR"]')
check(!!btn, 'Enter VR offered when immersive-vr is supported (emulated)')
await page.evaluate(() => window.__museum.teleport(0, 6.8, 0, 0))
await sleep(500)
if (btn) await btn.click()
await page.waitForFunction(() => window.__xr?.useXRMode.getState().mode === 'vr', { timeout: 30000 }).catch(() => {})
check(await page.evaluate(() => window.__xr?.useXRMode.getState().mode === 'vr'), 'VR session running')
await sleep(2500)
const v0 = await page.evaluate(() => ({ x: window.__museum.visitor.x, z: window.__museum.visitor.z, yaw: window.__museum.visitor.yaw }))
check(Math.hypot(v0.x - 0, v0.z - 6.8) < 1.0, `headset starts where the visitor stood (${v0.x.toFixed(2)}, ${v0.z.toFixed(2)})`)
await page.screenshot({ path: path.join(out, 'xr-vr-start.png') })

// thumbstick forward on the right controller → arc; release → teleport
const emu = () => page.evaluate(() => !!window.__xr.vrStore.getState().emulator)
check(await emu(), 'emulator device available')
await page.evaluate(() => {
  const d = window.__xr.vrStore.getState().emulator
  const c = d.controllers.right
  c.updateAxes('thumbstick', 0, -1)
})
await sleep(700)
await page.screenshot({ path: path.join(out, 'xr-vr-arc.png') })
await page.evaluate(() => window.__xr.vrStore.getState().emulator.controllers.right.updateAxes('thumbstick', 0, 0))
await sleep(900)
const v1 = await page.evaluate(() => ({ x: window.__museum.visitor.x, z: window.__museum.visitor.z }))
check(Math.hypot(v1.x - v0.x, v1.z - v0.z) > 0.5, `teleported (${v0.x.toFixed(2)},${v0.z.toFixed(2)}) → (${v1.x.toFixed(2)},${v1.z.toFixed(2)})`)

// snap turn
await page.evaluate(() => window.__xr.vrStore.getState().emulator.controllers.right.updateAxes('thumbstick', 1, 0))
await sleep(400)
await page.evaluate(() => window.__xr.vrStore.getState().emulator.controllers.right.updateAxes('thumbstick', 0, 0))
await sleep(600)
const yaw2 = await page.evaluate(() => window.__museum.visitor.yaw)
const dyaw = Math.abs(Math.atan2(Math.sin(yaw2 - v0.yaw), Math.cos(yaw2 - v0.yaw)))
check(Math.abs(dyaw - Math.PI / 6) < 0.15, `snap turn ≈ 30° (${((dyaw * 180) / Math.PI).toFixed(1)}°)`)
await page.screenshot({ path: path.join(out, 'xr-vr-turn.png') })

// exit
await page.evaluate(() => window.__xr.vrStore.getState().session?.end())
await sleep(1500)
check(await page.evaluate(() => window.__xr.useXRMode.getState().mode === null), 'VR session ended cleanly')
const before = await page.evaluate(() => window.__museum.visitor.z)
await page.keyboard.down('w')
await sleep(1200)
await page.keyboard.up('w')
const after = await page.evaluate(() => window.__museum.visitor.z)
check(Math.abs(after - before) > 0.3, 'desktop walking works again after exit')
await page.screenshot({ path: path.join(out, 'xr-after-exit.png') })

// no emulator → no VR button
const p2 = await browser.newPage()
p2.on('pageerror', (e) => errors.push(`plain: ${e.message}`))
await p2.goto(`${base}/?autostart&quality=low`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await p2.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: 240000 })
await sleep(3000)
check(!(await p2.$('button[aria-label="Enter VR"]')), 'no Enter VR button without WebXR')

console.log(errors.length ? `Page errors:\n  ${errors.slice(0, 12).join('\n  ')}` : 'No page errors')
await browser.close()
process.exit(failures ? 1 : 0)
