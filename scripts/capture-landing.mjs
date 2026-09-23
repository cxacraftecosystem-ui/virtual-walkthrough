/**
 * LANDING-PAGE IMAGERY — captures every picture the landing page (/) uses, straight from
 * the running museum, so the page always shows the real thing.
 *
 *   node scripts/capture-landing.mjs [baseUrl] [quality]          (all shots + hero film)
 *        baseUrl default https://hand-block-museum.vercel.app  ·  quality default high
 *   ONLY=hero,f-tour node scripts/capture-landing.mjs              (just these names)
 *   SKIP_VIDEO=1 node scripts/capture-landing.mjs                  (stills only)
 *   CHROME=<path to chrome.exe>                                     (default: Chrome stable)
 *
 * Writes public/brand/landing/:
 *   hero.jpg · hero.webm           full-bleed hero poster + a short muted glide (≤ 6 MB)
 *   <space>.jpg                    "Explore the spaces" cards (canvas only, UI hidden)
 *   f-<feature>.jpg                "The experience" tiles (feature staged, its UI visible)
 *
 * Each shot is independent: a feature that isn't built yet (or fails to stage) is logged
 * and skipped, and the landing page shows a neutral placeholder for any missing image.
 * Re-run any time to refresh everything.
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const base = (process.argv[2] ?? 'https://hand-block-museum.vercel.app').replace(/\/+$/, '')
const quality = process.argv[3] ?? 'high'
const only = (process.env.ONLY ?? '').split(',').filter(Boolean)
const want = (name) => only.length === 0 || only.includes(name)
const out = path.resolve('public/brand/landing')
fs.mkdirSync(out, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  protocolTimeout: 600_000,
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.warn('  [page error]', String(e).slice(0, 160)))
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
// English UI, full motion, no analytics.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('museum.lang', 'en')
    localStorage.removeItem('museum.a11y')
  } catch {}
})
console.log('loading museum…')
await page.goto(`${base}/gallery?autostart&quality=${quality}&noanalytics&nolive&lang=en`, { waitUntil: 'domcontentloaded', timeout: 300_000 })
await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: 300_000, polling: 500 })
await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
await sleep(5000)

/* ------------------------------------------------------------------ helpers */

const HIDE_UI_CSS =
  'nextjs-portal { display: none !important; } #root > *:not(.museum-canvas), body > *:not(#root) { visibility: hidden !important; } .museum-canvas, .museum-canvas * { visibility: visible !important; }'
let uiHidden = false
async function applyUi() {
  await page.evaluate(
    (hide, css) => {
      let el = document.getElementById('capture-hide-ui')
      if (hide && !el) {
        el = document.createElement('style')
        el.id = 'capture-hide-ui'
        el.textContent = css
        document.head.appendChild(el)
      } else if (!hide && el) el.remove()
    },
    uiHidden,
    HIDE_UI_CSS,
  )
}
async function ui(visible) {
  uiHidden = !visible
  await applyUi()
}

/** If the page reloaded (e.g. a redeploy / dev HMR), wait until the museum is back. */
async function ensureMuseum() {
  const ok = await page.evaluate(() => window.__museum?.store.getState().phase === 'entered').catch(() => false)
  if (ok) return
  console.log('  (museum reloaded — waiting for it to re-enter)')
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: 300_000, polling: 500 })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await sleep(5000)
}

