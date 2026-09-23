/**
 * Museum shop furniture (zone 'shop'): timber wall shelving, low display tables, a stole
 * rail and the counter — each dressed with folded printed cloths, cushions and stoles in
 * placeholder colourways (models/amenityTextures.ts print atlas: one material, one draw
 * call per piece of furniture).
 *
 * Every model: origin at floor centre, front faces +z, built to footprint/height.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { box, Builder, cyl, lathe, Parts, rbox, rng, useBuilt } from './kit'
import { useModelMaterials } from './modelMaterials'
import { cellUV, printMaterial } from './amenityTextures'
import { fp, geoKey, num, type ModelProps } from './types'

/** A printed part: plain 0..1-UV box remapped into atlas cell `cell`. */
function printBox(w: number, h: number, d: number, cell: number) {
  return cellUV(new THREE.BoxGeometry(w, h, d), cell)
}

/** A neat stack of folded lengths standing on y = 0 (local), `n` cloths, returns its height. */
function foldStack(b: Builder, x: number, y: number, z: number, w: number, d: number, n: number, r: () => number, rotY = 0) {
  let top = y
  for (let i = 0; i < n; i++) {
    const h = 0.03 + r() * 0.018
    const jx = (r() - 0.5) * 0.02
    const jz = (r() - 0.5) * 0.015
    b.add('print', printBox(w + (r() - 0.5) * 0.02, h, d, Math.floor(r() * 8)), { p: [x + jx, top + h / 2, z + jz], r: [0, rotY + (r() - 0.5) * 0.05, 0] })
    top += h
  }
  return top
}

/** Two or three plump cushions leaning against each other. */
function cushions(b: Builder, x: number, y: number, z: number, r: () => number, count = 2) {
  for (let i = 0; i < count; i++) {
    const s = 0.36 + r() * 0.06
    b.add('print', cellUV(new RoundedBoxGeometry(s, s, 0.13, 3, 0.05), Math.floor(r() * 8)), {
      p: [x + (i - (count - 1) / 2) * 0.3, y + s / 2 - 0.02, z - 0.02 + i * 0.03],
      r: [-0.18 + r() * 0.1, (r() - 0.5) * 0.3, (r() - 0.5) * 0.12],
    })
  }
}

/* ------------------------------------------------------------------ */
/* Wall shelving                                                       */
/* ------------------------------------------------------------------ */

export function ShopShelf({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [3.0, 0.45])
  const H = config.height ?? 2.5
  const seed = num(config, 'seed', 1)
  const withCushions = config.props?.cushions === true
  const parts = useBuilt(geoKey('shop-shelf', config), () => {
    const b = new Builder()
    const r = rng(seed * 101)
    const bays = Math.max(1, Math.round(W / 1.0))
    const t = 0.036
    const levels = [0.1, 0.56, 1.02, 1.48, 1.94]
    // plinth, back panel, crown
    b.add('shadow', box(W - 0.04, 0.1, D - 0.06), { p: [0, 0.05, 0.01] })
    b.add('back', box(W, H - 0.1, 0.018, 'y'), { p: [0, 0.1 + (H - 0.1) / 2, -D / 2 + 0.009] })
    b.add('oak', rbox(W + 0.02, 0.05, D, 0.004, 2, 'x'), { p: [0, H - 0.025, 0] })
    // uprights
    for (let i = 0; i <= bays; i++) b.add('oak', rbox(t, H - 0.05, D - 0.02, 0.003, 2, 'y'), { p: [-W / 2 + t / 2 + (i * (W - t)) / bays, (H - 0.05) / 2, 0.01] })
    // shelves + their contents
    const bw = (W - t) / bays
    for (const y of levels) {
      b.add('oak', rbox(W - 0.01, 0.03, D - 0.04, 0.003, 2, 'x'), { p: [0, y + 0.015, 0.0] })
      for (let i = 0; i < bays; i++) {
        const cx = -W / 2 + t / 2 + bw * (i + 0.5)
        const top = y + 0.03
        const kind = r()
        if (withCushions && y > 1 && kind < 0.45) cushions(b, cx, top, 0.02, r, 2)
        else if (kind < 0.12 && y > 0.3) {
          // a CC0-free little still life: a turned bowl
          b.add('clay', lathe([[0, 0], [0.07, 0.005], [0.1, 0.04], [0.105, 0.075], [0.095, 0.08]], 20), { p: [cx, top, 0.02] })
        } else {
          const n = y < 0.3 ? 5 : 3 + Math.floor(r() * 3)
          foldStack(b, cx - bw * 0.22, top, 0.02, bw * 0.4, D * 0.66, n, r)
          foldStack(b, cx + bw * 0.22, top, 0.02, bw * 0.4, D * 0.66, Math.max(2, n - 1 - Math.floor(r() * 2)), r)
        }
      }
    }
    return b
  })
  return <Parts parts={parts} materials={{ oak: m.oak, back: m.walnut, shadow: m.shadowGap, print: printMaterial(), clay: m.terracotta }} />
}

