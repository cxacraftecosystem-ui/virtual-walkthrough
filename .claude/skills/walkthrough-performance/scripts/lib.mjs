// Shared plumbing for the walkthrough diagnostics. Run every script from the walkthrough's project root (its
// node_modules provide puppeteer-core and sharp), or point PERF_PROJECT at it.
//   PERF_PROJECT  project root whose node_modules to use (default: the current directory)
//   CHROME_PATH   Chrome / Chromium executable (default: the usual install locations)
//   PERF_PATH     the route that mounts the 3D view (default: /gallery)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/** require() resolved from the walkthrough project, so the scripts need no installs of their own. */
export function projectRequire() {
  const root = process.env.PERF_PROJECT || process.cwd()
  const req = createRequire(path.join(root, 'package.json'))
  try {
    req.resolve('puppeteer-core')
  } catch {
    console.error(`puppeteer-core is not installed in ${root}: run from the walkthrough's root, set PERF_PROJECT, or npm i -D puppeteer-core sharp there`)
    process.exit(2)
  }
  return req
}

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
}

/** A real GPU, as visitors have: ANGLE on Direct3D 11 on Windows (what Chrome uses there), the default elsewhere. */
export function gpuArgs() {
  return process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist']
}

/** The route that mounts the 3D view. */
export function galleryPath() {
  return process.env.PERF_PATH || '/gallery'
}