/** Put the museum back to a neutral state between shots. */
async function reset() {
  await ensureMuseum()
  await page.evaluate(() => {
    const m = window.__museum.store.getState()
    window.__tour?.tour.exit()
    window.__photo?.exitPhotoMode?.()
    m.select(null)
    m.inspect(null)
    m.setHelpOpen(false)
    m.setDrawer?.(null)
    m.setHovered?.(null)
    m.setNearby?.(null)
    if (window.innerWidth <= 900) m.setMapOpen(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await page.mouse.move(2, 2)
  await sleep(700)
}

async function tod(t) {
  await page.evaluate((x) => window.__museum.store.getState().setTimeOfDay(x), t)
}
async function go(x, z, yaw, pitch = 0) {
  await page.evaluate((a) => window.__museum.teleport(a[0], a[1], a[2], a[3]), [x, z, yaw, pitch])
}
/** Stand at a guided-tour stop's viewpoint (keeps shots in sync with the tour config). */
async function goStop(id, fallback) {
  const v = await page.evaluate((sid) => window.__tour?.stops.find((s) => s.id === sid)?.view ?? null, id)
  const p = v ?? fallback
  if (!p) throw new Error(`no tour stop "${id}"`)
  await go(p.x, p.z, p.yawDeg, p.pitchDeg ?? 0)
}
async function view(w, h, dpr = 1) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr })
}
async function snap(name, q = 84) {
  await ensureMuseum()
  await applyUi()
  const broken = await page.evaluate(() => [...document.querySelectorAll('nextjs-portal')].some((p) => /Build Error|Runtime Error|Unhandled/i.test(p.shadowRoot?.textContent ?? '')))
  if (broken) throw new Error('Next.js error overlay is showing (dev build broken) — not saving')
  const file = path.join(out, `${name}.jpg`)
  // A flat frame (canvas not drawn yet, e.g. right after a resize) compresses to almost nothing.
  const vp = page.viewport()
  const minBytes = Math.round(vp.width * vp.height * (vp.deviceScaleFactor ?? 1) ** 2 * 0.014)
  for (let attempt = 1; ; attempt++) {
    const buf = await page.screenshot({ type: 'jpeg', quality: q })
    if (buf.length >= minBytes || attempt >= 5) {
      if (buf.length < minBytes) throw new Error(`frame still looks blank after ${attempt} tries (${buf.length} bytes) — not saving`)
      fs.writeFileSync(file, buf)
      break
    }
    await sleep(3000)
  }
  console.log('  saved', path.relative(process.cwd(), file), `${Math.round(fs.statSync(file).size / 1024)} KB`)
}
async function click(selector, textIncludes) {
  const ok = await page.evaluate(
    (sel, txt) => {
      const el = [...document.querySelectorAll(sel)].find((e) => !txt || (e.textContent ?? '').includes(txt))
      if (!el) return false
      el.click()
      return true
    },
    selector,
    textIncludes ?? null,
  )
  if (!ok) throw new Error(`nothing to click: ${selector}${textIncludes ? ` "${textIncludes}"` : ''}`)
}
async function waitFor(fn, arg, ms = 20000) {
  await page.waitForFunction(fn, { timeout: ms, polling: 200 }, arg)
}

const failures = []
async function shot(name, fn) {
  if (!want(name)) return
  console.log(name)
  try {
    await reset()
    await fn()
  } catch (e) {
    failures.push(name)
    console.warn(`  SKIPPED ${name}: ${String(e?.message ?? e).split('\n')[0]}`)
  }
}

/* ------------------------------------------------------------------ hero */

// The hero frame: the Craft Court — carved-block vitrine against the madder wall, under the
// glass lantern. (HERO_CANDIDATES=1 also writes alternates to scripts/out/ for art direction.)
const HERO = { x: -5.4, z: -19.6, yaw: 25, pitch: 4, tod: 'golden' }
const HERO_ALTS = [
  ['hero-alt-atrium', 0, 19.4, 0, 6, 'golden'],
  ['hero-alt-gallery-d', -11.4, -16.2, 270, 2, 'golden'],
  ['hero-alt-gallery', 3.85, -17.2, 180, 1, 'golden'],
  ['hero-alt-court-mid', -5.4, -19.6, 25, 4, 'midday'],
]
await shot('hero', async () => {
  await ui(false)
  await view(1920, 1080, 1.334)
  await tod(HERO.tod)
  await go(HERO.x, HERO.z, HERO.yaw, HERO.pitch)
  await sleep(4500)
  await snap('hero', 82)
  if (process.env.HERO_CANDIDATES) {
    for (const [name, x, z, yaw, pitch, t] of HERO_ALTS) {
      await tod(t)
      await go(x, z, yaw, pitch)
      await sleep(3500)
      const file = path.resolve('scripts/out', name + '.jpg')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      await page.screenshot({ path: file, type: 'jpeg', quality: 80 })
      console.log('  candidate', file)
    }
  }
})

/* ------------------------------------------------------------------ spaces (canvas only) */

