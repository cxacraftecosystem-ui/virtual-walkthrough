/**
 * ArtisanCapture ('splat') — a volumetric artisan capture shown as a Gaussian splat.
 *
 * `model` → a `.splat` file rendered with drei <Splat> (antimatter15 layout, streamed).
 * drei does not read `.ksplat` (a compressed format of other viewers): convert it to `.splat`.
 * Props: `splatScale` (default 1), `splatY` (vertical offset, m), `splatRotDeg` (extra turn).
 *
 * Until a real capture exists (no `model`, an unsupported file, or a failed load) a clearly
 * labelled placeholder stands in: a softly glowing, translucent seated figure on a real
 * stool, abstracted (no face, no costume, no pose claims) — with a small card
 * "Artisan capture — coming soon". Local frame: the figure faces +z (towards its table).
 */
import { Splat } from '@react-three/drei'
import { Suspense, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ErrorBoundary } from '../utils/ErrorBoundary'
import { Builder, cyl, Parts, rbox, useBuilt } from './kit'
import { MODEL_TIME, useModelMaterials } from './modelMaterials'
import { num, str, type ModelProps } from './types'

/* ------------------------------------------------------------------ */
/* Figure geometry                                                     */
/* ------------------------------------------------------------------ */

const _up = new THREE.Vector3(0, 1, 0)

/** Capsule (radius r0 → r1 taper by scaling) between two points. */
function limb(a: [number, number, number], b: [number, number, number], r: number, taper = 1): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a)
  const B = new THREE.Vector3(...b)
  const len = A.distanceTo(B)
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 14)
  if (taper !== 1) {
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const t = THREE.MathUtils.clamp(p.getY(i) / len + 0.5, 0, 1) // 0 at a, 1 at b
      const k = 1 + (taper - 1) * t
      p.setX(i, p.getX(i) * k)
      p.setZ(i, p.getZ(i) * k)
    }
    g.computeVertexNormals()
  }
  const q = new THREE.Quaternion().setFromUnitVectors(_up, B.clone().sub(A).normalize())
  g.applyQuaternion(q)
  const mid = A.add(B).multiplyScalar(0.5)
  g.translate(mid.x, mid.y, mid.z)
  g.deleteAttribute('uv')
  return g
}

function ellipsoid(c: [number, number, number], s: [number, number, number], rotX = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 20, 14)
  g.scale(...s)
  if (rotX) g.rotateX(rotX)
  g.translate(...c)
  g.deleteAttribute('uv')
  return g
}

/** A seated figure, hands resting on a table edge ≈ `reach` in front, seat height `seat`. */
function seatedFigure(seat: number, tableH: number, reach: number): THREE.BufferGeometry {
  const hipY = seat + 0.09
  const shoulderY = hipY + 0.5
  const lean = 0.07 // torso leans slightly forward, over the work
  const parts: THREE.BufferGeometry[] = [
    // pelvis + torso (tapering towards the waist, broader shoulders)
    ellipsoid([0, hipY + 0.02, 0.0], [0.17, 0.11, 0.13]),
    limb([0, hipY + 0.04, 0], [0, shoulderY - 0.06, lean], 0.135, 1.18),
    ellipsoid([0, shoulderY - 0.02, lean], [0.2, 0.075, 0.11]),
    // neck + head (slightly bowed towards the table)
    limb([0, shoulderY + 0.01, lean + 0.005], [0, shoulderY + 0.09, lean + 0.035], 0.045),
    ellipsoid([0, shoulderY + 0.2, lean + 0.07], [0.088, 0.112, 0.1], 0.18),
  ]
  for (const s of [-1, 1]) {
    // thighs forward, shins down, feet
    const knee: [number, number, number] = [s * 0.11, seat + 0.05, 0.42]
    parts.push(limb([s * 0.1, hipY - 0.01, 0.02], knee, 0.07, 0.85))
    parts.push(limb(knee, [s * 0.115, 0.08, 0.47], 0.052, 0.78))
    parts.push(ellipsoid([s * 0.115, 0.035, 0.52], [0.05, 0.035, 0.11]))
    // arms: shoulder → elbow → hand on the table
    const sh: [number, number, number] = [s * 0.2, shoulderY - 0.05, lean]
    const el: [number, number, number] = [s * 0.25, shoulderY - 0.3, lean + 0.17]
    const hand: [number, number, number] = [s * 0.17, tableH + 0.04, reach + 0.1]
    parts.push(limb(sh, el, 0.048, 0.85))
    parts.push(limb(el, hand, 0.04, 0.8))
    parts.push(ellipsoid(hand, [0.045, 0.024, 0.07]))
  }
  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  merged.computeBoundingSphere()
  return merged
}

/* ------------------------------------------------------------------ */
/* Soft glow material (fresnel rim + gentle breathing)                 */
/* ------------------------------------------------------------------ */