/* ------------------------------------------------------------------ */
/* Display table                                                       */
/* ------------------------------------------------------------------ */

export function ShopTable({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [1.6, 0.8])
  const H = config.height ?? 0.78
  const seed = num(config, 'seed', 3)
  const withCushions = config.props?.cushions === true
  const parts = useBuilt(geoKey('shop-table', config), () => {
    const b = new Builder()
    const r = rng(seed * 313)
    const top = 0.045
    b.add('oak', rbox(W, top, D, 0.006, 2, 'x'), { p: [0, H - top / 2, 0] })
    // slim apron + four square legs, low shelf
    for (const sz of [-1, 1]) b.add('oak', box(W - 0.14, 0.08, 0.022, 'x'), { p: [0, H - top - 0.04, sz * (D / 2 - 0.06)] })
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) b.add('oak', rbox(0.05, H - top, 0.05, 0.004, 2, 'y'), { p: [sx * (W / 2 - 0.06), (H - top) / 2, sz * (D / 2 - 0.06)] })
    b.add('oak', rbox(W - 0.1, 0.025, D - 0.1, 0.004, 2, 'x'), { p: [0, 0.2, 0] })
    // top: three stacks (or cushions), lower shelf: two long stacks
    if (withCushions) {
      cushions(b, -W * 0.28, H, 0, r, 2)
      foldStack(b, W * 0.12, H, 0, 0.32, 0.4, 5, r)
      foldStack(b, W * 0.36, H, -0.05, 0.3, 0.36, 3, r, 0.2)
    } else {
      foldStack(b, -W * 0.3, H, 0, 0.34, 0.42, 5, r)
      foldStack(b, 0, H, 0.02, 0.34, 0.42, 4, r)
      foldStack(b, W * 0.26, H, -0.04, 0.3, 0.38, 3, r, -0.25)
    }
    foldStack(b, -W * 0.22, 0.2125, 0, 0.5, 0.46, 3, r)
    foldStack(b, W * 0.22, 0.2125, 0, 0.5, 0.46, 2, r)
    return b
  })
  return <Parts parts={parts} materials={{ oak: m.oak, print: printMaterial() }} />
}

/* ------------------------------------------------------------------ */
/* Stole rail                                                          */
/* ------------------------------------------------------------------ */