// name, view (explicit, or a guided-tour stop id — those follow the layout config), time of day
const SPACES = [
  ['atrium', 'atrium', 'midday'],
  ['passage', { x: 0, z: -1.5, yawDeg: 0, pitchDeg: 4 }, 'midday'],
  ['gallery', { x: 3.85, z: -17.2, yawDeg: 180, pitchDeg: 1 }, 'midday'],
  ['court', { x: -5.4, z: -19.6, yawDeg: 25, pitchDeg: 4 }, 'midday'],
  ['gallery-d', { x: -11.4, z: -16.2, yawDeg: 270, pitchDeg: 2 }, 'midday'],
  ['theatre', 'theatre', 'midday'],
  ['workshop', 'workshop', 'midday'],
  ['courtyard', 'courtyard', 'golden'],
]
for (const [name, v, t] of SPACES) {
  await shot(name, async () => {
    await ui(false)
    await view(1280, 800)
    await tod(t)
    if (typeof v === 'string') await goStop(v)
    else await go(v.x, v.z, v.yawDeg, v.pitchDeg)
    await sleep(name === 'theatre' ? 8000 : 3500)
    await snap(name)
  })
}

/* ------------------------------------------------------------------ features (UI visible) */

const FEATURE_W = 1440
const FEATURE_H = 900

await shot('f-walk', async () => {
  await ui(true)
  await view(FEATURE_W, FEATURE_H)
  await page.evaluate(() => window.__museum.store.getState().setMapOpen(true))
  await tod('midday')
  await goStop('salon', { x: -4.5, z: -4.5, yawDeg: 90, pitchDeg: 3 })
  await sleep(3500)
  await snap('f-walk')
})

await shot('f-tour', async () => {
  await ui(true)
  await view(FEATURE_W, FEATURE_H)
  await tod('midday')
  const idx = await page.evaluate(() => Math.max(0, window.__tour.stops.findIndex((s) => s.id === 'hero-02')))
  await goStop('hero-02')
  await page.evaluate((i) => window.__tour.tour.start(i), idx)
  await waitFor(() => window.__tour.useTour.getState().phase === 'viewing', null, 30000)
  await sleep(2600)
  await snap('f-tour')
})

await shot('f-info', async () => {
  await ui(true)
  await view(FEATURE_W, FEATURE_H)
  await tod('midday')
  await goStop('hero-01')
  await sleep(1500)
  await page.evaluate(() => window.__museum.store.getState().select({ kind: 'artwork', id: 'hero-01' }))
  await sleep(2200)
  await snap('f-info')
})

await shot('f-examine', async () => {
  await ui(true)
  await view(FEATURE_W, FEATURE_H)
  await goStop('hero-01')
  await page.evaluate(() => window.__museum.store.getState().select({ kind: 'artwork', id: 'hero-01' }))
  await sleep(1400)
  await click('.ui-info__foot .ui-btn', 'Examine')
  await waitFor(() => !!document.querySelector('.dz-stage canvas, .dz-stage img'), null, 20000)
  await sleep(2500)
  // zoom into the weave
  await page.mouse.move(FEATURE_W * 0.52, FEATURE_H * 0.5)
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel({ deltaY: -240 })
    await sleep(160)
  }
  await sleep(3200)
  await snap('f-examine')
})

