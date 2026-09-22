import type { SceneObjectConfig } from '../config/objects'

export interface ModelProps {
  config: SceneObjectConfig
}

/** Footprint [x, z] with a default. */
export function fp(c: SceneObjectConfig, def: [number, number]): [number, number] {
  return c.footprint ?? def
}

export function num(c: SceneObjectConfig, key: string, def: number): number {
  const v = c.props?.[key]
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : def
}

export function str(c: SceneObjectConfig, key: string, def: string): string {
  const v = c.props?.[key]
  return typeof v === 'string' && v ? v : def
}

/** Cache key for geometry built purely from footprint/height/props. */
export function geoKey(kind: string, c: SceneObjectConfig, extra = ''): string {
  return `${kind}|${(c.footprint ?? []).join('x')}|${c.height ?? ''}|${JSON.stringify(c.props ?? {})}|${extra}`
}
