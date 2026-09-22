/**
 * Atrium / theatre / general models: suspended textile banner, information desk,
 * planter (fallback for CC0 plant GLBs), timber column, theatre seating, garden bench
 * (see courtyard.tsx) and a trivial speaker placeholder.
 */
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { box, Builder, cyl, cylX, lathe, Parts, rbox, rng, useBuilt } from './kit'
import { makeSwayMaterial, useModelMaterials } from './modelMaterials'
import { imageTexture } from './textures'
import { fp, geoKey, num, str, type ModelProps } from './types'
import { foliageMaterial } from './courtyard'

/* ------------------------------------------------------------------ */
/* Suspended textile banner (origin = TOP, cloth hangs down)           */
/* ------------------------------------------------------------------ */

/** Local y of the cloth's top edge (just under the rod). */
const BANNER_TOP = -0.06

export function TextileBanner({ config }: ModelProps) {
  const m = useModelMaterials()
  const w = num(config, 'width', 1.3)
  const H = config.height ?? 5
  const cable = num(config, 'cable', 0.4)
  const image = str(config, 'image', '')

  const parts = useBuilt(geoKey('textile-banner', config), () => {
    const b = new Builder()
    b.add('steel', cylX(0.012, w + 0.1, 12), { p: [0, -0.035, 0] })
    for (const s of [-1, 1]) {
      b.add('steel', cyl(0.018, 0.018, 0.03, 12), { p: [s * (w / 2 + 0.05), -0.035, 0], r: [0, 0, Math.PI / 2] })
      b.add('steel', cyl(0.0015, 0.0015, cable + 0.035, 4), { p: [s * (w / 2 - 0.04), (cable - 0.035) / 2, 0] })
      b.add('steel', cyl(0.03, 0.03, 0.012, 16), { p: [s * (w / 2 - 0.04), cable - 0.006, 0] })
    }
    return b
  })

  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(w, H, 6, 28)
    g.translate(0, BANNER_TOP - H / 2, 0)
    // a soft rolled hem over the rod
    return g
  }, [w, H])

  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!image) return
    let live = true
    imageTexture(image, w / H).then((t) => live && setTex(t))
    return () => {
      live = false
    }
  }, [image, w, H])

  const cloth = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : '#e9dfcc', map: tex, roughness: 0.93, side: THREE.DoubleSide, envMapIntensity: 0.45 })
    const phase = config.position[0] * 1.9
    return makeSwayMaterial(mat, { top: BANNER_TOP, length: H, amplitude: 0.05, speed: 0.45, phase })
  }, [tex, H, config.position])
  useEffect(() => () => {
    cloth.material.dispose()
    cloth.depth.dispose()
  }, [cloth])

  return (
    <group>
      <Parts parts={parts} materials={{ steel: m.steel }} />
      <mesh geometry={geo} material={cloth.material} customDepthMaterial={cloth.depth} castShadow receiveShadow />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Information desk                                                    */
/* ------------------------------------------------------------------ */

export function GrandDesk({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [3.6, 1.0])
  const H = config.height ?? 1.05

  const parts = useBuilt(geoKey('grand-desk', config), () => {
    const b = new Builder()
    const plinthH = 0.1
    const ledgeD = 0.42 // visitor-side high counter
    const workH = 0.76
    b.add('shadow', box(W - 0.08, plinthH, D - 0.08), { p: [0, plinthH / 2, 0] })
    // front (visitor) volume at full height, fluted
    const fz = D / 2 - ledgeD / 2
    const bodyH = H - plinthH - 0.05
    b.add('wood', rbox(W, bodyH, ledgeD - 0.03, 0.004, 1, 'y'), { p: [0, plinthH + bodyH / 2, fz - 0.015] })
    const pitch = 0.055
    const nFl = Math.floor((W - 0.04) / pitch)
    for (let i = 0; i < nFl; i++) {
      const x = -((nFl - 1) * pitch) / 2 + i * pitch
      b.add('wood', rbox(0.042, bodyH - 0.06, 0.03, 0.012, 3, 'y'), { p: [x, plinthH + (bodyH - 0.06) / 2 + 0.01, D / 2 - 0.02] })
    }
    // ends wrap around
    for (const s of [-1, 1]) b.add('wood', rbox(0.04, bodyH, D - 0.04, 0.004, 1, 'y'), { p: [s * (W / 2 - 0.02), plinthH + bodyH / 2, 0] })
    // staff side: lower volume + work top
    const backD = D - ledgeD
    b.add('wood', rbox(W - 0.08, workH - plinthH - 0.03, backD - 0.02, 0.004, 1, 'y'), { p: [0, plinthH + (workH - plinthH - 0.03) / 2, -D / 2 + backD / 2] })
    b.add('wood', rbox(W - 0.08, 0.03, backD, 0.006, 2, 'x'), { p: [0, workH - 0.015, -D / 2 + backD / 2] })
    // stone counter top (overhangs the front)
    b.add('stone', rbox(W + 0.03, 0.05, ledgeD + 0.05, 0.008, 2, 'x'), { p: [0, H - 0.025, D / 2 - ledgeD / 2 + 0.02] })
    // brass reveal line under the stone
    b.add('brass', box(W - 0.02, 0.012, 0.006), { p: [0, H - 0.058, D / 2 + 0.002] })
    return b
  })

  return <Parts parts={parts} materials={{ wood: m.walnut, stone: m.counterStone, shadow: m.shadowGap, brass: m.brass }} />
}

/* ------------------------------------------------------------------ */
/* Planter with a sculptural plant (fallback for CC0 plant GLBs)       */
/* ------------------------------------------------------------------ */

export function Planter({ config }: ModelProps) {
  const m = useModelMaterials()
  const [fx, fz] = fp(config, [0.8, 0.8])
  const H = config.height ?? 1.6
  const R = (Math.min(fx, fz) / 2) * 0.82
  const potH = Math.min(0.7, Math.max(0.3, H * 0.3))

  const data = useMemo(() => {
    const r = rng('planter' + config.id)
    const b = new Builder()
    b.add('pot', lathe([[0, 0], [R * 0.7, 0], [R * 0.74, 0.02], [R * 0.92, potH * 0.55], [R, potH - 0.03], [R * 1.02, potH], [R * 0.95, potH], [R * 0.93, potH - 0.05]], 40))
    b.add('soil', cyl(R * 0.93, R * 0.93, 0.02, 32), { p: [0, potH - 0.05, 0] })
    // stems
    const tips: THREE.Vector3[] = []
    const stems = 5
    for (let i = 0; i < stems; i++) {
      const a = (i / stems) * Math.PI * 2 + r()
      const h = (H - potH) * (0.55 + r() * 0.4)
      const spread = R * (0.4 + r() * 0.8)
      const p0 = new THREE.Vector3(Math.cos(a) * R * 0.2, potH - 0.05, Math.sin(a) * R * 0.2)
      const p1 = new THREE.Vector3(Math.cos(a) * spread * 0.4, potH + h * 0.5, Math.sin(a) * spread * 0.4)
      const p2 = new THREE.Vector3(Math.cos(a) * spread, potH + h, Math.sin(a) * spread)
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p0, p1, p2]), 8, 0.012, 5, false)
      b.add('stem', g)
      tips.push(p1.clone().lerp(p2, 0.6), p2)
    }
    const parts = b.build()
    const leaves = foliageMaterial('shrub', 0.02, 0.7)
    const per = 12
    const card = new THREE.PlaneGeometry(0.42, 0.42)
    card.translate(0, 0.21, 0)
    const im = new THREE.InstancedMesh(card, leaves.material, tips.length * per)
    const mm = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const c = new THREE.Color()
    let k = 0
    for (const tip of tips)
      for (let j = 0; j < per; j++) {
        const p = tip.clone().add(new THREE.Vector3((r() - 0.5) * 0.35, (r() - 0.5) * 0.3, (r() - 0.5) * 0.35))
        q.setFromEuler(e.set((r() - 0.5) * 1.4, r() * 6.28, (r() - 0.5) * 1.4))
        const s = 0.7 + r() * 0.6
        mm.compose(p, q, new THREE.Vector3(s, s, s))
        im.setMatrixAt(k, mm)
        im.setColorAt(k, c.setHSL(0.26, 0.35, 0.55 + r() * 0.3))
        k++
      }
    im.castShadow = im.receiveShadow = true
    im.customDepthMaterial = leaves.depth
    im.computeBoundingSphere()
    return { parts, im }
  }, [config.id, R, potH, H])

  return (
    <group>
      <Parts parts={data.parts} materials={{ pot: m.glazeDark, soil: m.soil, stem: m.bark }} />
      <primitive object={data.im} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Timber column with steel base shoe                                  */
/* ------------------------------------------------------------------ */

export function Column({ config }: ModelProps) {
  const m = useModelMaterials()
  const [fx, fz] = fp(config, [0.5, 0.5])
  const H = config.height ?? 6
  const s = Math.min(fx, fz)

  const parts = useBuilt(geoKey('column', config), () => {
    const b = new Builder()
    const c = s * 0.72
    b.add('timber', rbox(c, H - 0.02, c, 0.018, 2, 'y'), { p: [0, 0.02 + (H - 0.02) / 2, 0] })
    b.add('steel', rbox(s, 0.02, s, 0.003), { p: [0, 0.01, 0] })
    // knife-plate shoe on two faces + bolt heads
    for (const sx of [-1, 1]) {
      b.add('steel', box(0.012, 0.22, c * 0.7), { p: [sx * (c / 2 + 0.006), 0.13, 0] })
      for (const y of [0.08, 0.18]) for (const z of [-c * 0.2, c * 0.2]) b.add('steel', cyl(0.012, 0.012, 0.012, 6), { p: [sx * (c / 2 + 0.018), y, z], r: [0, 0, Math.PI / 2] })
    }
    // head plate
    b.add('steel', rbox(c + 0.04, 0.02, c + 0.04, 0.003), { p: [0, H - 0.01, 0] })
    return b
  })

  return <Parts parts={parts} materials={{ timber: m.timber, steel: m.blackSteel }} />
}

/* ------------------------------------------------------------------ */
/* Theatre seating row                                                 */
/* ------------------------------------------------------------------ */

export function TheatreSeating({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [7.2, 0.62])
  const n = Math.max(1, Math.round(num(config, 'seats', 8)))

  const parts = useBuilt(geoKey('theatre-seating', config), () => {
    const b = new Builder()
    const armW = 0.07
    const pitch = (W - armW) / n
    const sw = pitch - armW - 0.01
    b.add('steel', box(W - 0.04, 0.07, 0.34), { p: [0, 0.035, -0.02] })
    for (let i = 0; i <= n; i++) {
      const x = -W / 2 + armW / 2 + i * pitch
      b.add('side', rbox(armW, 0.6, D - 0.06, 0.02, 2), { p: [x, 0.37, -0.01] })
      b.add('cap', rbox(armW + 0.012, 0.028, D - 0.12, 0.008, 2, 'z'), { p: [x, 0.684, 0.01] })
    }
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + armW + pitch * i + pitch / 2 - armW / 2
      b.add('uph', rbox(sw, 0.12, D - 0.14, 0.035, 3), { p: [x, 0.43, 0.04], r: [-0.06, 0, 0] })
      b.add('uph', rbox(sw, 0.64, 0.13, 0.04, 3), { p: [x, 0.8, -D / 2 + 0.1], r: [-0.2, 0, 0] })
      // lumbar roll
      b.add('uph', rbox(sw - 0.02, 0.14, 0.06, 0.03, 3), { p: [x, 0.56, -D / 2 + 0.17], r: [-0.2, 0, 0] })
    }
    return b
  })

  return <Parts parts={parts} materials={{ steel: m.blackSteel, side: m.upholsteryDark, cap: m.walnut, uph: m.upholstery }} />
}

/* ------------------------------------------------------------------ */
/* Speaker (trivial placeholder — the AV engineer supplies the real one) */
/* ------------------------------------------------------------------ */

export function SpeakerPlaceholder({ config }: ModelProps) {
  const m = useModelMaterials()
  const [fx, fz] = fp(config, [0.3, 0.3])
  const H = config.height ?? 0.5
  return (
    <mesh position={[0, H / 2, 0]} material={m.paintBlack} castShadow receiveShadow>
      <boxGeometry args={[fx, H, fz]} />
    </mesh>
  )
}