await shot('f-studio', async () => {
  await ui(true)
  await view(FEATURE_W, FEATURE_H)
  await goStop('workshop')
  await page.evaluate(() => window.__museum.store.getState().select({ kind: 'object', id: 'print-studio' }))
  await waitFor(() => !!document.querySelector('.ps-root .ps-cloth-overlay'), null, 15000)
  await sleep(1400)
  // stamp a small repeat onto the cloth
  const box = await page.evaluate(() => {
    const r = document.querySelector('.ps-cloth-overlay').getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  const pick = async (sel, i) => page.evaluate((s, n) => document.querySelectorAll(s)[n]?.click(), sel, i)
  const stamp = async (fx, fy) => {
    await page.mouse.move(box.x + box.w * fx, box.y + box.h * fy)
    await page.mouse.down()
    await sleep(260)
    await page.mouse.up()
    await sleep(90)
  }
  const rows = [0.22, 0.5, 0.78]
  const cols = [0.2, 0.4, 0.6, 0.8]
  for (let r = 0; r < rows.length; r++) {
    await pick('.ps-swatch', r === 1 ? 2 : 0)
    for (const c of cols) await stamp(c + (r === 1 ? 0.1 : 0), rows[r])
  }
  await page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.36)
  await sleep(1200)
  await snap('f-studio')
})

await shot('f-golden', async () => {
  await ui(false)
  await view(FEATURE_W, FEATURE_H)
  await tod('golden')
  await go(0, 12.5, 0, 12)
  await sleep(4000)
  await snap('f-golden')
})

await shot('f-night', async () => {
  await ui(false)
  await view(FEATURE_W, FEATURE_H)
  await tod('night')
  await go(20.6, -3.6, 0, 4)
  await sleep(4500)
  await snap('f-night')
})

await shot('f-inspect', async () => {
  await ui(true)
  await view(FEATURE_W, FEATURE_H)
  await tod('midday')
  await goStop('centrepiece')
  await page.evaluate(() => window.__museum.store.getState().inspect('object:centrepiece-court'))
  await waitFor(() => !!document.querySelector('[role="dialog"] canvas') && window.__museum.store.getState().inspecting, null, 20000)
  await sleep(5000)
  await snap('f-inspect')
})

await shot('f-theatre', async () => {
  await ui(false)
  await view(FEATURE_W, FEATURE_H)
  await tod('midday')
  await goStop('theatre')
  // proximity playback: give the film time to start and move past the opening frames
  await sleep(9000)
  console.log('  media:', JSON.stringify(await page.evaluate(() => window.__mediaDebug?.() ?? null)))
  await snap('f-theatre')
})

await shot('f-photo', async () => {
  await ui(true)
  await view(FEATURE_W, FEATURE_H)
  await tod('golden')
  await goStop('atrium-textile')
  await sleep(1500)
  await page.evaluate(() => window.__photo.enterPhotoMode())
  await sleep(2600)
  await snap('f-photo')
})

// Last: switches the UI language.
await shot('f-hindi', async () => {
  await ui(true)
  await view(FEATURE_W, FEATURE_H)
  await tod('midday')
  await goStop('hero-02')
  await click('.ui-lang .ui-icon-btn')
  await sleep(400)
  await click('.ui-lang .ui-quality__opt', 'हिन्दी')
  await sleep(800)
  await page.evaluate(() => window.__museum.store.getState().select({ kind: 'artwork', id: 'hero-02' }))
  await sleep(2400)
  await snap('f-hindi')
  await click('.ui-lang .ui-icon-btn').catch(() => {})
  await sleep(300)
  await click('.ui-lang .ui-quality__opt', 'English').catch(() => {})
})

/* ------------------------------------------------------------------ hero film */

// Frame-by-frame (deterministic, smooth however fast headless Chrome renders): step the
// camera, grab a JPEG, then encode VP9 with WebCodecs in a second tab (same origin) and mux a
// video-only WebM. Muted; loops seamlessly (the eased glide plays forward then back).
const FILM = { w: 1600, h: 900, fps: 30, seconds: 8, bitrate: 2_600_000 }
// a slow push toward the court vitrine, the gaze drifting across the madder wall
const GLIDE = { from: { x: -5.9, z: -18.4, yaw: 20, pitch: 3.5 }, to: { x: -5.1, z: -20.4, yaw: 29, pitch: 4.5 } }

/** Minimal video-only WebM (EBML) muxer for VP9 chunks. */
function muxWebM({ width, height, fps, chunks, durationMs }) {
  const TE = new TextEncoder()
  const cat = (parts) => {
    const res = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) {
      res.set(p, o)
      o += p.length
    }
    return res
  }
  const idB = (id) => {
    const b = []
    for (let v = id; v > 0; v = Math.floor(v / 256)) b.unshift(v & 0xff)
    return new Uint8Array(b)
  }
  const vsize = (n) => {
    for (let len = 1; len <= 8; len++) {
      if (n < 2 ** (7 * len) - 1) {
        const res = new Uint8Array(len)
        let v = n
        for (let i = len - 1; i >= 0; i--) {
          res[i] = v % 256
          v = Math.floor(v / 256)
        }
        res[0] |= 1 << (8 - len)
        return res
      }
    }
    throw new Error('size too large')
  }
  const E = (id, payload) => cat([idB(id), vsize(payload.length), payload])
  const M = (id, children) => E(id, cat(children))
  const U = (id, v, width = 0) => {
    const b = []
    let x = v
    do {
      b.unshift(x % 256)
      x = Math.floor(x / 256)
    } while (x > 0)
    while (b.length < width) b.unshift(0)
    return E(id, new Uint8Array(b))
  }
  const S = (id, s) => E(id, TE.encode(s))
  const F = (id, v) => {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v)
    return E(id, b)
  }
  const header = M(0x1a45dfa3, [U(0x4286, 1), U(0x42f7, 1), U(0x42f2, 4), U(0x42f3, 8), S(0x4282, 'webm'), U(0x4287, 4), U(0x4285, 2)])
  const info = M(0x1549a966, [U(0x2ad7b1, 1_000_000), F(0x4489, durationMs), S(0x4d80, 'capture-landing'), S(0x5741, 'capture-landing')])
  const tracks = M(0x1654ae6b, [
    M(0xae, [U(0xd7, 1), U(0x73c5, 1), U(0x83, 1), S(0x86, 'V_VP9'), U(0x23e383, Math.round(1e9 / fps)), M(0xe0, [U(0xb0, width), U(0xba, height)])]),
  ])
  const clusters = []
  let cur = null
  for (const c of chunks) {
    const ms = Math.round(c.timestamp / 1000)
    if (!cur || (c.key && ms !== cur.ms) || ms - cur.ms > 30000) {
      cur = { ms, parts: [U(0xe7, ms)] }
      clusters.push(cur)
    }
    const hdr = new Uint8Array(4)
    hdr[0] = 0x81
    new DataView(hdr.buffer).setInt16(1, ms - cur.ms)
    hdr[3] = c.key ? 0x80 : 0
    cur.parts.push(E(0xa3, cat([hdr, c.data])))
  }
  const clusterBytes = clusters.map((c) => M(0x1f43b675, c.parts))
  const seek = (id, pos) => M(0x4dbb, [E(0x53ab, idB(id)), U(0x53ac, pos, 8)])
  const seekHeadLen = M(0x114d9b74, [seek(0x1549a966, 0), seek(0x1654ae6b, 0), seek(0x1c53bb6b, 0)]).length
  const infoPos = seekHeadLen
  const tracksPos = infoPos + info.length
  let pos = tracksPos + tracks.length
  const cuePoints = clusterBytes.map((cb, i) => {
    const cp = M(0xbb, [U(0xb3, clusters[i].ms), M(0xb7, [U(0xf7, 1), U(0xf1, pos, 8)])])
    pos += cb.length
    return cp
  })
  const cues = M(0x1c53bb6b, cuePoints)
  const seekHead = M(0x114d9b74, [seek(0x1549a966, infoPos), seek(0x1654ae6b, tracksPos), seek(0x1c53bb6b, pos)])
  return cat([header, M(0x18538067, [seekHead, info, tracks, ...clusterBytes, cues])])
}