export function StoleRail({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [2.6, 0.45])
  const H = config.height ?? 1.75
  const count = Math.round(num(config, 'count', 7))
  const seed = num(config, 'seed', 21)
  const parts = useBuilt(geoKey('stole-rail', config), () => {
    const b = new Builder()
    const r = rng(seed * 17)
    const rail = H - 0.05
    // two timber A-frame ends on a walnut base, brass rail
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.05)
      b.add('walnut', rbox(0.06, 0.04, D, 0.004, 2, 'z'), { p: [x, 0.02, 0] })
      b.add('walnut', rbox(0.045, rail, 0.045, 0.004, 2, 'y'), { p: [x, rail / 2, 0] })
      b.add('brass', cyl(0.016, 0.016, 0.02, 12), { p: [x, rail, 0] })
    }
    b.add('brass', cyl(0.012, 0.012, W - 0.1, 16).rotateZ(Math.PI / 2), { p: [0, rail, 0] })
    b.add('brass', cyl(0.009, 0.009, W - 0.1, 12).rotateZ(Math.PI / 2), { p: [0, 0.3, 0] })
    // stoles draped over the rail: a front and a back fall joined over the top
    const pitch = (W - 0.4) / Math.max(1, count - 1)
    for (let i = 0; i < count; i++) {
      const x = -W / 2 + 0.2 + i * pitch + (r() - 0.5) * 0.03
      const w = 0.26 + r() * 0.06
      const cell = Math.floor(r() * 8)
      const front = 0.9 + r() * 0.3
      const back = front - 0.08 - r() * 0.1
      const tilt = (r() - 0.5) * 0.04
      b.add('print', printBox(w, front, 0.006, cell), { p: [x, rail - front / 2, 0.022], r: [0.03, 0, tilt] })
      b.add('print', printBox(w, back, 0.006, cell), { p: [x, rail - back / 2, -0.022], r: [-0.03, 0, tilt] })
      b.add('print', printBox(w, 0.012, 0.05, cell), { p: [x, rail + 0.014, 0] })
    }
    return b
  })
  return <Parts parts={parts} materials={{ walnut: m.walnut, brass: m.brass, print: printMaterial() }} />
}

/* ------------------------------------------------------------------ */
/* Counter                                                             */
/* ------------------------------------------------------------------ */

export function ShopCounter({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [2.2, 0.6])
  const H = config.height ?? 1.0
  const parts = useBuilt(geoKey('shop-counter', config), () => {
    const b = new Builder()
    const r = rng(5)
    // recessed plinth, fluted walnut front, stone top
    b.add('shadow', box(W - 0.08, 0.08, D - 0.08), { p: [0, 0.04, 0] })
    b.add('walnut', rbox(W - 0.02, H - 0.12, D - 0.04, 0.005, 2, 'y'), { p: [0, 0.08 + (H - 0.12) / 2, 0] })
    const flutes = Math.floor((W - 0.1) / 0.06)
    for (let i = 0; i < flutes; i++) {
      const x = -W / 2 + 0.05 + (i + 0.5) * ((W - 0.1) / flutes)
      b.add('walnut', cyl(0.016, 0.016, H - 0.18, 8), { p: [x, 0.08 + (H - 0.12) / 2, D / 2 - 0.02 + 0.004] })
    }
    b.add('brass', box(W - 0.02, 0.012, 0.012), { p: [0, H - 0.046, D / 2 - 0.008] })
    b.add('stone', rbox(W + 0.04, 0.04, D + 0.04, 0.006, 2, 'x'), { p: [0, H - 0.02, 0] })
    // on top: a folded length, a brass bell, a small tray of cards
    foldStack(b, W * 0.28, H, 0, 0.36, 0.3, 2, r, 0.2)
    b.add('brass', lathe([[0, 0], [0.04, 0.002], [0.042, 0.01], [0.03, 0.03], [0.012, 0.05], [0.004, 0.07], [0, 0.072]], 20), { p: [-W * 0.3, H, 0.05] })
    b.add('walnut', rbox(0.2, 0.02, 0.12, 0.003), { p: [-W * 0.08, H + 0.01, 0.1] })
    b.add('paper', box(0.18, 0.012, 0.1), { p: [-W * 0.08, H + 0.026, 0.1] })
    // low back shelf against the wall with more stock
    const bz = -D / 2 - 0.36
    b.add('walnut', rbox(W, 0.03, 0.32, 0.004, 2, 'x'), { p: [0, 0.86, bz] })
    b.add('walnut', rbox(W, 0.03, 0.32, 0.004, 2, 'x'), { p: [0, 0.44, bz] })
    for (const sx of [-1, 0, 1]) b.add('walnut', box(0.03, 0.87, 0.32), { p: [sx * (W / 2 - 0.015), 0.435, bz] })
    for (const y of [0.455, 0.875]) for (let i = 0; i < 3; i++) foldStack(b, -W / 2 + 0.36 + i * ((W - 0.72) / 2), y, bz, 0.34, 0.26, 3 + Math.floor(r() * 2), r)
    return b
  })
  return <Parts parts={parts} materials={{ walnut: m.walnut, brass: m.brass, stone: m.counterStone, shadow: m.shadowGap, print: printMaterial(), paper: m.paper }} />
}
