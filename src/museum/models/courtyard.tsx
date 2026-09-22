/**
 * Dye Garden Courtyard models: drying line, planting bed, tree, rinsing channel,
 * garden bench. Plants are generic (no species implied).
 */
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { box, Builder, cyl, Parts, rbox, rng, useBuilt } from './kit'
import { liquidMaterial, makeFoliageMaterial, makeSwayMaterial, useModelMaterials } from './modelMaterials'
import { flowerTexture, imageAtlas, leafClusterTexture } from './textures'
import { fp, geoKey, num, str, type ModelProps } from './types'

/* ------------------------------------------------------------------ */
/* Shared foliage                                                      */
/* ------------------------------------------------------------------ */

/**
 * `planes` crossed vertical quads (w × h, bottom at y = 0). Normals are bent upwards so
 * cards read as a lit volume rather than flat planes.
 */
export function crossedCards(w: number, h: number, planes = 3, upBias = 1.2) {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < planes; i++) {
    const g = new THREE.PlaneGeometry(w, h, 1, 2)
    g.translate(0, h / 2, 0)
    g.rotateY((i / planes) * Math.PI)
    parts.push(g)
  }
  const b = new Builder()
  parts.forEach((g) => b.add('c', g))
  const geo = b.build()[0].geometry
  bendNormals(geo, upBias)
  return geo
}

function bendNormals(geo: THREE.BufferGeometry, upBias: number) {
  const n = geo.getAttribute('normal')
  const v = new THREE.Vector3()
  for (let i = 0; i < n.count; i++) {
    v.set(n.getX(i) * 0.5, upBias, n.getZ(i) * 0.5).normalize()
    n.setXYZ(i, v.x, v.y, v.z)
  }
}

/** A single leaf card (w × h) pivoting at its bottom edge, normals bent up. */
function leafCard(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h, 1, 1)
  g.translate(0, h / 2, 0)
  bendNormals(g, 1.4)
  return g
}

const foliageMats = new Map<string, { material: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial }>()
export function foliageMaterial(kind: 'tree' | 'shrub' | 'strap' | 'flower', amp: number, speed: number) {
  const key = `${kind}|${amp}|${speed}`
  let hit = foliageMats.get(key)
  if (!hit) {
    const map = kind === 'flower' ? flowerTexture() : leafClusterTexture(kind)
    const mat = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: kind === 'flower' ? 0.7 : 0.78,
      metalness: 0,
      envMapIntensity: 0.5,
    })
    hit = makeFoliageMaterial(mat, amp, speed)
    foliageMats.set(key, hit)
  }
  return hit
}

/* ------------------------------------------------------------------ */
/* Drying line                                                         */
/* ------------------------------------------------------------------ */

