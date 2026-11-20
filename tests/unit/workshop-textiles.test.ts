/**
 * The workshop's twenty textiles (src/museum/config/workshopTextiles.ts) and the new descriptions of the team's
 * 3D pieces: every slide of the deck hangs exactly once, in a stand-in's slot that exists; each slot carries the
 * textile's own record (image, maker, region, the team's caption, Hindi / Bengali titles) and nothing left over
 * from its stand-in (design note, generated deep zoom, placeholder flag); the images and their WebP variants are
 * in public/artworks at the size the import writes, framed at a readable size inside their wall; the slots
 * without a textile are still flagged stand-ins; the tour names the textiles it stops at; and the team's pieces
 * read as finished labels in all three languages.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { ARTWORKS, standInFor } from '../../src/museum/config/artworks'
import { resolveFrame } from '../../src/museum/config/frames'
import { SURFACES } from '../../src/museum/config/layout'
import { TEAM_PIECES } from '../../src/museum/config/objects'
import { TOUR_STOPS } from '../../src/museum/config/tour'
import { WORKSHOP_TEXTILES } from '../../src/museum/config/workshopTextiles'
import { computeArtworkLayout } from '../../src/museum/exhibits/frameMath'
import { TOUR_TEXT } from '../../src/museum/i18n/tourText'

const ROOT = path.resolve(import.meta.dirname, '../..')
const art = (id: string) => ARTWORKS.find((a) => a.id === id)!

/** Width × height of a baseline or progressive JPEG (its SOF segment). */
function jpegSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file)
  assert.ok(b[0] === 0xff && b[1] === 0xd8, `${file}: not a JPEG`)
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    const m = b[i + 1]
    const len = b.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error(`${file}: no SOF marker`)
}

