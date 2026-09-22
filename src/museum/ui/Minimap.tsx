import { useEffect, useMemo, useRef, useState } from 'react'
import { useMuseum } from '../state/store'
import { teleport, visitor } from '../state/visitor'
import { BENCHES, BENCH_SIZE, WALLS, ZONES, zoneAt, type Zone, type ZoneId } from '../config/layout'
import { SCENE_OBJECTS } from '../config/objects'
import { IconMap, IconMinus } from './icons'

/* ------------------------------------------------------------------ */
/* Travel fade (shared by minimap "go to" and HUD reset)               */
/* ------------------------------------------------------------------ */

const FADE_MS = 450
type FadeListener = (on: boolean) => void
const fadeListeners = new Set<FadeListener>()
let travelling = false

/** Fade to warm white, run `move` while hidden, fade back. */
export function travel(move: () => void) {
  if (travelling) return
  travelling = true
  if (fadeListeners.size === 0) {
    move()
    travelling = false
    return
  }
  fadeListeners.forEach((l) => l(true))
  window.setTimeout(() => {
    try {
      move()
    } finally {
      window.setTimeout(() => {
        fadeListeners.forEach((l) => l(false))
        travelling = false
      }, 120)
    }
  }, FADE_MS)
}

export function TravelFade() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    fadeListeners.add(setOn)
    return () => {
      fadeListeners.delete(setOn)
    }
  }, [])
  return <div className={`ui-fade${on ? ' is-on' : ''}`} aria-hidden="true" />
}

/* ------------------------------------------------------------------ */
/* Map geometry                                                        */
/* ------------------------------------------------------------------ */

const PAD = 1.1
const bounds = (() => {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const w of WALLS) {
    minX = Math.min(minX, w.min[0])
    maxX = Math.max(maxX, w.max[0])
    minZ = Math.min(minZ, w.min[2])
    maxZ = Math.max(maxZ, w.max[2])
  }
  return { minX: minX - PAD, maxX: maxX + PAD, minZ: minZ - PAD, maxZ: maxZ + PAD }
})()

/** Plan aspect (width / height) — the SVG sizes itself from this. */
export const MAP_ASPECT = (bounds.maxX - bounds.minX) / (bounds.maxZ - bounds.minZ)

const VIEWBOX = `${bounds.minX} ${bounds.minZ} ${bounds.maxX - bounds.minX} ${bounds.maxZ - bounds.minZ}`

interface ZoneLabel {
  small: string
  big?: string
  vertical?: boolean
  /** Font size in metres (plan units). */
  size: number
  /** Label anchor (defaults to the rect centre). */
  at?: [number, number]
}

/** Label shown in the plan, sized to the room; galleries use a big letter. */
function zoneLabel(z: Zone): ZoneLabel {
  const r = z.rect
  const cx = (r.minX + r.maxX) / 2
  if (z.id.startsWith('gallery-')) return { small: 'Gallery', big: z.id.slice(-1).toUpperCase(), size: 0.72, at: [cx, r.minZ + 2.6] }
  if (z.id === 'passage') return { small: z.short, vertical: true, size: 0.85 }
  if (z.id === 'reception') return { small: z.short, vertical: true, size: 0.7 }
  if (z.id === 'reveal') return { small: z.short, size: 0.8, at: [cx, r.minZ + 1.05] }
  return { small: z.short, size: 1.3 }
}

/** Furniture & installations drawn faintly for orientation (skip foliage/props). */
const PLAN_OBJECTS = SCENE_OBJECTS.filter((o) => o.footprint && !['tree', 'planter'].includes(o.kind))

const CONE_LEN = 4.6
const CONE_HALF = (34 * Math.PI) / 180
const CONE_PATH = `M0 0 L${-Math.sin(CONE_HALF) * CONE_LEN} ${-Math.cos(CONE_HALF) * CONE_LEN} A${CONE_LEN} ${CONE_LEN} 0 0 1 ${
  Math.sin(CONE_HALF) * CONE_LEN
} ${-Math.cos(CONE_HALF) * CONE_LEN} Z`

