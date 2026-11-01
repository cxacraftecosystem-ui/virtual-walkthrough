/**
 * Staff tools in the museum (curator, admin, master): a small dock, toggled with Shift+S or the HUD
 * button, that helps curators place and check content without guessing numbers.
 *
 *   Placement     live x / z / heading / room, the display surface under the centre of the view
 *                 with its `at` and height, the nearest surface, and "Copy placement" — the
 *                 { surface, at, centerHeight } an admin placement field takes.
 *   Tour          "Copy view as tour stop" (TourStop JSON) and "Add to tour", which appends the
 *                 current view to this exhibition's tour through the admin tour endpoint.
 *   Needs content every placed item still flagged `placeholder`, as a list and as chips in the view;
 *                 choosing one walks to it and opens its panel.
 *
 * Loaded on demand by StaffGate.tsx, so visitors never download it. Everything is read through the
 * layout API (SURFACES, zoneAt, surfacePoint), so it works for any building.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ARTWORKS } from '../config/artworks'
import { EXHIBITS } from '../config/exhibits'
import { INFOGRAPHICS } from '../config/infographics'
import { MUSEUM } from '../config/museum'
import { SCENE_OBJECTS } from '../config/objects'
import { VIDEOS } from '../config/videos'
import { BUNDLED_TOUR_STOPS, TOUR_STOPS } from '../config/tour'
import { SURFACES, WALLS, surfacePoint, zoneAt, type SurfaceId } from '../config/layout'
import { CURRENT_EXHIBITION, TOUR_OVERRIDE } from '../content/exhibition'
import { tablePlacement } from '../exhibits/placement'
import { getItem } from '../interaction/registry'
import { useArrival } from '../navigation/ArrivalFlight'
import { copyText } from '../share/deepLink'
import { useMuseum, type Selection, type SelectionKind } from '../state/store'
import { visitor } from '../state/visitor'
import { goToItem } from '../tour/navigate'
import { useTour } from '../tour/engine'
import { itemSummary } from '../ui/items'
import { usePhoto } from '../ui/PhotoMode'
import { IconClose } from '../ui/icons'
import {
  aimSurface,
  atAxisLabel,
  cameraFov,
  compassDeg,
  lineBlocked,
  nearestSurface,
  projectPoint,
  round,
  viewDirection,
  type AimHit,
  type Box3,
  type NearestSurface,
  type SurfaceGeom,
  type Vec3,
} from './geometry'
import { adminEditHref, selectAdminExhibition } from './links'
import { STAFF_TOGGLE_ID, setStaffOpen, useStaff } from './staffStore'
import { appendStop, asStops, stopFromView, type CapturedStop } from './tourStop'
import './staff.css'

const V = MUSEUM.visitor
const SURFACE_LIST = Object.values(SURFACES) as readonly SurfaceGeom[]

/**
 * Straight walls that block the view. A wall's box is only a faithful shape when it is thin; the box
 * around a curved wall would swallow the room it encloses, so those are left to the surfaces.
 */
const OCCLUDERS: readonly Box3[] = WALLS.filter((w) => w.render !== false && Math.min(w.max[0] - w.min[0], w.max[2] - w.min[2]) <= 1).map((w) => ({ min: w.min, max: w.max }))

const KIND_LABEL: Record<SelectionKind, string> = { artwork: 'Artwork', exhibit: 'Exhibit', infographic: 'Panel', video: 'Film', object: 'Object' }

/* ------------------------------------------------------------------ */
/* Live view sampling                                                  */
/* ------------------------------------------------------------------ */

interface ViewSample {
  x: number
  z: number
  yawDeg: number
  pitchDeg: number
  zoneId: string | null
  zoneName: string
  aim: AimHit | null
  nearest: NearestSurface | null
}

function sampleView(): ViewSample {
  const zone = zoneAt(visitor.x, visitor.z)
  const eye: Vec3 = [visitor.x, V.eyeHeight, visitor.z]
  return {
    x: visitor.x,
    z: visitor.z,
    yawDeg: compassDeg(visitor.yaw),
    pitchDeg: (visitor.pitch * 180) / Math.PI,
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? 'Outside',
    aim: aimSurface(SURFACE_LIST, eye, viewDirection(visitor.yaw, visitor.pitch), OCCLUDERS),
    nearest: nearestSurface(SURFACE_LIST, visitor.x, visitor.z, zone?.id),
  }
}

