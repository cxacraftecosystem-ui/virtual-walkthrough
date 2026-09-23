/**
 * Compact QR Code encoder (ISO/IEC 18004) — byte mode, error correction level M,
 * versions 1–10 (up to 213 bytes). No dependencies; runs on the server and in the browser.
 *
 *   const qr = encodeQR('https://example.org/gallery#artwork=hero-01')
 *   qr.size, qr.get(x, y)          // module matrix (true = dark)
 *   qrSvgPath(qr)                  // one SVG path ("M x y h1 v1 h-1z" per dark run)
 */

/** Per version (index = version): [total codewords, EC codewords per block, [blocks, data codewords per block][]]. */
const M_TABLE: [number, number, [number, number][]][] = [
  [0, 0, []],
  [26, 10, [[1, 16]]],
  [44, 16, [[1, 28]]],
  [70, 26, [[1, 44]]],
  [100, 18, [[2, 32]]],
  [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]],
  [196, 18, [[4, 31]]],
  [242, 22, [[2, 38], [2, 39]]],
  [292, 22, [[3, 36], [2, 37]]],
  [346, 26, [[4, 43], [1, 44]]],
]

const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

export const QR_MAX_VERSION = 10

/* ---------------- Galois field GF(256), poly 0x11D ---------------- */

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

function rsGenerator(degree: number): Uint8Array {
  // coefficients, highest power first (excluding the leading 1)
  const g = new Uint8Array(degree)
  g[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      g[j] = gmul(g[j], root)
      if (j + 1 < degree) g[j] ^= g[j + 1]
    }
    root = gmul(root, 2)
  }
  return g
}

function rsRemainder(data: Uint8Array, gen: Uint8Array): Uint8Array {
  const r = new Uint8Array(gen.length)
  for (const b of data) {
    const f = b ^ r[0]
    r.copyWithin(0, 1)
    r[r.length - 1] = 0
    for (let i = 0; i < r.length; i++) r[i] ^= gmul(gen[i], f)
  }
  return r
}

/* ---------------- bit buffer ---------------- */

class Bits {
  bits: number[] = []
  put(v: number, n: number) {
    for (let i = n - 1; i >= 0; i--) this.bits.push((v >>> i) & 1)
  }
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/* ---------------- matrix ---------------- */

export interface QRMatrix {
  version: number
  size: number
  mask: number
  get(x: number, y: number): boolean
}

function dataCapacity(v: number) {
  return M_TABLE[v][2].reduce((s, [n, k]) => s + n * k, 0)
}

/** Largest byte payload per version at level M (for callers that want to warn). */
export function qrByteCapacity(v: number) {
  return dataCapacity(v) - (v < 10 ? 2 : 3)
}

export function encodeQR(text: string, minVersion = 1, forceMask?: number): QRMatrix {
  const bytes = utf8(text)
  let version = 0
  for (let v = Math.max(1, minVersion); v <= QR_MAX_VERSION; v++) {
    const ccBits = v < 10 ? 8 : 16
    if (4 + ccBits + bytes.length * 8 <= dataCapacity(v) * 8) {
      version = v
      break
    }
  }
  if (!version) throw new Error(`QR: text too long (${bytes.length} bytes; max ${qrByteCapacity(QR_MAX_VERSION)})`)

  // ── data codewords ──
  const cap = dataCapacity(version)
  const bb = new Bits()
  bb.put(0b0100, 4)
  bb.put(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) bb.put(b, 8)
  bb.put(0, Math.min(4, cap * 8 - bb.bits.length))
  while (bb.bits.length % 8) bb.bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bb.bits.length; i += 8) data.push(bb.bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad)

  // ── blocks + EC, interleaved ──
  const [, ecLen, groups] = M_TABLE[version]
  const gen = rsGenerator(ecLen)
  const blocks: Uint8Array[] = []
  const ecs: Uint8Array[] = []
  let off = 0
  for (const [n, k] of groups)
    for (let i = 0; i < n; i++) {
      const blk = Uint8Array.from(data.slice(off, off + k))
      off += k
      blocks.push(blk)
      ecs.push(rsRemainder(blk, gen))
    }
  const final: number[] = []
  const maxK = Math.max(...blocks.map((b) => b.length))
  for (let i = 0; i < maxK; i++) for (const b of blocks) if (i < b.length) final.push(b[i])
  for (let i = 0; i < ecLen; i++) for (const e of ecs) final.push(e[i])

