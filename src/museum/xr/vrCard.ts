/** World-space info card for VR: item lookup + canvas rendering (no network fonts needed). */
import * as THREE from 'three'
import { ARTWORKS } from '../config/artworks'
import { EXHIBITS } from '../config/exhibits'
import { INFOGRAPHICS } from '../config/infographics'
import { SCENE_OBJECTS } from '../config/objects'
import { VIDEOS } from '../config/videos'
import type { SelectionKind } from '../state/store'

export interface CardInfo {
  kicker: string
  title: string
  facts: [string, string][]
  text: string
}

const f = (label: string, v: string | undefined): [string, string][] => (v && v.trim() ? [[label, v]] : [])

export function cardInfo(kind: SelectionKind, id: string): CardInfo | null {
  switch (kind) {
    case 'artwork': {
      const a = ARTWORKS.find((x) => x.id === id)
      if (!a) return null
      return {
        kicker: 'Textile',
        title: a.title,
        facts: [...f('Tradition', a.tradition), ...f('Artisan', a.artisan), ...f('Region', a.region), ...f('Material', a.material), ...f('Technique', a.technique)],
        text: [a.description, a.context].filter(Boolean).join('\n\n'),
      }
    }
    case 'exhibit': {
      const e = EXHIBITS.find((x) => x.id === id)
      if (!e) return null
      return {
        kicker: 'Hand block',
        title: e.title,
        facts: [...f('Tradition', e.tradition), ...f('Artisan', e.artisan), ...f('Region', e.region), ...f('Material', e.material), ...f('Technique', e.technique)],
        text: e.description ?? '',
      }
    }
    case 'object': {
      const o = SCENE_OBJECTS.find((x) => x.id === id)
      return o ? { kicker: 'Installation', title: o.title, facts: [], text: o.description ?? '' } : null
    }
    case 'video': {
      const v = VIDEOS.find((x) => x.id === id)
      return v ? { kicker: 'Film', title: v.title, facts: [], text: v.description ?? '' } : null
    }
    case 'infographic': {
      const g = INFOGRAPHICS.find((x) => x.id === id)
      if (!g) return null
      const steps = g.steps?.length ? '\n\n' + g.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : ''
      return { kicker: g.kicker ?? 'Craft panel', title: g.title, facts: [], text: (g.body ?? '') + steps }
    }
  }
}

export const CARD_W = 0.62 // metres
export const CARD_H = 0.78
const PX_W = 900
const PX_H = Math.round((PX_W * CARD_H) / CARD_W)

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line)
        line = word
      } else line = test
    }
    if (line) out.push(line)
  }
  return out
}

export function drawCard(info: CardInfo, tex?: THREE.CanvasTexture) {
  const canvas = (tex?.image as HTMLCanvasElement | undefined) ?? document.createElement('canvas')
  canvas.width = PX_W
  canvas.height = PX_H
  const ctx = canvas.getContext('2d')!
  const pad = 56
  ctx.clearRect(0, 0, PX_W, PX_H)
  ctx.fillStyle = 'rgba(245, 241, 232, 0.97)'
  ctx.beginPath()
  ctx.roundRect(0, 0, PX_W, PX_H, 28)
  ctx.fill()
  ctx.strokeStyle = 'rgba(43, 38, 33, 0.18)'
  ctx.lineWidth = 3
  ctx.stroke()

  let y = pad + 20
  ctx.fillStyle = '#8a5a3b'
  ctx.font = '600 26px Inter, system-ui, sans-serif'
  ctx.fillText(info.kicker.toUpperCase(), pad, y)
  y += 64
  ctx.fillStyle = '#2b2621'
  ctx.font = '500 58px "Cormorant Garamond", Georgia, serif'
  for (const l of wrap(ctx, info.title, PX_W - pad * 2).slice(0, 3)) {
    ctx.fillText(l, pad, y)
    y += 64
  }
  y += 8
  ctx.font = '500 26px Inter, system-ui, sans-serif'
  for (const [k, v] of info.facts.slice(0, 5)) {
    ctx.fillStyle = '#6f665c'
    ctx.fillText(k, pad, y)
    ctx.fillStyle = '#2b2621'
    const vv = wrap(ctx, v, PX_W - pad * 2 - 220)[0] ?? ''
    ctx.fillText(vv, pad + 220, y)
    y += 38
  }
  y += 18
  ctx.fillStyle = '#2b2621'
  ctx.font = '400 29px Inter, system-ui, sans-serif'
  const lines = wrap(ctx, info.text || '', PX_W - pad * 2)
  const maxLines = Math.floor((PX_H - y - 110) / 42)
  lines.slice(0, maxLines).forEach((l, i) => {
    const last = i === maxLines - 1 && lines.length > maxLines
    ctx.fillText(last ? l.replace(/\s*\S*$/, ' …') : l, pad, y + i * 42)
  })

  // footer hint
  ctx.fillStyle = 'rgba(43, 38, 33, 0.08)'
  ctx.fillRect(0, PX_H - 84, PX_W, 1.5)
  ctx.fillStyle = '#6f665c'
  ctx.font = '500 24px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Point here and pull the trigger to close  ·  B / Y also closes', PX_W / 2, PX_H - 34)
  ctx.textAlign = 'left'

  const t = tex ?? new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}