export function DryingLine({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W] = fp(config, [6, 0.4])
  const H = config.height ?? 2.6
  const n = Math.max(1, Math.round(num(config, 'cloths', 4)))
  const images = str(config, 'images', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const postX = W / 2 - 0.08
  const ropeY = H - 0.14
  const sag = 0.07
  const ropeAt = (x: number) => ropeY - sag * (1 - (x / postX) ** 2)
  const span = 2 * postX - 0.3
  const cw = Math.min(1.25, (span - (n + 1) * 0.1) / n)
  const ch = Math.min(1.75, H - 0.55)
  const gap = (span - n * cw) / (n + 1)

  const parts = useBuilt(geoKey('drying-line', config), () => {
    const b = new Builder()
    for (const s of [-1, 1]) {
      b.add('post', rbox(0.1, H, 0.1, 0.008), { p: [s * postX, H / 2, 0] })
      b.add('post', rbox(0.14, 0.04, 0.14, 0.006), { p: [s * postX, H + 0.02, 0] })
      b.add('steel', box(0.24, 0.012, 0.24), { p: [s * postX, 0.006, 0] })
      b.add('steel', box(0.012, 0.16, 0.13), { p: [s * postX + 0.056, 0.092, 0] })
      b.add('steel', box(0.012, 0.16, 0.13), { p: [s * postX - 0.056, 0.092, 0] })
      b.add('steel', cyl(0.012, 0.012, 0.03, 10), { p: [s * (postX - 0.065), ropeY, 0], r: [0, 0, Math.PI / 2] })
    }
    // rope: a sagging tube
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 24; i++) {
      const x = -postX + 0.05 + ((2 * postX - 0.1) * i) / 24
      pts.push(new THREE.Vector3(x, ropeAt(x), 0))
    }
    const rope = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.007, 6, false)
    b.add('rope', rope)
    // pegs
    for (let i = 0; i < n; i++) {
      const x0 = -span / 2 + gap + i * (cw + gap)
      for (const x of [x0 + 0.06, x0 + cw - 0.06]) b.add('peg', rbox(0.014, 0.075, 0.022, 0.003), { p: [x, ropeAt(x) - 0.01, 0] })
    }
    return b
  })

  // all cloths in one geometry: front drop + short back flap, UVs into the image atlas
  const clothGeo = useMemo(() => {
    const b = new Builder()
    for (let i = 0; i < n; i++) {
      const x0 = -span / 2 + gap + i * (cw + gap)
      for (const [drop, z, flip] of [
        [ch, 0.006, false],
        [0.32, -0.006, true],
      ] as [number, number, boolean][]) {
        const g = new THREE.PlaneGeometry(cw, drop, 8, drop > 1 ? 16 : 4)
        const pos = g.getAttribute('position')
        const uv = g.getAttribute('uv')
        for (let k = 0; k < pos.count; k++) {
          const lx = pos.getX(k)
          const ly = pos.getY(k) - drop / 2 // 0 at top → -drop
          const wx = x0 + cw / 2 + lx
          // slight catenary of the top edge + a soft belly across the width
          const belly = Math.sin(((lx / cw + 0.5) * Math.PI)) * 0.012 * (-ly / ch)
          pos.setXYZ(k, wx, ropeAt(wx) + ly + 0.005, z + (flip ? -belly : belly))
          const u = uv.getX(k)
          const v = flip ? 1 - (-ly / ch) : uv.getY(k)
          uv.setXY(k, (i + u) / n, v)
        }
        g.computeVertexNormals()
        b.add('c', g)
      }
    }
    return b.build()[0].geometry
  }, [n, span, gap, cw, ch, ropeY, sag, postX]) // eslint-disable-line react-hooks/exhaustive-deps

  const [atlas, setAtlas] = useState<THREE.Texture | null>(null)
  const imgKey = images.join(',')
  useEffect(() => {
    let live = true
    const urls = Array.from({ length: n }, (_, i) => images[i % Math.max(1, images.length)] ?? '')
    imageAtlas(urls, cw / ch).then((t) => live && setAtlas(t))
    return () => {
      live = false
    }
  }, [imgKey, n, cw, ch]) // eslint-disable-line react-hooks/exhaustive-deps

  const cloth = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ color: atlas ? '#ffffff' : '#ece3d2', map: atlas, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.5 })
    return makeSwayMaterial(mat, { top: ropeY, length: ch, amplitude: 0.055, speed: 0.9, phase: (config.position[0] + config.position[2]) * 0.7 })
  }, [atlas, ropeY, ch, config.position])
  useEffect(() => () => {
    cloth.material.dispose()
    cloth.depth.dispose()
  }, [cloth])

  return (
    <group>
      <Parts parts={parts} materials={{ post: m.darkTimber, steel: m.blackSteel, rope: m.rope, peg: m.oak }} />
      <mesh geometry={clothGeo} material={cloth.material} customDepthMaterial={cloth.depth} castShadow receiveShadow />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Planting bed                                                        */
/* ------------------------------------------------------------------ */

const FLOWER_COLOURS = ['#e8932a', '#e9c84a', '#f1ede4', '#8a88c0', '#c0582f', '#e3b54a']

export function PlantBed({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [9, 1.2])
  const H = config.height ?? 0.45
  const t = 0.12
  const soilY = H - 0.06

  const parts = useBuilt(geoKey('plant-bed', config), () => {
    const b = new Builder()
    for (const s of [-1, 1]) {
      b.add('wall', rbox(W, H, t, 0.015, 2, 'x'), { p: [0, H / 2, s * (D / 2 - t / 2)] })
      b.add('wall', rbox(t, H, D - 2 * t + 0.002, 0.015, 2, 'z'), { p: [s * (W / 2 - t / 2), H / 2, 0] })
      // coping
      b.add('wall', rbox(W + 0.04, 0.04, t + 0.04, 0.01, 2, 'x'), { p: [0, H + 0.02, s * (D / 2 - t / 2)] })
      b.add('wall', rbox(t + 0.04, 0.04, D - 2 * t - 0.04, 0.01, 2, 'z'), { p: [s * (W / 2 - t / 2), H + 0.02, 0] })
    }
    b.add('soil', box(W - 2 * t, 0.08, D - 2 * t), { p: [0, soilY - 0.04, 0] })
    return b
  })

  const plants = useMemo(() => {
    const r = rng('bed' + config.id)
    const iw = W - 2 * t - 0.12
    const id = D - 2 * t - 0.08
    const leaves = foliageMaterial('shrub', 0.025, 1.1)
    const flowers = foliageMaterial('flower', 0.04, 1.3)
    const nLeaf = Math.round(iw * id * 30)
    const nFlower = Math.round(iw * id * 20)
    const leafGeo = crossedCards(0.55, 0.5, 3)
    const flowerGeo = crossedCards(0.16, 0.16, 2, 0.6)
    const li = new THREE.InstancedMesh(leafGeo, leaves.material, nLeaf)
    const fi = new THREE.InstancedMesh(flowerGeo, flowers.material, nFlower)
    const mm = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const c = new THREE.Color()
    // gentle drifts: clumps of similar height along the bed
    const heightAt = (x: number) => 0.75 + 0.35 * Math.sin(x * 0.9 + 1.3) * Math.sin(x * 0.37)
    for (let i = 0; i < nLeaf; i++) {
      const x = (r() - 0.5) * iw
      const z = (r() - 0.5) * id
      const s = (0.55 + r() * 0.6) * heightAt(x)
      q.setFromEuler(e.set((r() - 0.5) * 0.25, r() * Math.PI, (r() - 0.5) * 0.25))
      mm.compose(new THREE.Vector3(x, soilY - 0.02, z), q, new THREE.Vector3(s * (0.8 + r() * 0.5), s, s * (0.8 + r() * 0.5)))
      li.setMatrixAt(i, mm)
      li.setColorAt(i, c.setHSL(0.24 + r() * 0.07, 0.35 + r() * 0.2, 0.62 + r() * 0.3))
    }
    for (let i = 0; i < nFlower; i++) {
      const x = (r() - 0.5) * iw
      const z = (r() - 0.5) * id
      const y = soilY + 0.22 * heightAt(x) + r() * 0.28 * heightAt(x)
      q.setFromEuler(e.set((r() - 0.5) * 0.5, r() * Math.PI, (r() - 0.5) * 0.5))
      const s = 0.7 + r() * 0.6
      mm.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s))
      fi.setMatrixAt(i, mm)
      // colour drifts along the bed
      const band = Math.floor(((x / iw + 0.5) * 4 + r() * 0.8) % FLOWER_COLOURS.length)
      fi.setColorAt(i, c.set(FLOWER_COLOURS[(band + (r() < 0.2 ? 2 : 0)) % FLOWER_COLOURS.length]))
    }
    for (const im of [li, fi]) {
      im.castShadow = true
      im.receiveShadow = true
      im.computeBoundingSphere()
    }
    li.customDepthMaterial = leaves.depth
    fi.customDepthMaterial = flowers.depth
    return { li, fi }
  }, [config.id, W, D, t, soilY])

  return (
    <group>
      <Parts parts={parts} materials={{ wall: m.stone, soil: m.soil }} />
      <primitive object={plants.li} />
      <primitive object={plants.fi} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

/** Tube tapering linearly from r0 to r1 along the curve. */
function taperTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, tubular = 10, radial = 8) {
  const g = new THREE.TubeGeometry(curve, tubular, r0, radial, false)
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  const c = new THREE.Vector3()
  const p = new THREE.Vector3()
  const len = curve.getLength()
  for (let k = 0; k < pos.count; k++) {
    const i = Math.floor(k / (radial + 1))
    const t = i / tubular
    curve.getPointAt(t, c)
    const s = (r0 + (r1 - r0) * t) / r0
    p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(s).add(c)
    pos.setXYZ(k, p.x, p.y, p.z)
    uv.setXY(k, uv.getX(k) * len, uv.getY(k) * Math.PI * 2 * r0 * (1 - t * 0.5))
  }
  g.computeVertexNormals()
  return g
}

