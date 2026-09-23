/**
 * Pure geometry helpers shared by screens and speakers.
 *
 * Screen-local frame: origin on the wall face at the screen's centre height,
 * +x = visitor's right when facing the screen, +y = up, +z = out of the wall into the room.
 */
import { surfacePoint } from '../config/layout'
import type { Vec3 } from '../config/museum'
import type { VideoConfig } from '../config/videos'

export const DEFAULT_ASPECT = 16 / 9
/** Curved-screen masking (black velour) widths, metres. */
export const MASK = { side: 0.42, top: 0.36, bottom: 0.18 }

export function screenPlacement(cfg: VideoConfig) {
  if (cfg.stand) {
    // free-standing ("Meet the maker" portrait stands): origin at the screen centre
    const r = (cfg.stand.rotationDeg * Math.PI) / 180
    return { position: [cfg.stand.x, cfg.placement.centerHeight, cfg.stand.z] as Vec3, rotationY: r, normal: [Math.sin(r), 0, Math.cos(r)] as Vec3 }
  }
  return surfacePoint(cfg.placement.surface, cfg.placement.at, cfg.placement.centerHeight, 0.004)
}

export function curveRadius(cfg: VideoConfig) {
  const th = ((cfg.curveDeg ?? 30) * Math.PI) / 180
  return cfg.width / 2 / Math.max(0.05, Math.sin(th / 2))
}

/** How far the (concave) curve comes forward at lateral offset lx, relative to its centre. */
export function curveSag(cfg: VideoConfig, lx: number) {
  if (cfg.screen !== 'curved') return 0
  const R = curveRadius(cfg)
  const x = Math.min(Math.abs(lx), R * 0.98)
  return R - Math.sqrt(R * R - x * x)
}

export function toScreenLocal(cfg: VideoConfig, p: Vec3): Vec3 {
  const pl = screenPlacement(cfg)
  const r = pl.rotationY
  const dx = p[0] - pl.position[0]
  const dz = p[2] - pl.position[2]
  return [dx * Math.cos(r) - dz * Math.sin(r), p[1] - pl.position[1], dx * Math.sin(r) + dz * Math.cos(r)]
}

export function toWorld(cfg: VideoConfig, l: Vec3): Vec3 {
  const pl = screenPlacement(cfg)
  const r = pl.rotationY
  return [pl.position[0] + l[0] * Math.cos(r) + l[2] * Math.sin(r), pl.position[1] + l[1], pl.position[2] - l[0] * Math.sin(r) + l[2] * Math.cos(r)]
}

/** Physical depth of the screen surface (centre) from the wall. */
export function screenDepth(cfg: VideoConfig, aspect = DEFAULT_ASPECT) {
  if (cfg.screen === 'flat') return 0.045
  if (cfg.screen === 'led-wall') return 0.1
  // Curved: stand off far enough that front speakers fit behind the (acoustically transparent) screen.
  const H = cfg.width / aspect
  let depth = 0.14
  for (const s of cfg.audio.speakers ?? []) {
    const [lx, ly, lz] = toScreenLocal(cfg, s.position)
    if (Math.abs(lx) > cfg.width / 2 || ly < -H / 2 - 0.4 || ly > H / 2 + 0.5 || lz > 1.6 || lz < 0) continue
    depth = Math.max(depth, lz + 0.24 - curveSag(cfg, lx))
  }
  return Math.min(1.2, depth)
}

/** Screen surface depth at lateral offset lx. */
export function surfaceDepthAt(cfg: VideoConfig, lx: number, aspect = DEFAULT_ASPECT) {
  return screenDepth(cfg, aspect) + curveSag(cfg, lx)
}

/** True when a speaker sits behind the screen / masking (so it is not drawn). */
export function speakerBehindScreen(cfg: VideoConfig, p: Vec3, aspect = DEFAULT_ASPECT) {
  if (cfg.screen !== 'curved') return false
  const H = cfg.width / aspect
  const [lx, ly, lz] = toScreenLocal(cfg, p)
  if (Math.abs(lx) > cfg.width / 2 + MASK.side - 0.08) return false
  if (ly < -H / 2 - MASK.bottom - 0.3 || ly > H / 2 + MASK.top) return false
  return lz > 0 && lz < surfaceDepthAt(cfg, lx, aspect) - 0.08
}
