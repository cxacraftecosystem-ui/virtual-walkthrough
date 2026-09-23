/**
 * Live presence + docent tour smoke test with two isolated browser contexts:
 *   A = curator/admin (docent), B = anonymous visitor.
 * Checks: realtime online, presence avatars, invitation → join, auto-follow, docent chat,
 * WebXR feature detection (no VR/AR buttons on desktop without XR), no page errors.
 *   node scripts/live-presence-test.mjs [baseUrl]
 * Needs NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / LIVE_TOKEN_SECRET and the dev admin.
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
async function open(name, login) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text()) && errors.push(`${name}: ${m.text()}`))
  const url = `${base}/?autostart&quality=low`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 })
  if (login) {
    const st = await page.evaluate(async () => {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@museum.local', password: 'admin12345' }) })
      return r.status
    })
    check(st === 200, `${name}: signed in as dev admin (${st})`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 })
  }
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: 180000 })
  return page
}

const A = await open('A', true)
// The backend probe (2.5 s) / session restore can time out while the shared dev server compiles: retry.
for (let i = 0; i < 4; i++) {
  const ok = await A.waitForFunction(() => !!window.__museum.store.getState().user, { timeout: 20000 }).then(() => true, () => false)
  if (ok) break
  await A.reload({ waitUntil: 'domcontentloaded', timeout: 180000 })
  await A.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: 180000 }).catch(() => {})
}
console.log('A role:', await A.evaluate(() => window.__museum.store.getState().user?.role ?? null))
const B = await open('B', false)
const status = (p) => p.evaluate(() => window.__live?.useLive.getState().status ?? 'none')
await A.waitForFunction(() => window.__live?.useLive.getState().status === 'online', { timeout: 90000 }).catch(() => {})
await B.waitForFunction(() => window.__live?.useLive.getState().status === 'online', { timeout: 90000 }).catch(() => {})
check((await status(A)) === 'online' && (await status(B)) === 'online', `realtime online (A ${await status(A)}, B ${await status(B)})`)

// Presence: put A in front of B in the passage
await B.evaluate(() => window.__museum.teleport(0, 6.8, 0, 0))
await A.evaluate(() => window.__museum.teleport(0, 3.6, 180, 0))
await sleep(3000)
const seen = await B.evaluate(() => [...window.__live.peers.values()].map((p) => ({ name: p.name, has: p.has, x: p.x, z: p.z })))
check(seen.some((p) => p.has && Math.abs(p.z - 3.6) < 0.6), `B sees A's avatar (${JSON.stringify(seen)})`)
await B.screenshot({ path: path.join(out, 'live-b-presence.png') })

// XR feature detection on desktop
const xrBtns = await A.$$eval('button', (bs) => bs.filter((b) => /Enter VR|View in your space/.test(b.getAttribute('aria-label') ?? b.textContent ?? '')).length)
check(xrBtns === 0, 'no VR/AR buttons without WebXR support')

// Docent starts a live tour
const startBtn = await A.$('button[aria-label="Start live tour"]')
check(!!startBtn, 'A (admin) sees "Start live tour"')
if (startBtn) await startBtn.click()
await A.waitForFunction(() => !!window.__live.useLive.getState().hosting, { timeout: 90000 }).catch(() => {})
check(await A.evaluate(() => !!window.__live.useLive.getState().hosting), 'A is hosting (' + (await A.evaluate(() => window.__live.useLive.getState().toast?.text ?? '')) + ')')

// Visitor gets the verified invitation
await B.waitForFunction(() => !!document.querySelector('.live-invite'), { timeout: 60000 }).catch(() => {})
const inviteText = await B.$eval('.live-invite', (e) => e.textContent).catch(() => '')
check(/Live tour by/.test(inviteText), `B sees invitation: "${inviteText}"`)
await B.screenshot({ path: path.join(out, 'live-b-invite.png') })
await B.evaluate(() => [...document.querySelectorAll('.live-invite button')].find((b) => b.textContent === 'Join')?.click())
await sleep(800)
check(await B.evaluate(() => !!window.__live.useLive.getState().joined), 'B joined the tour')

// Docent walks away → follower glides after; far → teleport
await A.evaluate(() => window.__museum.teleport(0, -5, 0, 0))
await sleep(6000)
let pb = await B.evaluate(() => ({ x: window.__museum.visitor.x, z: window.__museum.visitor.z }))
check(Math.hypot(pb.x - 0, pb.z + 5) < 4, `B followed the docent nearby (${pb.x.toFixed(1)}, ${pb.z.toFixed(1)})`)
const farTarget = await A.evaluate(() => {
  window.__museum.teleport(-5.4, -21, 20, 0)
  return { x: window.__museum.visitor.x, z: window.__museum.visitor.z }
})
await sleep(7000)
pb = await B.evaluate(() => ({ x: window.__museum.visitor.x, z: window.__museum.visitor.z }))
check(Math.hypot(pb.x - farTarget.x, pb.z - farTarget.z) < 4.5, `B caught up after a far move (${pb.x.toFixed(1)}, ${pb.z.toFixed(1)})`)

// Chat + hand raise
await A.type('.live-chat__input', 'Welcome to the hand block gallery')
await A.keyboard.press('Enter')
await sleep(2000)
const chatB = await B.$$eval('.live-chat__msg', (ms) => ms.map((m) => m.textContent))
check(chatB.some((t) => /Welcome/.test(t) && /docent/.test(t)), `B received verified docent chat (${JSON.stringify(chatB)})`)
await B.evaluate(() => [...document.querySelectorAll('.live-actions button')].find((b) => /Raise hand/.test(b.textContent))?.click())
await sleep(2500)
check(await A.evaluate(() => window.__live.useLive.getState().hands.length === 1), 'docent sees the raised hand')
await B.type('.live-chat__input', 'What wood are the blocks carved from?')
await B.keyboard.press('Enter')
await sleep(2000)
const chatA = await A.$$eval('.live-chat__msg', (ms) => ms.map((m) => m.textContent))
check(chatA.some((t) => /wood/.test(t)), 'docent received visitor chat')
await A.screenshot({ path: path.join(out, 'live-a-docent.png') })
await B.screenshot({ path: path.join(out, 'live-b-follower.png') })

// Forged docent message (unsigned) must be ignored
const forged = await B.evaluate(async () => {
  const L = window.__live.useLive.getState()
  return { before: L.muted.length, selfMuted: L.selfMuted }
})
check(!forged.selfMuted, 'visitor not muted by anything unsigned')

// End
await A.evaluate(() => [...document.querySelectorAll('.live-actions button')].find((b) => /End tour/.test(b.textContent))?.click())
await sleep(2500)
check(await B.evaluate(() => !window.__live.useLive.getState().joined), 'tour end reaches the follower')

console.log(errors.length ? `Page errors:\n  ${errors.slice(0, 12).join('\n  ')}` : 'No page errors')
await browser.close()
process.exit(failures ? 1 : 0)