export function Minimap() {
  const phase = useMuseum((s) => s.phase)
  const mapOpen = useMuseum((s) => s.mapOpen)
  const setMapOpen = useMuseum((s) => s.setMapOpen)
  const selection = useMuseum((s) => s.selection)
  const inspecting = useMuseum((s) => s.inspecting)
  const markerRef = useRef<SVGGElement>(null)
  const [current, setCurrent] = useState<ZoneId | undefined>(undefined)
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 720)

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= 720)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Per-frame marker update (no React re-render).
  useEffect(() => {
    if (!mapOpen || phase !== 'entered') return
    let raf = 0
    let lastZone: ZoneId | undefined
    let frame = 0
    const tick = () => {
      const g = markerRef.current
      if (g) {
        const deg = (-visitor.yaw * 180) / Math.PI
        g.setAttribute('transform', `translate(${visitor.x.toFixed(3)} ${visitor.z.toFixed(3)}) rotate(${deg.toFixed(2)})`)
      }
      if (frame++ % 15 === 0) {
        const z = zoneAt(visitor.x, visitor.z)?.id
        if (z !== lastZone) {
          lastZone = z
          setCurrent(z)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mapOpen, phase])

  const walls = useMemo(
    () =>
      WALLS.filter((w) => w.collide !== false).map((w) => (
        <rect
          key={w.id}
          className={`ui-map__wall ui-map__wall--${w.kind}`}
          x={w.min[0]}
          y={w.min[2]}
          width={w.max[0] - w.min[0]}
          height={w.max[2] - w.min[2]}
        />
      )),
    [],
  )

  const benches = useMemo(
    () => [
      ...BENCHES.map((b) => {
        const w = b.along === 'x' ? BENCH_SIZE.length : BENCH_SIZE.depth
        const h = b.along === 'x' ? BENCH_SIZE.depth : BENCH_SIZE.length
        return <rect key={b.id} className="ui-map__bench" x={b.x - w / 2} y={b.z - h / 2} width={w} height={h} rx={0.06} />
      }),
      ...PLAN_OBJECTS.map((o) => {
        const rot = ((((o.rotationDeg ?? 0) % 180) + 180) % 180)
        const swap = Math.abs(rot - 90) < 45
        const [fx, fz] = o.footprint!
        const w = swap ? fz : fx
        const h = swap ? fx : fz
        return <rect key={o.id} className="ui-map__bench ui-map__object" x={o.position[0] - w / 2} y={o.position[2] - h / 2} width={w} height={h} rx={0.08} />
      }),
    ],
    [],
  )

  if (phase !== 'entered') return null

  const go = (z: Zone) => {
    travel(() => teleport(z.spawn.x, z.spawn.z, z.spawn.yawDeg))
    if (narrow) setMapOpen(false)
  }

  // On phones the map yields to the info sheet.
  const hiddenForSheet = narrow && (!!selection || !!inspecting)

  return (
    <div className="ui-map" style={hiddenForSheet ? { opacity: 0, pointerEvents: 'none' } : undefined}>
      {mapOpen ? (
        <div className="ui-map__card ui-panel ui-interactive">
          <div className="ui-map__head">
            <span className="ui-kicker">Floor plan</span>
            <button type="button" className="ui-icon-btn" aria-label="Hide map (M)" onClick={() => setMapOpen(false)}>
              <IconMinus />
            </button>
          </div>
          <svg className="ui-map__svg" viewBox={VIEWBOX} style={{ aspectRatio: String(MAP_ASPECT) }} role="group" aria-label="Floor plan — select a room to go there">
            <defs>
              <radialGradient id="ui-map-cone" cx="0" cy="0" r={CONE_LEN} gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#8a5a3b" stopOpacity="0.42" />
                <stop offset="1" stopColor="#8a5a3b" stopOpacity="0" />
              </radialGradient>
            </defs>

            {ZONES.map((z) => (
              <rect
                key={`f-${z.id}`}
                className={`ui-map__floor ui-map__floor--${z.id}`}
                x={z.rect.minX}
                y={z.rect.minZ}
                width={z.rect.maxX - z.rect.minX}
                height={z.rect.maxZ - z.rect.minZ}
              />
            ))}

            {benches}
            {walls}

            {ZONES.map((z) => {
              const l = zoneLabel(z)
              const [cx, cy] = l.at ?? [(z.rect.minX + z.rect.maxX) / 2, (z.rect.minZ + z.rect.maxZ) / 2]
              const isCur = current === z.id
              return (
                <g key={z.id} className={`ui-map__zone-g${isCur ? ' is-current' : ''}`}>
                  <rect
                    className={`ui-map__zone${isCur ? ' is-current' : ''}`}
                    x={z.rect.minX}
                    y={z.rect.minZ}
                    width={z.rect.maxX - z.rect.minX}
                    height={z.rect.maxZ - z.rect.minZ}
                    role="button"
                    tabIndex={0}
                    aria-label={`Go to ${z.name}`}
                    onClick={() => go(z)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        go(z)
                      }
                    }}
                  >
                    <title>{`Go to ${z.name}`}</title>
                  </rect>
                  {l.big ? (
                    <>
                      <text className="ui-map__label" x={cx} y={cy - 1.75} style={{ fontSize: l.size }}>
                        {l.small}
                      </text>
                      <text className="ui-map__label ui-map__label--big" x={cx} y={cy + 0.35}>
                        {l.big}
                      </text>
                    </>
                  ) : (
                    <text
                      className={`ui-map__label${l.size >= 1.2 ? ' ui-map__label--room' : ''}`}
                      x={cx}
                      y={cy}
                      dominantBaseline="middle"
                      style={{ fontSize: l.size }}
                      transform={l.vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
                    >
                      {l.small}
                    </text>
                  )}
                </g>
              )
            })}

            <g ref={markerRef} style={{ pointerEvents: 'none' }}>
              <path className="ui-map__cone" d={CONE_PATH} />
              <circle className="ui-map__dot" r={0.5} />
            </g>

            <g transform={`translate(${bounds.minX + 1.3} ${bounds.minZ + 1.5}) scale(1.9)`} aria-hidden="true">
              <path d="M0 -0.42 L0.2 0.18 L0 0.06 L-0.2 0.18 Z" fill="#6f665c" />
              <text className="ui-map__north" y={0.78}>
                N
              </text>
            </g>
          </svg>
        </div>
      ) : (
        <button type="button" className="ui-map__toggle ui-panel" aria-label="Show map (M)" onClick={() => setMapOpen(true)}>
          <IconMap />
          <span>Map</span>
        </button>
      )}
    </div>
  )
}