/** Re-sample about ten times a second while mounted (the visitor state is not React state). */
function useViewSample(active: boolean) {
  const [s, setS] = useState<ViewSample | null>(null)
  useEffect(() => {
    if (!active) return
    let last = ''
    const tick = () => {
      const next = sampleView()
      const a = next.aim
      const n = next.nearest
      // Re-render only when something shown would change.
      const key = [next.x, next.z, next.yawDeg, next.pitchDeg].map((v) => v.toFixed(2)).join() + `|${next.zoneId}|${a ? `${a.surface.id}:${a.at.toFixed(2)}:${a.y.toFixed(2)}` : ''}|${n ? `${n.surface.id}:${n.at.toFixed(2)}` : ''}`
      if (key !== last) {
        last = key
        setS(next)
      }
    }
    tick()
    const t = window.setInterval(tick, 100)
    return () => window.clearInterval(t)
  }, [active])
  return s
}

/** `{ surface, at, centerHeight }` for the aimed point, else the nearest wall at the visitor's position. */
function placementFrom(s: ViewSample) {
  if (s.aim) {
    const h = Math.min(s.aim.surface.height, Math.max(0, s.aim.y))
    return { surface: s.aim.surface.id, at: round(s.aim.at), centerHeight: round(h) }
  }
  if (s.nearest) return { surface: s.nearest.surface.id, at: round(s.nearest.at), centerHeight: MUSEUM.display.artworkCenterHeight }
  return null
}

/* ------------------------------------------------------------------ */
/* Items still waiting for content                                     */
/* ------------------------------------------------------------------ */

interface PendingItem {
  kind: SelectionKind
  id: string
  title: string
  anchor: Vec3
}

/** Where to pin an item's chip: the live registry first (exact), else its configured placement. */
function anchorOf(kind: SelectionKind, id: string): Vec3 | null {
  const reg = getItem(kind, id)
  if (reg) return [reg.center[0], reg.center[1] + reg.size[1] / 2 + 0.18, reg.center[2]]
  const onWall = (surface: SurfaceId, at: number, y: number): Vec3 | null => (surface in SURFACES ? (surfacePoint(surface, at, y, 0.06).position as Vec3) : null)
  switch (kind) {
    case 'artwork': {
      const a = ARTWORKS.find((x) => x.id === id)
      return a ? onWall(a.placement.surface, a.placement.at, (a.placement.centerHeight ?? MUSEUM.display.artworkCenterHeight) + 0.9) : null
    }
    case 'infographic': {
      const g = INFOGRAPHICS.find((x) => x.id === id)
      return g ? onWall(g.placement.surface, g.placement.at, (g.placement.centerHeight ?? MUSEUM.display.artworkCenterHeight) + g.height / 2 + 0.18) : null
    }
    case 'video': {
      const v = VIDEOS.find((x) => x.id === id)
      if (!v) return null
      if (v.stand) return [v.stand.x, v.placement.centerHeight + 0.6, v.stand.z]
      return onWall(v.placement.surface, v.placement.at, v.placement.centerHeight + (v.width * 0.5625) / 2 + 0.18)
    }
    case 'exhibit': {
      const e = EXHIBITS.find((x) => x.id === id)
      if (!e || !(e.placement.surface in SURFACES)) return null
      const r = tablePlacement(e).rect
      return [(r.minX + r.maxX) / 2, 1.35, (r.minZ + r.maxZ) / 2]
    }
    case 'object': {
      const o = SCENE_OBJECTS.find((x) => x.id === id)
      return o ? [o.position[0], o.position[1] + (o.height ?? 1.2) + 0.25, o.position[2]] : null
    }
  }
}

function pendingItems(): PendingItem[] {
  const out: PendingItem[] = []
  const add = (kind: SelectionKind, list: readonly { id: string; title: string; placeholder?: boolean }[]) => {
    for (const it of list) {
      if (!it.placeholder) continue
      const anchor = anchorOf(kind, it.id)
      if (anchor) out.push({ kind, id: it.id, title: it.title, anchor })
    }
  }
  add('artwork', ARTWORKS)
  add('exhibit', EXHIBITS)
  add('infographic', INFOGRAPHICS)
  add('video', VIDEOS)
  add('object', SCENE_OBJECTS)
  return out
}