export function Tree({ config }: ModelProps) {
  const m = useModelMaterials()
  const H = config.height ?? 6
  const seed = config.id

  const tree = useMemo(() => {
    const r = rng('tree' + seed)
    const b = new Builder()
    const tips: { p: THREE.Vector3; dir: THREE.Vector3; size: number }[] = []
    const trunkH = H * 0.42
    const rTrunk = Math.max(0.1, H * 0.028)
    const lean = new THREE.Vector3((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2).normalize()

    const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
      const bend = new THREE.Vector3((r() - 0.5) * 0.5, 0.25 + r() * 0.2, (r() - 0.5) * 0.5)
      const mid = start.clone().addScaledVector(dir, len * 0.5).addScaledVector(bend, len * 0.18)
      const end = start.clone().addScaledVector(dir, len).addScaledVector(bend, len * 0.28)
      const curve = new THREE.CatmullRomCurve3([start, mid, end])
      b.add('bark', taperTube(curve, rad, rad * 0.55, depth === 0 ? 12 : 6, depth === 0 ? 12 : depth === 1 ? 8 : 5))
      const nd = end.clone().sub(mid).normalize()
      if (depth >= 2 || rad < 0.02) {
        tips.push({ p: end, dir: nd, size: len })
        return
      }
      const kids = depth === 0 ? 5 : 3
      for (let k = 0; k < kids; k++) {
        const az = (k / kids) * Math.PI * 2 + r() * 0.9
        const out = depth === 0 ? 0.62 + r() * 0.3 : 0.55 + r() * 0.4
        const d = new THREE.Vector3(Math.cos(az) * out, 1, Math.sin(az) * out).normalize().lerp(nd, 0.3).normalize()
        const at = depth === 0 ? 0.78 + r() * 0.22 : 0.6 + r() * 0.4
        const from = curve.getPointAt(at)
        grow(from, d, len * (depth === 0 ? 0.62 : 0.6) * (0.8 + r() * 0.4), rad * (depth === 0 ? 0.48 : 0.5), depth + 1)
      }
    }
    // root flare + trunk
    b.add('bark', taperTube(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.25, 0)]), rTrunk * 1.6, rTrunk * 1.05, 3, 12))
    grow(new THREE.Vector3(0, 0.2, 0), lean, trunkH, rTrunk, 0)
    const parts = b.build()

    // leaf cards clustered around branch tips
    const leaves = foliageMaterial('tree', 0.035, 0.8)
    const perTip = Math.max(14, Math.round(700 / Math.max(1, tips.length)))
    const count = tips.length * perTip
    const card = leafCard(0.75, 0.75)
    const im = new THREE.InstancedMesh(card, leaves.material, count)
    const mm = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const c = new THREE.Color()
    let i = 0
    const crownR = H * 0.14
    for (const tip of tips) {
      for (let k = 0; k < perTip; k++) {
        const off = new THREE.Vector3(r() - 0.5, (r() - 0.35) * 0.8, r() - 0.5).normalize().multiplyScalar(Math.cbrt(r()) * crownR)
        const p = tip.p.clone().add(off)
        q.setFromEuler(e.set((r() - 0.5) * 1.6, r() * Math.PI * 2, (r() - 0.5) * 1.6))
        const s = 0.7 + r() * 0.6
        mm.compose(p, q, new THREE.Vector3(s, s, s))
        im.setMatrixAt(i, mm)
        // outer, higher leaves lighter; inner ones darker (cheap self-shadowing)
        const lit = 0.55 + 0.45 * Math.min(1, Math.max(0, off.y / crownR + 0.5))
        im.setColorAt(i, c.setHSL(0.22 + r() * 0.06, 0.4, 0.45 + lit * 0.35))
        i++
      }
    }
    im.castShadow = true
    im.receiveShadow = true
    im.customDepthMaterial = leaves.depth
    im.computeBoundingSphere()
    return { parts, im }
  }, [H, seed])

  return (
    <group>
      <Parts parts={tree.parts} materials={{ bark: m.bark }} />
      <primitive object={tree.im} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Rinsing channel                                                     */
/* ------------------------------------------------------------------ */

export function WaterChannel({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [10, 0.9])
  const H = config.height ?? 0.35
  const t = 0.16
  const waterY = H - 0.09

  const parts = useBuilt(geoKey('water-channel', config), () => {
    const b = new Builder()
    b.add('stone', rbox(W, 0.1, D, 0.01, 2, 'x'), { p: [0, 0.05, 0] })
    for (const s of [-1, 1]) {
      b.add('stone', rbox(W, H - 0.04, t, 0.012, 2, 'x'), { p: [0, (H - 0.04) / 2, s * (D / 2 - t / 2)] })
      b.add('stone', rbox(W + 0.06, 0.05, t + 0.05, 0.012, 2, 'x'), { p: [0, H - 0.025, s * (D / 2 - t / 2)] })
      b.add('stone', rbox(t, H - 0.04, D - 2 * t + 0.002, 0.012, 2, 'z'), { p: [s * (W / 2 - t / 2), (H - 0.04) / 2, 0] })
    }
    // a few stepping stones set across the channel, lowered into the water
    const r = rng('channel' + config.id)
    for (const x of [-W * 0.28, W * 0.3]) b.add('stone', rbox(0.42, 0.12, D - 2 * t - 0.02, 0.03), { p: [x + (r() - 0.5) * 0.2, waterY - 0.03, 0] })
    // spout stone at the head
    b.add('stone', rbox(0.3, 0.1, 0.2, 0.02), { p: [-W / 2 + t + 0.1, H + 0.03, 0] })
    return b
  })

  const water = useMemo(() => liquidMaterial({ color: '#3d5654', amplitude: 0.045, scale: 1.2, flow: [0.14, 0], speed: 0.8, roughness: 0.04, opacity: 0.9 }), [])

  return (
    <group>
      <Parts parts={parts} materials={{ stone: m.stoneDark }} />
      <mesh rotation-x={-Math.PI / 2} position={[0, waterY, 0]} material={water} receiveShadow>
        <planeGeometry args={[W - 2 * t, D - 2 * t]} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Garden bench                                                        */
/* ------------------------------------------------------------------ */

export function GardenBench({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [2.4, 0.5])
  const H = config.height ?? 0.45

  const parts = useBuilt(geoKey('garden-bench', config), () => {
    const b = new Builder()
    const slats = 5
    const sw = (D - (slats - 1) * 0.012) / slats
    for (let i = 0; i < slats; i++) b.add('slat', rbox(W, 0.038, sw, 0.006, 2, 'x'), { p: [0, H - 0.019, -D / 2 + sw / 2 + i * (sw + 0.012)] })
    // two steel leg frames (flat bar), inset from the ends
    for (const s of [-1, 1]) {
      const x = s * (W / 2 - 0.28)
      const legH = H - 0.038
      for (const z of [-D / 2 + 0.04, D / 2 - 0.04]) b.add('steel', box(0.05, legH, 0.012), { p: [x, legH / 2, z] })
      b.add('steel', box(0.05, 0.012, D - 0.06), { p: [x, legH - 0.006, 0] })
      b.add('steel', box(0.05, 0.012, D - 0.06), { p: [x, 0.08, 0] })
    }
    return b
  })

  return <Parts parts={parts} materials={{ slat: m.teak, steel: m.blackSteel }} />
}

