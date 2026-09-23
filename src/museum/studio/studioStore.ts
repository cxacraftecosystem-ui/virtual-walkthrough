/**
 * State of the "Print it yourself" studio (zustand, independent of the museum store).
 *
 * The design itself lives in one module-level canvas (`designCanvas()`), redrawn from
 * `ground + ops`; `version` increments whenever it changes so the 3D printing table and
 * the overlay can refresh their views. The design is kept in localStorage per browser.
 */
import { create } from 'zustand'
import { hashString } from '../exhibits/motifs'
import { COLOURWAYS, getBlock, type BlockId, type BlockLayer } from './palette'
import { borderSlots, cornerSize, DESIGN_H, DESIGN_W, makeCanvas, renderDesign, renderStamp, type GuideMode, type StampOp } from './printEngine'

export const BLOCK_SIZES = { small: 96, medium: 136, large: 188 } as const
export type BlockSize = keyof typeof BLOCK_SIZES

const STORAGE_KEY = 'museum.printStudio.v1'
/** The border's corner block (a small rosette). */
export const CORNER_BLOCK = 'rosette' as const
const MAX_OPS = 1500
/** Ink left after each impression (the block is re-inked automatically below RE_INK_AT). */
const INK_USE = 0.87
const RE_INK_AT = 0.5

interface Saved {
  ground: string
  ops: StampOp[]
}

interface StudioState {
  open: boolean
  block: BlockId
  layer: BlockLayer
  dye: string
  ground: string
  size: BlockSize
  /** Quarter turns of the (square) block. */
  turns: number
  guides: GuideMode
  snap: boolean
  ops: StampOp[]
  redo: StampOp[][]
  /** Ops removed by the last "clear" (undo brings them back). */
  cleared: StampOp[] | null
  /** Ink currently on the block (0..1). */
  load: number
  /** Bumps whenever the design canvas changes. */
  version: number
  setOpen: (v: boolean) => void
  set: (patch: Partial<Pick<StudioState, 'block' | 'layer' | 'size' | 'turns' | 'guides' | 'snap'>>) => void
  setDye: (dye: string) => void
  setGround: (ground: string) => void
  applyColourway: (id: string) => void
  reInk: () => void
  /** Stamp at design coordinates with the current block (or `corner`: the border's corner block); returns the op. */
  stamp: (x: number, y: number, rot: number, pressure: number, corner?: boolean) => StampOp
  borderAllRound: () => void
  undo: () => void
  redoOp: () => void
  clear: () => void
}

let canvas: HTMLCanvasElement | null = null
/** The visitor's cloth (design size). */
export function designCanvas(): HTMLCanvasElement {
  if (!canvas) {
    canvas = makeCanvas(DESIGN_W, DESIGN_H)
    const s = useStudio.getState()
    renderDesign(canvas.getContext('2d')!, s.ground, s.ops)
  }
  return canvas
}

function redraw(ground: string, ops: readonly StampOp[]) {
  if (!canvas) return
  renderDesign(canvas.getContext('2d')!, ground, ops)
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Saved
    if (typeof s.ground !== 'string' || !Array.isArray(s.ops)) return null
    return { ground: s.ground, ops: s.ops.filter((o) => o && typeof o.x === 'number' && typeof o.seed === 'number').slice(-MAX_OPS) }
  } catch {
    return null
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const { ground, ops } = useStudio.getState()
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ground, ops } satisfies Saved))
    } catch {
      /* storage full / unavailable — the design still works for this visit */
    }
  }, 400)
}

const saved = typeof window !== 'undefined' ? load() : null
let seedCounter = (Date.now() ^ (typeof performance !== 'undefined' ? Math.floor(performance.now() * 1000) : 0)) >>> 0
const nextSeed = () => hashString(`stamp|${(seedCounter = (seedCounter + 0x9e3779b9) >>> 0)}`)
let groupCounter = 1

const lastGroup = (ops: StampOp[]) => {
  const last = ops[ops.length - 1]
  if (!last) return 0
  if (last.group === undefined) return 1
  let n = 0
  for (let i = ops.length - 1; i >= 0 && ops[i].group === last.group; i--) n++
  return n
}

