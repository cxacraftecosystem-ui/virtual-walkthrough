/**
 * Deep Zoom Image (DZI) pyramid geometry + descriptor XML — pure, isomorphic.
 *
 * Shared by the museum viewer (src/museum/ui/deepzoom), the admin tiler
 * (src/admin/pipeline), the server (src/server/handlers/deepzoom.ts) and
 * scripts/generate-deepzoom.mjs (through the placeholder page).
 *
 * Layout of a pyramid published at `<base>/image.dzi`:
 *   <base>/image.dzi                        descriptor (this module's `dziXml`)
 *   <base>/image_files/<level>/<col>_<row>.<format>
 * Level `maxLevel` is the full-resolution image; each level below halves it (rounding up)
 * down to 1 × 1 px at level 0. Tiles are `tileSize` px plus `overlap` px on every inner edge
 * (the Microsoft / OpenSeadragon convention).
 */

export interface DziInfo {
  width: number
  height: number
  tileSize: number
  overlap: number
  format: 'jpg' | 'jpeg' | 'png' | 'webp'
}

export interface DziTileRect {
  level: number
  col: number
  row: number
  /** Source rectangle in that level's pixel space. */
  x: number
  y: number
  w: number
  h: number
}

export const DZI_DEFAULTS = { tileSize: 254, overlap: 1, format: 'jpg' as const }

export const dziMaxLevel = (w: number, h: number) => Math.ceil(Math.log2(Math.max(w, h, 1)))

/** Pixel size of a pyramid level. */
export function dziLevelSize(info: Pick<DziInfo, 'width' | 'height'>, level: number) {
  const scale = 2 ** (dziMaxLevel(info.width, info.height) - level)
  return { w: Math.max(1, Math.ceil(info.width / scale)), h: Math.max(1, Math.ceil(info.height / scale)) }
}

export function dziGrid(info: DziInfo, level: number) {
  const { w, h } = dziLevelSize(info, level)
  return { w, h, cols: Math.ceil(w / info.tileSize), rows: Math.ceil(h / info.tileSize) }
}

/** Every tile of one level with its source rectangle (overlap included). */
export function dziLevelTiles(info: DziInfo, level: number): DziTileRect[] {
  const { w, h, cols, rows } = dziGrid(info, level)
  const { tileSize: t, overlap: o } = info
  const out: DziTileRect[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * t - (col > 0 ? o : 0)
      const y = row * t - (row > 0 ? o : 0)
      const x1 = Math.min(w, (col + 1) * t + o)
      const y1 = Math.min(h, (row + 1) * t + o)
      out.push({ level, col, row, x, y, w: x1 - x, h: y1 - y })
    }
  }
  return out
}

export function dziTileCount(info: DziInfo) {
  let n = 0
  for (let l = 0; l <= dziMaxLevel(info.width, info.height); l++) {
    const g = dziGrid(info, l)
    n += g.cols * g.rows
  }
  return n
}

/** Path of a tile relative to the directory holding `image.dzi`. */
export const dziTilePath = (info: Pick<DziInfo, 'format'>, level: number, col: number, row: number, name = 'image') =>
  `${name}_files/${level}/${col}_${row}.${info.format}`

export function dziXml(info: DziInfo) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" TileSize="${info.tileSize | 0}" Overlap="${info.overlap | 0}" Format="${info.format}">\n` +
    `  <Size Width="${info.width | 0}" Height="${info.height | 0}"/>\n` +
    `</Image>\n`
  )
}

/** Parse a .dzi descriptor (tolerant regex parse; works in Node and the browser). */
export function parseDzi(xml: string): DziInfo | null {
  const attr = (tag: string, name: string) => {
    const m = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, 'i').exec(xml)
    return m ? m[1] : null
  }
  const width = Number(attr('Size', 'Width'))
  const height = Number(attr('Size', 'Height'))
  const tileSize = Number(attr('Image', 'TileSize'))
  const overlap = Number(attr('Image', 'Overlap') ?? 0)
  const format = (attr('Image', 'Format') ?? 'jpg').toLowerCase() as DziInfo['format']
  if (!(width > 0 && height > 0 && tileSize > 0) || !['jpg', 'jpeg', 'png', 'webp'].includes(format)) return null
  return { width, height, tileSize, overlap: Number.isFinite(overlap) ? overlap : 0, format }
}