function glowMaterial(color: string) {
  return new THREE.ShaderMaterial({
    name: 'artisan-glow',
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: MODEL_TIME },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vY = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.2);
        float breathe = 0.92 + 0.08 * sin(uTime * 0.9);
        // fine horizontal bands, like a capture still resolving
        float band = 0.9 + 0.1 * sin(vY * 180.0 + uTime * 1.4);
        float a = (0.15 + rim * 0.72) * breathe * band;
        gl_FragColor = vec4(uColor * (0.7 + rim * 0.8), a);
      }`,
  })
}

let haloTex: THREE.Texture | null = null
function floorHalo() {
  if (haloTex) return haloTex
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const g = cv.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255, 236, 200, 0.55)')
  grad.addColorStop(1, 'rgba(255, 236, 200, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  haloTex = new THREE.CanvasTexture(cv)
  haloTex.colorSpace = THREE.SRGBColorSpace
  return haloTex
}

function cardTexture(title: string, line: string) {
  const cv = document.createElement('canvas')
  cv.width = 640
  cv.height = 360
  const g = cv.getContext('2d')!
  g.fillStyle = '#f3ede1'
  g.fillRect(0, 0, 640, 360)
  g.strokeStyle = 'rgba(43,38,33,0.22)'
  g.lineWidth = 2
  g.strokeRect(14, 14, 612, 332)
  g.fillStyle = '#8a5a3b'
  g.font = "600 20px Inter, system-ui, sans-serif"
  g.fillText('P L A C E H O L D E R', 44, 74)
  g.fillStyle = '#2b2621'
  g.font = "500 50px 'Cormorant Garamond', Georgia, serif"
  g.fillText(title, 44, 146, 552)
  g.fillStyle = '#5d544b'
  g.font = "400 24px Inter, system-ui, sans-serif"
  // simple word wrap
  const words = line.split(' ')
  let row = ''
  let y = 204
  for (const w of words) {
    const t = row ? `${row} ${w}` : w
    if (g.measureText(t).width > 552) {
      g.fillText(row, 44, y)
      row = w
      y += 34
    } else row = t
  }
  if (row) g.fillText(row, 44, y)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/* ------------------------------------------------------------------ */
/* Placeholder                                                         */
/* ------------------------------------------------------------------ */

function CapturePlaceholder({ config }: ModelProps) {
  const m = useModelMaterials()
  const seat = num(config, 'seat', 0.6)
  const tableH = num(config, 'tableHeight', 0.86)
  const reach = num(config, 'reach', 0.42)
  const color = str(config, 'glow', '#e6eef5')
  const title = str(config, 'cardTitle', 'Artisan capture — coming soon')
  const line = str(config, 'cardText', 'A volumetric recording of a printer at work will appear here once it has been made with the workshop.')

  const figure = useMemo(() => seatedFigure(seat, tableH, reach), [seat, tableH, reach])
  useEffect(() => () => figure.dispose(), [figure])
  const glow = useMemo(() => glowMaterial(color), [color])
  useEffect(() => () => glow.dispose(), [glow])
  const card = useMemo(() => cardTexture(title, line), [title, line])
  useEffect(() => () => card.dispose(), [card])

  const stool = useBuilt(`artisan-stool|${seat}`, () => {
    const b = new Builder()
    b.add('wood', cyl(0.17, 0.17, 0.04, 24), { p: [0, seat - 0.02, 0] })
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      b.add('wood', cyl(0.019, 0.021, seat - 0.04, 8), { p: [Math.cos(a) * 0.12, (seat - 0.04) / 2, Math.sin(a) * 0.12] })
    }
    for (const r of [0, Math.PI / 2]) b.add('wood', rbox(0.25, 0.022, 0.022, 0.004, 1, 'x'), { p: [0, 0.2, 0], r: [0, r, 0] })
    // card on a slim post, beside the figure, angled to the aisle
    b.add('post', cyl(0.012, 0.012, 0.92, 8), { p: [0, 0.46, 0] })
    b.add('post', cyl(0.11, 0.12, 0.018, 20), { p: [0, 0.009, 0] })
    return b
  })

  // the card stands beside the figure (local +x), facing the same way (readable across the table)
  const cardSide = num(config, 'cardSide', 1)
  return (
    <group>
      <Parts parts={stool.filter((p) => p.key === 'wood')} materials={{ wood: m.teak }} />
      <mesh geometry={figure} material={glow} renderOrder={3} />
      <mesh position={[0, 0.004, 0.18]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <circleGeometry args={[0.62, 32]} />
        <meshBasicMaterial map={floorHalo()} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <group position={[cardSide * 0.66, 0, -0.05]} rotation={[0, -cardSide * 0.35, 0]}>
        <Parts parts={stool.filter((p) => p.key === 'post')} materials={{ post: m.blackSteel }} />
        <group position={[0, 0.98, 0]} rotation={[-0.35, 0, 0]}>
          <mesh material={m.darkTimber} castShadow>
            <boxGeometry args={[0.34, 0.2, 0.014]} />
          </mesh>
          <mesh position={[0, 0, 0.0075]}>
            <planeGeometry args={[0.32, 0.18]} />
            <meshStandardMaterial map={card} roughness={0.85} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/** Real capture: drei <Splat> gently turned/scaled into the object's frame. */
function SplatCapture({ config, src }: ModelProps & { src: string }) {
  const s = num(config, 'splatScale', 1)
  const y = num(config, 'splatY', 0)
  const r = THREE.MathUtils.degToRad(num(config, 'splatRotDeg', 0))
  return <Splat src={src} position={[0, y, 0]} rotation={[0, r, 0]} scale={s} alphaTest={0.08} />
}

function WarnOnce({ msg }: { msg: string }) {
  useEffect(() => console.info(`[museum] ${msg}`), [msg])
  return null
}

export function ArtisanCapture({ config }: ModelProps) {
  const src = config.model ?? ''
  const placeholder = <CapturePlaceholder config={config} />
  if (!src) return placeholder
  if (!/\.splat(\?|#|$)/i.test(src)) {
    return (
      <>
        <WarnOnce msg={`${config.id}: "${src}" is not a .splat file (drei <Splat> reads .splat only; convert .ksplat/.ply) — showing the placeholder`} />
        {placeholder}
      </>
    )
  }
  return (
    <ErrorBoundary key={src} fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <SplatCapture config={config} src={src} />
      </Suspense>
    </ErrorBoundary>
  )
}