export const useStudio = create<StudioState>((set, get) => ({
  open: false,
  block: 'rosette',
  layer: 'all',
  dye: 'indigo',
  ground: saved?.ground ?? 'unbleached',
  size: 'medium',
  turns: 0,
  guides: 'half-drop',
  snap: true,
  ops: saved?.ops ?? [],
  redo: [],
  cleared: null,
  load: 1,
  version: 0,

  setOpen: (open) => set({ open }),
  set: (patch) => set(patch),
  setDye: (dye) => set((s) => (s.dye === dye ? {} : { dye, load: 1 })),
  setGround: (ground) => {
    if (ground === get().ground) return
    set((s) => ({ ground, version: s.version + 1 }))
    redraw(ground, get().ops)
    persist()
  },
  applyColourway: (id) => {
    const c = COLOURWAYS.find((x) => x.id === id)
    if (!c) return
    get().setGround(c.ground)
    set({ dye: c.outline, layer: 'outline', load: 1 })
  },
  reInk: () => set({ load: 1 }),

  stamp: (x, y, rot, pressure, corner) => {
    const s = get()
    const size = BLOCK_SIZES[s.size] * (getBlock(s.block).aspect > 1 ? 1.35 : 1)
    const op: StampOp = {
      block: corner ? CORNER_BLOCK : s.block,
      layer: s.layer,
      dye: s.dye,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      size: corner ? cornerSize(size) : size,
      rot,
      pressure: Math.round(pressure * 100) / 100,
      load: Math.round(s.load * 100) / 100,
      seed: nextSeed(),
    }
    const ops = [...s.ops, op].slice(-MAX_OPS)
    let nextLoad = s.load * (INK_USE + ((op.seed % 100) / 100 - 0.5) * 0.04)
    if (nextLoad < RE_INK_AT) nextLoad = 1
    set({ ops, redo: [], cleared: null, load: nextLoad, version: s.version + 1 })
    if (canvas) renderStamp(canvas.getContext('2d')!, op)
    persist()
    return op
  },

  borderAllRound: () => {
    const s = get()
    const size = BLOCK_SIZES[s.size] * 1.35
    const group = groupCounter++
    let ld = 1
    const added = borderSlots(size).map<StampOp>((p) => {
      const op: StampOp = {
        block: p.corner ? CORNER_BLOCK : 'border',
        layer: s.layer,
        dye: s.dye,
        x: p.x,
        y: p.y,
        size: p.corner ? cornerSize(size) : size,
        rot: p.rot,
        pressure: 0.66 + ((ld * 1000) % 7) / 30,
        load: ld,
        seed: nextSeed(),
        group,
      }
      ld *= INK_USE
      if (ld < RE_INK_AT) ld = 1
      return op
    })
    const ops = [...s.ops, ...added].slice(-MAX_OPS)
    set({ ops, redo: [], cleared: null, load: 1, version: s.version + 1 })
    if (canvas) for (const op of added) renderStamp(canvas.getContext('2d')!, op)
    persist()
  },

  undo: () => {
    const s = get()
    if (!s.ops.length && s.cleared) {
      const ops = s.cleared
      set({ ops, cleared: null, redo: [], version: s.version + 1 })
      redraw(s.ground, ops)
      persist()
      return
    }
    const n = lastGroup(s.ops)
    if (!n) return
    const removed = s.ops.slice(s.ops.length - n)
    const ops = s.ops.slice(0, s.ops.length - n)
    set({ ops, redo: [...s.redo, removed], version: s.version + 1 })
    redraw(s.ground, ops)
    persist()
  },
  redoOp: () => {
    const s = get()
    const batch = s.redo[s.redo.length - 1]
    if (!batch) return
    const ops = [...s.ops, ...batch]
    set({ ops, redo: s.redo.slice(0, -1), version: s.version + 1 })
    if (canvas) for (const op of batch) renderStamp(canvas.getContext('2d')!, op)
    persist()
  },
  clear: () => {
    const s = get()
    if (!s.ops.length) return
    set({ ops: [], redo: [], cleared: s.ops, load: 1, version: s.version + 1 })
    redraw(s.ground, [])
    persist()
  },
}))

/** Summary sent with a submission (motif meta). */
export function designSummary() {
  const { ops, ground } = useStudio.getState()
  const count = (key: 'block' | 'dye') => {
    const m = new Map<string, number>()
    for (const o of ops) m.set(o[key], (m.get(o[key]) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }
  const blocks = count('block')
  return { motif: blocks[0] ?? '', meta: { blocks, dyes: count('dye'), ground, stamps: ops.length } }
}