  // ── function patterns ──
  const size = version * 4 + 17
  const mod = new Uint8Array(size * size) // 0/1 dark
  const fn = new Uint8Array(size * size) // 1 = function module (not maskable)
  const set = (x: number, y: number, dark: boolean) => {
    mod[y * size + x] = dark ? 1 : 0
    fn[y * size + x] = 1
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, d !== 2 && d !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0)
    set(6, i, i % 2 === 0)
  }
  const al = ALIGN[version]
  for (const ay of al)
    for (const ax of al) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === al[al.length - 1]) || (ax === al[al.length - 1] && ay === 6)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  // reserve format areas (filled per mask below) + dark module
  const reserveFormat = () => {
    for (let i = 0; i < 9; i++) {
      fn[8 * size + i] = 1
      fn[i * size + 8] = 1
    }
    for (let i = 0; i < 8; i++) {
      fn[8 * size + (size - 1 - i)] = 1
      fn[(size - 1 - i) * size + 8] = 1
    }
  }
  reserveFormat()
  set(8, size - 8, true)
  // version information (v ≥ 7)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, dark)
      set(b, a, dark)
    }
  }

  // ── place data (zig-zag) ──
  let bit = 0
  const total = final.length * 8
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (fn[y * size + x]) continue
        if (bit < total) mod[y * size + x] = (final[bit >>> 3] >>> (7 - (bit & 7))) & 1
        bit++
      }
  }

  // ── masks: pick the lowest penalty ──
  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const withMask = (mask: number) => {
    const out = mod.slice()
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && maskFn[mask](x, y)) out[y * size + x] ^= 1
    // format bits: level M = 00
    const fdata = (0b00 << 3) | mask
    let rem = fdata
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const f = ((fdata << 10) | rem) ^ 0x5412
    const put = (x: number, y: number, i: number) => (out[y * size + x] = (f >>> i) & 1)
    for (let i = 0; i <= 5; i++) put(8, i, i)
    put(8, 7, 6)
    put(8, 8, 7)
    put(7, 8, 8)
    for (let i = 9; i < 15; i++) put(14 - i, 8, i)
    for (let i = 0; i < 8; i++) put(size - 1 - i, 8, i)
    for (let i = 8; i < 15; i++) put(8, size - 15 + i, i)
    out[(size - 8) * size + 8] = 1
    return out
  }
  const penalty = (m: Uint8Array) => {
    let p = 0
    const at = (x: number, y: number) => m[y * size + x]
    // rule 1: runs of ≥5 in rows / columns; rule 3: finder-like patterns
    for (let pass = 0; pass < 2; pass++)
      for (let a = 0; a < size; a++) {
        let run = 1
        let seq = 0
        for (let b = 0; b < size; b++) {
          const v = pass ? at(a, b) : at(b, a)
          if (b > 0) {
            const pv = pass ? at(a, b - 1) : at(b - 1, a)
            if (v === pv) {
              run++
              if (run === 5) p += 3
              else if (run > 5) p++
            } else run = 1
          }
          seq = ((seq << 1) | v) & 0x7ff
          if (b >= 10 && (seq === 0x05d || seq === 0x5d0)) p += 40
        }
      }
    // rule 2: 2×2 blocks
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const v = at(x, y)
        if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) p += 3
      }
    // rule 4: balance
    let dark = 0
    for (const v of m) dark += v
    p += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10
    return p
  }
  let best = 0
  let bestM: Uint8Array | null = null
  let bestP = Infinity
  for (let k = 0; k < 8; k++) {
    if (forceMask !== undefined && k !== forceMask) continue
    const m = withMask(k)
    const p = penalty(m)
    if (p < bestP) {
      bestP = p
      best = k
      bestM = m
    }
  }
  const matrix = bestM!
  return { version, size, mask: best, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && matrix[y * size + x] === 1 }
}

/** SVG path data for the dark modules (1 unit = 1 module; add a 4-module quiet zone around it). */
export function qrSvgPath(qr: QRMatrix, offset = 4): string {
  let d = ''
  for (let y = 0; y < qr.size; y++) {
    let x = 0
    while (x < qr.size) {
      if (!qr.get(x, y)) {
        x++
        continue
      }
      let w = 1
      while (x + w < qr.size && qr.get(x + w, y)) w++
      d += `M${x + offset} ${y + offset}h${w}v1h${-w}z`
      x += w
    }
  }
  return d
}

/** A complete standalone SVG string (quiet zone included). */
export function qrSvg(text: string, opts: { dark?: string; light?: string; title?: string } = {}): string {
  const qr = encodeQR(text)
  const n = qr.size + 8
  const title = opts.title ? `<title>${opts.title.replace(/[<&>]/g, '')}</title>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">${title}<rect width="${n}" height="${n}" fill="${opts.light ?? '#fff'}"/><path d="${qrSvgPath(qr)}" fill="${opts.dark ?? '#000'}"/></svg>`
}
