/** Counts linked shader programs and when they were compiled.  node scripts/shader-count.mjs [baseUrl] */
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage()
await p.evaluateOnNewDocument(() => {
  const t0 = performance.now()
  window.__srcs = []
  const ss = WebGL2RenderingContext.prototype.shaderSource
  WebGL2RenderingContext.prototype.shaderSource = function (s, src) {
    if (src.includes('gl_FragColor') || src.includes('pc_fragColor')) {
      const m = src.match(/#define SHADER_NAME (.*)/)
      const compiled = window.__museum?.store.getState().sceneCompiled
      window.__srcs.push(`${Math.round(performance.now() - t0)}ms ${compiled ? 'AFTER' : 'pre'} ${m ? m[1] : '?'} ${src.length}`)
    }
    return ss.call(this, s, src)
  }
})
await p.goto(`${process.argv[2] ?? 'http://localhost:3000'}/?quality=${process.argv[3] ?? 'medium'}&autostart`)
await p.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: 90000 })
await new Promise((r) => setTimeout(r, 5000))
const s = await p.evaluate(() => window.__srcs)
console.log(`${s.length} fragment programs`)
console.log(s.join('\n'))
await b.close()