function focusItem(kind: SelectionKind, id: string) {
  const ok = goToItem(kind, id, () => useMuseum.getState().select({ kind, id }))
  if (!ok) useMuseum.getState().select({ kind, id })
}

/* ------------------------------------------------------------------ */
/* Requests and messages                                               */
/* ------------------------------------------------------------------ */

class StaffRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(method: 'GET' | 'PUT', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    // The tour is read just before it is written back: never from a cache.
    cache: 'no-store',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = (res.headers.get('content-type') ?? '').includes('json') ? ((await res.json().catch(() => null)) as { error?: string; message?: string } | null) : null
  if (!res.ok) throw new StaffRequestError(res.status, (data?.error === 'conflict' ? data.message : data?.error) ?? res.statusText ?? 'Request failed')
  return data as T
}

function requestMessage(e: unknown): string {
  if (e instanceof StaffRequestError) {
    if (e.status === 401) return 'Your session has ended. Sign in again, then retry.'
    if (e.status === 403) return 'This account can’t change the tour. Ask an admin for curator access.'
    if (e.status === 404) return 'This exhibition wasn’t found on the server.'
    return e.message
  }
  return 'The server couldn’t be reached. Check the connection and try again.'
}

type Note = { text: string; tone: 'ok' | 'error' } | null

function useNote() {
  const [note, setNote] = useState<Note>(null)
  const timer = useRef(0)
  const say = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    window.clearTimeout(timer.current)
    setNote({ text, tone })
    timer.current = window.setTimeout(() => setNote(null), tone === 'error' ? 7000 : 3500)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { note, say }
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

function isTypingTarget(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable
}

const blockedByOtherUi = () => {
  const s = useMuseum.getState()
  return s.phase !== 'entered' || !!s.inspecting || usePhoto.getState().on
}

function closeDock(returnFocus: boolean) {
  setStaffOpen(false)
  if (returnFocus) document.getElementById(STAFF_TOGGLE_ID)?.focus({ preventScroll: true })
}

/**
 * Shift+S toggles the dock. It listens in the capture phase and stops the event there, so the walking
 * controller never sees the S (it would step backwards). Esc outside the dock closes it when nothing
 * nearer claims it (the overlay's own Esc handling marks the events it uses).
 */
function useStaffKeys(dockRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onCapture = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !e.shiftKey || e.repeat) return
      if (e.key !== 'S' && e.key !== 's') return
      if (isTypingTarget(e.target) || blockedByOtherUi()) return
      e.preventDefault()
      e.stopPropagation()
      const open = !useStaff.getState().open
      setStaffOpen(open)
      if (!open && dockRef.current?.contains(document.activeElement)) document.getElementById(STAFF_TOGGLE_ID)?.focus({ preventScroll: true })
    }
    // Esc inside the dock is handled by the dock itself (see StaffMode); this is Esc anywhere else.
    const onBubble = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !useStaff.getState().open || isTypingTarget(e.target)) return
      const s = useMuseum.getState()
      if (s.helpOpen || s.selection || s.drawer || s.auth || s.inspecting || usePhoto.getState().on || useTour.getState().active) return
      e.preventDefault()
      closeDock(false)
    }
    window.addEventListener('keydown', onCapture, true)
    window.addEventListener('keydown', onBubble)
    return () => {
      window.removeEventListener('keydown', onCapture, true)
      window.removeEventListener('keydown', onBubble)
    }
  }, [dockRef])
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

const fmt = (v: number, d = 2) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(d)

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="staff-sec" aria-labelledby={id}>
      <h3 id={id} className="ui-kicker staff-sec__title">
        {title}
      </h3>
      {children}
    </section>
  )
}

function SurfaceLine({ label, s, at, y }: { label: string; s: SurfaceGeom; at: number; y?: number }) {
  const [lo, hi] = [Math.min(s.range[0], s.range[1]), Math.max(s.range[0], s.range[1])]
  return (
    <div className="staff-surface">
      <div className="staff-surface__head">
        <span className="staff-surface__label">{label}</span>
        <code className="staff-code">{s.id}</code>
      </div>
      {s.label && <div className="staff-surface__name">{s.label}</div>}
      <dl className="staff-grid">
        <dt>at</dt>
        <dd>
          {fmt(at)} <small>{atAxisLabel(s)}</small>
        </dd>
        {y !== undefined && (
          <>
            <dt>height</dt>
            <dd>{fmt(y)} m</dd>
          </>
        )}
        <dt>range</dt>
        <dd>
          {fmt(lo, 1)} – {fmt(hi, 1)}
        </dd>
      </dl>
    </div>
  )
}