describe('the workshop’s textiles', () => {
  it('hangs every slide of the deck exactly once, each in its own existing stand-in slot', () => {
    assert.equal(WORKSHOP_TEXTILES.length, 20)
    assert.deepEqual(
      WORKSHOP_TEXTILES.map((t) => t.slide).sort((a, b) => a - b),
      Array.from({ length: 20 }, (_, i) => i + 1),
    )
    assert.equal(new Set(WORKSHOP_TEXTILES.map((t) => t.slug)).size, 20, 'slugs unique')
    assert.equal(new Set(WORKSHOP_TEXTILES.map((t) => t.slot)).size, 20, 'slots unique')
    for (const t of WORKSHOP_TEXTILES) {
      assert.ok(standInFor(t.slot), `${t.slot} is a stand-in slot`)
      assert.match(t.slug, /^[a-z0-9-]+$/, `${t.slug}: plain file name (the WebP variant lookup needs [\\w-]+)`)
    }
  })

  it('gives each slot the textile’s own record and nothing left over from its stand-in', () => {
    for (const t of WORKSHOP_TEXTILES) {
      const a = art(t.slot)
      const was = standInFor(t.slot)!
      assert.equal(a.image, `/artworks/${t.slug}.jpg`)
      assert.equal(a.title, t.title)
      assert.equal(a.description, t.description, `${t.slot}: the team’s caption, verbatim`)
      assert.ok(a.description!.includes(t.artisan), `${t.slot}: the caption names ${t.artisan}`)
      assert.equal(a.artisan, t.artisan)
      assert.equal(a.region, t.region)
      assert.equal(a.tradition, t.tradition)
      assert.ok(a.description!.includes(t.tradition), `${t.slot}: the caption names ${t.tradition}`)
      assert.ok(a.alt && a.alt.length > 20, `${t.slot}: alt text`)
      assert.equal(a.placeholder, false)
      assert.equal(a.deepZoom, undefined, `${t.slot}: no generated stand-in deep zoom`)
      assert.equal(a.artisanId, undefined, `${t.slot}: no stand-in maker profile in the config`)
      for (const lang of ['hi', 'bn'] as const) {
        assert.ok(a.i18n?.[lang]?.title && a.i18n[lang]!.tradition && a.i18n[lang]!.region, `${t.slot}: ${lang} title, tradition, region`)
      }
      // the slot keeps its place, frame, hero flag and printing-block table
      assert.deepEqual({ ...a.placement, centerHeight: undefined }, { ...was.placement, centerHeight: undefined })
      assert.equal(a.frame, was.frame)
      assert.equal(a.hero, was.hero)
      assert.equal(a.exhibitId, was.exhibitId)
    }
    assert.equal(ARTWORKS.filter((a) => a.hero).length, 5, 'still five heroes')
    assert.ok(
      ARTWORKS.filter((a) => a.hero).every((a) => a.placeholder === false),
      'all five heroes are workshop textiles',
    )
  })

  it('leaves the other slots as flagged stand-ins', () => {
    const hung = new Set(WORKSHOP_TEXTILES.map((t) => t.slot))
    const rest = ARTWORKS.filter((a) => !hung.has(a.id))
    assert.equal(rest.length, ARTWORKS.length - 20)
    // (a slot filled from elsewhere carries its own placeholder: false and source; the generated ones stay flagged)
    for (const a of rest.filter((x) => x.image.startsWith('/artworks/') && standInFor(x.id)?.image === x.image)) assert.equal(a.placeholder, true, a.id)
  })

  it('ships each image (and its WebP variants) at the size the import writes, framed at a readable size within its wall', () => {
    for (const t of WORKSHOP_TEXTILES) {
      const jpg = path.join(ROOT, 'public/artworks', `${t.slug}.jpg`)
      assert.ok(fs.existsSync(jpg), `${t.slug}.jpg`)
      for (const v of ['1024', '2048']) assert.ok(fs.statSync(path.join(ROOT, 'public/artworks', `${t.slug}.${v}.webp`)).size > 20_000, `${t.slug}.${v}.webp`)
      const { w, h } = jpegSize(jpg)
      assert.ok(Math.max(w, h) >= 1380 && Math.max(w, h) <= 2048, `${t.slug}: ${w}×${h}`)

      const a = art(t.slot)
      const L = computeArtworkLayout(w, h, resolveFrame(a.frame), { maxWidth: a.maxWidth, maxHeight: a.maxHeight, physicalWidth: a.physicalWidth })
      const minLong = a.hero ? 1.6 : 0.85
      assert.ok(Math.max(L.outer.w, L.outer.h) >= minLong, `${t.slot}: framed ${L.outer.w.toFixed(2)} × ${L.outer.h.toFixed(2)} m`)
      const cy = a.placement.centerHeight ?? 1.6
      const surface = SURFACES[a.placement.surface]
      assert.ok(cy - L.outer.h / 2 >= 0.3, `${t.slot}: bottom ${(cy - L.outer.h / 2).toFixed(2)} m above the floor`)
      assert.ok(cy + L.outer.h / 2 <= surface.height - 0.1, `${t.slot}: top ${(cy + L.outer.h / 2).toFixed(2)} m under the wall (${surface.height} m)`)
    }
  })

  it('names the textiles in the tour (English, Hindi, Bengali) where it stops at them', () => {
    for (const t of WORKSHOP_TEXTILES) {
      for (const stop of TOUR_STOPS.filter((s) => s.item?.kind === 'artwork' && s.item.id === t.slot && s.id === t.slot)) {
        assert.equal(stop.title, t.title, `tour stop ${stop.id}`)
        assert.equal(TOUR_TEXT[stop.id]?.hi?.title, t.i18n.hi?.title, `tour stop ${stop.id} (hi)`)
        assert.equal(TOUR_TEXT[stop.id]?.bn?.title, t.i18n.bn?.title, `tour stop ${stop.id} (bn)`)
      }
    }
    const all = TOUR_STOPS.map((s) => `${s.title} ${s.text}`).join(' ')
    assert.doesNotMatch(all, /Hero Textile [IV]+|framed feature painting|triptych of tall printed panels/)
  })
})

describe('the workshop team’s 3D pieces', () => {
  it('read as finished labels in English, Hindi and Bengali', () => {
    const pieces = TEAM_PIECES.filter((o) => o.model)
    assert.equal(pieces.length, 6)
    for (const p of pieces) {
      assert.ok(p.description && p.description.length > 160, `${p.id}: a full description`)
      assert.doesNotMatch(p.description!, /still to be recorded/)
      assert.match(p.description!, /colour of its own/, `${p.id}: says the finish is a stand-in`)
      for (const lang of ['hi', 'bn'] as const) assert.ok((p.i18n?.[lang]?.description?.length ?? 0) > 80, `${p.id}: ${lang} description`)
    }
  })
})
