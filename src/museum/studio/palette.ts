/**
 * "Print it yourself" studio — blocks, dyes and ground cloths offered to visitors.
 *
 * The dye names are COLOUR NAMES ONLY (the colour a visitor sees on screen); they make no
 * claim about recipes, mordants or chemistry. The blocks are the museum's placeholder motif
 * library (src/museum/exhibits/motifs.ts) — generic forms, not documented traditional designs.
 */
import type { MotifId } from '../config/exhibits'
import type { Motif, MotifPrimitive } from '../exhibits/motifs'

export type BlockId = MotifId | 'border'
export type BlockLayer = 'all' | 'outline' | 'fill'

export interface BlockDef {
  id: BlockId
  name: string
  /** Rectangular blocks (the border) are `aspect` times as long as they are deep. */
  aspect: number
}

export const BLOCKS: BlockDef[] = [
  { id: 'rosette', name: 'Rosette', aspect: 1 },
  { id: 'teardrop', name: 'Teardrop', aspect: 1 },
  { id: 'star-lattice', name: 'Star lattice', aspect: 1 },
  { id: 'leaf-trail', name: 'Leaf trail', aspect: 1 },
  { id: 'diamond', name: 'Lozenge', aspect: 1 },
  { id: 'border', name: 'Border', aspect: 3 },
]

export const getBlock = (id: BlockId) => BLOCKS.find((b) => b.id === id) ?? BLOCKS[0]

export interface DyeDef {
  id: string
  /** Colour name as shown to the visitor. */
  name: string
  color: string
}

export const DYES: DyeDef[] = [
  { id: 'indigo', name: 'Indigo', color: '#27406b' },
  { id: 'pale-indigo', name: 'Pale indigo', color: '#5b7aa6' },
  { id: 'madder', name: 'Madder red', color: '#9b3326' },
  { id: 'madder-rose', name: 'Madder rose', color: '#c0645a' },
  { id: 'ochre', name: 'Ochre', color: '#b7862f' },
  { id: 'rust', name: 'Rust', color: '#8e4a24' },
  { id: 'iron-black', name: 'Iron black', color: '#2a2522' },
]

export const getDye = (id: string) => DYES.find((d) => d.id === id) ?? DYES[0]

export interface GroundDef {
  id: string
  name: string
  color: string
}

export const GROUNDS: GroundDef[] = [
  { id: 'unbleached', name: 'Unbleached cotton', color: '#ece2cc' },
  { id: 'off-white', name: 'Off-white cotton', color: '#f4efe4' },
  { id: 'pale-ochre', name: 'Pale ochre wash', color: '#e8d3a3' },
  { id: 'rose', name: 'Rose wash', color: '#ecd3c6' },
  { id: 'stone', name: 'Stone grey wash', color: '#dcd8cc' },
]

export const getGround = (id: string) => GROUNDS.find((g) => g.id === id) ?? GROUNDS[0]

/** Quick-start colourways: a ground plus an outline dye and a filler dye. */
export interface Colourway {
  id: string
  name: string
  ground: string
  outline: string
  fill: string
}

export const COLOURWAYS: Colourway[] = [
  { id: 'indigo-unbleached', name: 'Indigo on unbleached', ground: 'unbleached', outline: 'indigo', fill: 'pale-indigo' },
  { id: 'madder-black', name: 'Madder & iron black', ground: 'off-white', outline: 'iron-black', fill: 'madder' },
  { id: 'ochre-indigo', name: 'Ochre & indigo', ground: 'unbleached', outline: 'indigo', fill: 'ochre' },
  { id: 'rust-ochre', name: 'Rust on ochre', ground: 'pale-ochre', outline: 'rust', fill: 'madder-rose' },
  { id: 'black-rose', name: 'Iron black on rose', ground: 'rose', outline: 'iron-black', fill: 'madder' },
]

/* ------------------------------------------------------------------ */
/* Border block (placeholder geometric band, 3 : 1)                    */
/* ------------------------------------------------------------------ */

const rect = (x0: number, y0: number, x1: number, y1: number): MotifPrimitive => ({
  type: 'polygon',
  points: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ],
})
const lozenge = (cx: number, hw: number, hh: number, stroke?: number): MotifPrimitive => ({
  type: 'polygon',
  points: [
    [cx - hw, 0],
    [cx, hh],
    [cx + hw, 0],
    [cx, -hh],
  ],
  stroke,
})

/**
 * A generic ruled band with a row of lozenges — PLACEHOLDER, not a documented border design.
 * It occupies y ∈ [−1/6, 1/6] of the unit square, so the block is `size` long and size/3 deep
 * and consecutive impressions abut seamlessly along x.
 */
export const BORDER_MOTIF: Motif = (() => {
  const xs = [-0.4, -0.2, 0, 0.2, 0.4]
  const outline: MotifPrimitive[] = [
    rect(-0.5, 0.135, 0.5, 0.155),
    rect(-0.5, -0.155, 0.5, -0.135),
    rect(-0.5, 0.108, 0.5, 0.116),
    rect(-0.5, -0.116, 0.5, -0.108),
    ...xs.map((x) => lozenge(x, 0.078, 0.085, 0.011)),
  ]
  const fill: MotifPrimitive[] = [
    ...xs.map((x) => lozenge(x, 0.042, 0.046)),
    ...[-0.5, -0.3, -0.1, 0.1, 0.3, 0.5].map<MotifPrimitive>((x) => ({ type: 'circle', cx: x, cy: 0, r: 0.022 })),
  ]
  return { id: 'rosette', name: 'Ruled lozenge border (placeholder)', fill, outline }
})()