function PlacementSection({ view, say }: { view: ViewSample | null; say: (t: string, tone?: 'ok' | 'error') => void }) {
  if (!view) return null
  const placement = placementFrom(view)
  return (
    <Section title="Placement">
      <dl className="staff-grid staff-grid--pos">
        <dt>x</dt>
        <dd>{fmt(view.x)}</dd>
        <dt>z</dt>
        <dd>{fmt(view.z)}</dd>
        <dt>heading</dt>
        <dd>{fmt(view.yawDeg, 0)}°</dd>
        <dt>room</dt>
        <dd>{view.zoneName}</dd>
      </dl>
      {view.aim ? (
        <SurfaceLine label="In view" s={view.aim.surface} at={view.aim.at} y={view.aim.y} />
      ) : (
        <p className="staff-muted">Point the centre of the view at a display wall to read its position.</p>
      )}
      {view.nearest && (!view.aim || view.nearest.surface.id !== view.aim.surface.id) && <SurfaceLine label="Nearest" s={view.nearest.surface} at={view.nearest.at} />}
      <button
        type="button"
        className="ui-btn ui-btn--ghost ui-btn--sm staff-btn"
        disabled={!placement}
        onClick={async () => {
          if (!placement) return
          const ok = await copyText(JSON.stringify(placement))
          say(ok ? `Placement copied: ${placement.surface} at ${placement.at}${view.aim ? '' : ' (nearest wall, at your position)'}` : 'Couldn’t copy to the clipboard.', ok ? 'ok' : 'error')
        }}
      >
        Copy placement
      </button>
    </Section>
  )
}

function focusedItem(): Selection | null {
  const s = useMuseum.getState()
  if (s.selection) return s.selection
  return s.nearby ? { kind: s.nearby.kind, id: s.nearby.id } : null
}

/** The current view as a stop, titled after the item in focus (open panel, else the one nearby) or the room. */
function currentStop(): CapturedStop {
  const zone = zoneAt(visitor.x, visitor.z)
  const item = focusedItem()
  const title = (item && itemSummary(item.kind, item.id)?.title) || zone?.name || 'Stop'
  return stopFromView(visitor, { place: zone?.name ?? '', title, item, taken: TOUR_STOPS.map((s) => s.id) })
}