if (!process.env.SKIP_VIDEO && want('hero-video')) {
  console.log('hero-video')
  try {
    await reset()
    await ui(false)
    await view(FILM.w, FILM.h, 1)
    await tod(HERO.tod)
    const { from, to } = GLIDE
    await go(from.x, from.z, from.yaw, from.pitch)
    await sleep(4000)
    const n = FILM.fps * FILM.seconds
    const ease = (t) => t * t * (3 - 2 * t)
    const frames = []
    for (let i = 0; i < n; i++) {
      const k = ease(i / (n - 1))
      const lerp = (a, b) => a + (b - a) * k
      await page.evaluate(
        (a) =>
          new Promise((r) => {
            window.__museum.teleport(a[0], a[1], a[2], a[3])
            requestAnimationFrame(() => requestAnimationFrame(() => r()))
          }),
        [lerp(from.x, to.x), lerp(from.z, to.z), lerp(from.yaw, to.yaw), lerp(from.pitch, to.pitch)],
      )
      frames.push(await page.screenshot({ type: 'jpeg', quality: 92, encoding: 'base64' }))
      if (i % 60 === 0) console.log(`  frame ${i}/${n}`)
    }
    // ping-pong so the loop has no jump
    const seq = [...frames, ...frames.slice(1, -1).reverse()]
    const enc = await browser.newPage()
    await enc.goto(`${base}/favicon.svg`)
    await enc.evaluate((f) => {
      window.__chunks = []
      window.__err = null
      window.__enc = new VideoEncoder({
        output: (c) => {
          const d = new Uint8Array(c.byteLength)
          c.copyTo(d)
          window.__chunks.push({ timestamp: c.timestamp, key: c.type === 'key', data: d })
        },
        error: (e) => (window.__err = String(e)),
      })
      window.__enc.configure({ codec: 'vp09.00.40.08', width: f.w, height: f.h, bitrate: f.bitrate, framerate: f.fps, bitrateMode: 'variable', latencyMode: 'quality' })
    }, FILM)
    for (let i = 0; i < seq.length; i++) {
      await enc.evaluate(
        async (b64, idx, f) => {
          const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob()
          const bmp = await createImageBitmap(blob)
          const frame = new VideoFrame(bmp, { timestamp: Math.round((idx * 1e6) / f.fps), duration: Math.round(1e6 / f.fps) })
          window.__enc.encode(frame, { keyFrame: idx % (f.fps * 3) === 0 })
          frame.close()
          bmp.close()
          while (window.__enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2))
          if (window.__err) throw new Error(window.__err)
        },
        seq[i],
        i,
        FILM,
      )
    }
    // hand the chunks back as base64 (typed arrays don't survive the CDP bridge)
    const chunks = await enc.evaluate(async () => {
      await window.__enc.flush()
      window.__enc.close()
      const b64 = (u8) => {
        let s = ''
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
        return btoa(s)
      }
      return window.__chunks.map((c) => ({ timestamp: c.timestamp, key: c.key, data: b64(c.data) }))
    })
    await enc.close()
    const bytes = muxWebM({
      width: FILM.w,
      height: FILM.h,
      fps: FILM.fps,
      chunks: chunks.map((c) => ({ ...c, data: new Uint8Array(Buffer.from(c.data, 'base64')) })),
      durationMs: (seq.length * 1000) / FILM.fps,
    })
    const file = path.join(out, 'hero.webm')
    fs.writeFileSync(file, bytes)
    const mb = bytes.length / 1048576
    console.log('  saved', path.relative(process.cwd(), file), `${mb.toFixed(2)} MB, ${(seq.length / FILM.fps).toFixed(1)} s`)
    if (mb > 6) console.warn('  WARNING: hero.webm is over 6 MB — lower FILM.bitrate')
    // the film's first frame doubles as its poster, so the poster → video swap is invisible
    fs.writeFileSync(path.join(out, 'hero-film.jpg'), Buffer.from(frames[0], 'base64'))
  } catch (e) {
    failures.push('hero-video')
    console.warn('  SKIPPED hero-video:', String(e?.message ?? e).split('\n')[0])
  }
}

await browser.close()

// Tell the landing page which images exist (bundled JSON: works on serverless hosts too).
{
  const files = fs
    .readdirSync(out)
    .filter((f) => /\.(jpg|webm)$/.test(f) && fs.statSync(path.join(out, f)).size > 0)
    .sort()
  const manifest = path.resolve('app/landing/captured.json')
  const note = 'Written by scripts/capture-landing.mjs — the landing-page images that exist in public/brand/landing/.'
  fs.writeFileSync(manifest, JSON.stringify({ note, files }, null, 2) + '\n')
  console.log(`wrote ${path.relative(process.cwd(), manifest)} (${files.length} files)`)
  const expected = ['hero.jpg', 'hero.webm', 'hero-film.jpg', ...SPACES.map(([n]) => `${n}.jpg`)]
  for (const f of ['tour', 'studio', 'info', 'examine', 'inspect', 'golden', 'night', 'theatre', 'photo', 'walk', 'hindi']) expected.push(`f-${f}.jpg`)
  const missing = expected.filter((f) => !files.includes(f))
  if (missing.length) console.warn(`still missing (placeholders shown): ${missing.join(', ')}`)
}
console.log(failures.length ? `done — skipped: ${failures.join(', ')}` : 'done — all shots captured')