function TourSection({ say }: { say: (t: string, tone?: 'ok' | 'error') => void }) {
  // The view is captured when the form opens; looking around while writing the caption doesn't move the stop.
  const [form, setForm] = useState<{ title: string; text: string; item: Selection | null; draft: CapturedStop } | null>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const formId = useId()

  const formOpen = !!form
  // Focus the title when the form opens (not on every keystroke).
  useEffect(() => {
    if (formOpen) titleRef.current?.focus({ preventScroll: true })
  }, [formOpen])

  const openForm = () => {
    const draft = currentStop()
    setForm({ title: draft.title, text: '', item: draft.item ?? null, draft })
  }

  const add = async () => {
    if (!form || busy) return
    const title = form.title.trim()
    if (!title) {
      say('Give the stop a title.', 'error')
      titleRef.current?.focus()
      return
    }
    setBusy(true)
    const ex = encodeURIComponent(CURRENT_EXHIBITION.id)
    try {
      const content = await call<{ tour?: unknown }>('GET', `/api/content?exhibition=${ex}`)
      // No stored tour means visitors follow the bundled one: extend that rather than replace it.
      const base = asStops(content?.tour) ?? (structuredClone(BUNDLED_TOUR_STOPS) as unknown as Record<string, unknown>[])
      const draft: CapturedStop = { ...form.draft, title, text: form.text.trim() }
      if (form.item) draft.item = form.item
      else delete draft.item
      const { stops, stop } = appendStop(base, draft)
      const saved = await call<{ stops: unknown }>('PUT', `/api/admin/content/tour?exhibition=${ex}`, { stops })
      const next = asStops(saved?.stops)
      if (next) {
        // Play the new tour here at once (the visitor engine reads TOUR_STOPS in place).
        TOUR_OVERRIDE.stops = next as unknown as typeof TOUR_STOPS
        TOUR_STOPS.splice(0, TOUR_STOPS.length, ...(next as unknown as typeof TOUR_STOPS))
      }
      say(`Added “${stop.title}” as stop ${stops.length} of the tour.`)
      setForm(null)
    } catch (e) {
      say(requestMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Tour">
      <div className="staff-row">
        <button
          type="button"
          className="ui-btn ui-btn--ghost ui-btn--sm staff-btn"
          onClick={async () => {
            const ok = await copyText(JSON.stringify(currentStop(), null, 2))
            say(ok ? 'Tour stop copied.' : 'Couldn’t copy to the clipboard.', ok ? 'ok' : 'error')
          }}
        >
          Copy view as tour stop
        </button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm staff-btn" aria-expanded={!!form} aria-controls={formId} onClick={() => (form ? setForm(null) : openForm())}>
          Add to tour
        </button>
      </div>
      {form && (
        <form
          id={formId}
          className="staff-form"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <p className="staff-muted">
            Saves this view — x {fmt(form.draft.view.x)}, z {fmt(form.draft.view.z)}, heading {fmt(form.draft.view.yawDeg, 0)}° — as the last stop of this exhibition’s tour. Visitors see it straight away.
          </p>
          <label className="staff-field">
            <span>Title</span>
            <input ref={titleRef} type="text" value={form.title} maxLength={120} required onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="staff-field">
            <span>Caption</span>
            <textarea rows={3} value={form.text} maxLength={1200} placeholder="What the visitor is looking at" onChange={(e) => setForm({ ...form, text: e.target.value })} />
          </label>
          {form.item && (
            <label className="staff-check">
              <input type="checkbox" checked onChange={() => setForm({ ...form, item: null })} />
              <span>
                Link {KIND_LABEL[form.item.kind].toLowerCase()} <code className="staff-code">{form.item.id}</code>
              </span>
            </label>
          )}
          <div className="staff-row">
            <button type="submit" className="ui-btn ui-btn--sm staff-btn" disabled={busy} aria-busy={busy}>
              {busy ? 'Saving…' : 'Add stop'}
            </button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm staff-btn" disabled={busy} onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Section>
  )
}

function PendingSection({ items }: { items: PendingItem[] }) {
  const highlight = useStaff((s) => s.highlight)
  const sorted = useMemo(() => {
    if (!highlight) return []
    return [...items].sort((a, b) => Math.hypot(a.anchor[0] - visitor.x, a.anchor[2] - visitor.z) - Math.hypot(b.anchor[0] - visitor.x, b.anchor[2] - visitor.z))
  }, [items, highlight])
  return (
    <Section title="Needs content">
      <label className="staff-check">
        <input type="checkbox" checked={highlight} onChange={(e) => useStaff.setState({ highlight: e.target.checked })} />
        <span>
          Show items needing content <span className="staff-count">{items.length}</span>
        </span>
      </label>
      {highlight &&
        (sorted.length ? (
          <ul className="staff-list" aria-label="Items needing content, nearest first">
            {sorted.map((it) => (
              <li key={`${it.kind}:${it.id}`}>
                <button type="button" className="staff-list__item" onClick={() => focusItem(it.kind, it.id)}>
                  <span className="staff-list__kind">{KIND_LABEL[it.kind]}</span>
                  <span className="staff-list__title">{it.title || it.id}</span>
                </button>
                <a className="staff-list__edit" href={adminEditHref(it.kind, it.id)} target="_blank" rel="noopener" aria-label={`Edit ${it.title || it.id} in admin (opens a new tab)`} onClick={() => selectAdminExhibition(CURRENT_EXHIBITION.id)}>
                  Edit
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="staff-muted">Every placed item in this exhibition has its content.</p>
        ))}
    </Section>
  )
}

/**
 * Chips over every placeholder item in front of the camera. Positions are written straight to the
 * DOM each frame (no React work per frame); items hidden behind a wall stay faint.
 */
function PendingChips({ items }: { items: PendingItem[] }) {
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const reduced = useMuseum((s) => s.reducedMotion)
  useEffect(() => {
    let raf = 0
    let frame = 0
    const hidden = new Map<string, boolean>()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const w = window.innerWidth
      const h = window.innerHeight
      const cam = { x: visitor.x, y: V.eyeHeight, z: visitor.z, yaw: visitor.yaw, pitch: visitor.pitch, fovDeg: cameraFov(w, h, V.fov, V.minHorizontalFov), aspect: w / Math.max(1, h) }
      const flying = useArrival.getState().active
      // Visibility through walls is dearer than projection: refresh it a few times a second.
      const checkSight = frame++ % 6 === 0
      for (const it of items) {
        const el = refs.current.get(`${it.kind}:${it.id}`)
        if (!el) continue
        const p = flying ? null : projectPoint(cam, it.anchor)
        if (!p || p.depth > 45 || Math.abs(p.x) > 1.15 || Math.abs(p.y) > 1.15) {
          el.style.visibility = 'hidden'
          continue
        }
        if (checkSight || !hidden.has(el.dataset.key!)) hidden.set(el.dataset.key!, lineBlocked(SURFACE_LIST, [cam.x, cam.y, cam.z], it.anchor, OCCLUDERS, 0.3))
        const sx = ((p.x + 1) / 2) * w
        const sy = ((1 - p.y) / 2) * h
        el.style.visibility = 'visible'
        el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`
        el.classList.toggle('is-behind', !!hidden.get(el.dataset.key!))
        el.style.zIndex = String(1000 - Math.round(p.depth * 10))
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [items])
  return (
    <div className={`staff-chips${reduced ? ' is-still' : ''}`}>
      {items.map((it) => {
        const key = `${it.kind}:${it.id}`
        return (
          <button
            key={key}
            data-key={key}
            ref={(el) => {
              if (el) refs.current.set(key, el)
              else refs.current.delete(key)
            }}
            type="button"
            className="staff-chip"
            style={{ visibility: 'hidden' }}
            onClick={() => focusItem(it.kind, it.id)}
            aria-label={`${it.title || it.id} needs content — go to it`}
          >
            <span className="staff-chip__dot" aria-hidden="true" />
            <span className="staff-chip__text">{it.title || it.id}</span>
          </button>
        )
      })}
    </div>
  )
}

export function StaffMode() {
  const open = useStaff((s) => s.open)
  const highlight = useStaff((s) => s.highlight)
  const entered = useMuseum((s) => s.phase === 'entered')
  const photo = usePhoto((s) => s.on)
  // The overlay draws its own crosshair in mouse look; otherwise mark the point the readout measures.
  const mouseLook = useMuseum((s) => s.mouseLook)
  const dockRef = useRef<HTMLElement>(null)
  const { note, say } = useNote()
  useStaffKeys(dockRef)

  const shown = open && entered && !photo
  const view = useViewSample(shown)

  // Placeholder items: re-read whenever the dock opens or marking is turned on (content may have been
  // edited and reloaded meanwhile); the panel's live registry settles a moment after entering.
  const [items, setItems] = useState<PendingItem[]>([])
  useEffect(() => {
    if (!open && !highlight) return
    setItems(pendingItems())
    const t = window.setTimeout(() => setItems(pendingItems()), 1500)
    return () => window.clearTimeout(t)
  }, [open, highlight, entered])

  return (
    <>
      {highlight && entered && !photo && <PendingChips items={items} />}
      {shown && !mouseLook && <div className="staff-reticle" aria-hidden="true" />}
      {shown && (
        <aside
          ref={dockRef}
          className="staff-dock ui-panel ui-interactive"
          aria-label="Staff tools"
          onKeyDown={(e) => {
            // Esc from anywhere in the dock (fields included) closes it before the overlay sees the key.
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            closeDock(true)
          }}
        >
          <header className="staff-dock__head">
            <div>
              <div className="ui-kicker">Staff</div>
              <h2 className="staff-dock__title">{CURRENT_EXHIBITION.title || CURRENT_EXHIBITION.id}</h2>
            </div>
            <button type="button" className="ui-icon-btn" aria-label="Close staff tools" data-tip="Close (Esc)" onClick={() => closeDock(true)}>
              <IconClose />
            </button>
          </header>
          <div className="staff-dock__body">
            <PlacementSection view={view} say={say} />
            <TourSection say={say} />
            <PendingSection items={items} />
          </div>
          <p className={`staff-note${note ? ` is-${note.tone}` : ''}`} role="status" aria-live="polite">
            {note?.text ?? ''}
          </p>
        </aside>
      )}
    </>
  )
}
