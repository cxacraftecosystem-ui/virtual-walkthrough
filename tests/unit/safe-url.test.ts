/**
 * The admin's URL check (src/admin/safeUrl.ts): content fields typed by an editor reach <img src>,
 * <video src/poster> and <a href> only through it. Script-bearing schemes are refused however they
 * are disguised; site paths, http(s), local blob: previews and raster data: images pass, normalised.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { safeUrl, type UrlUse } from '../../src/admin/safeUrl'

const BASE = 'https://museum.example/admin/content'
const all: UrlUse[] = ['image', 'video', 'link']

describe('safeUrl', () => {
  it('keeps site paths and http(s) addresses, normalised to absolute URLs', () => {
    for (const use of all) {
      assert.equal(safeUrl('/artworks/rosette.webp', use, BASE), 'https://museum.example/artworks/rosette.webp')
      assert.equal(safeUrl('  /models/block.glb  ', use, BASE), 'https://museum.example/models/block.glb')
      assert.equal(safeUrl('https://cdn.example/v/a b.mp4', use, BASE), 'https://cdn.example/v/a%20b.mp4')
      assert.equal(safeUrl('HTTP://cdn.example/x.jpg', use, BASE), 'http://cdn.example/x.jpg')
    }
  })

  it('refuses javascript: and other script schemes, however they are written', () => {
    const attacks = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      '\u0000javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:image/svg+xml,<svg onload=alert(1)>',
      'file:///etc/passwd',
    ]
    for (const raw of attacks) for (const use of all) assert.equal(safeUrl(raw, use, BASE), undefined, `${use}: ${JSON.stringify(raw)}`)
  })

  it('allows blob: previews for media, never as a link', () => {
    const blob = 'blob:https://museum.example/7d3c6a1e-1f0b-4c1e-9f7e-2b8f5d1a0c11'
    assert.equal(safeUrl(blob, 'image', BASE), blob)
    assert.equal(safeUrl(blob, 'video', BASE), blob)
    assert.equal(safeUrl(blob, 'link', BASE), undefined)
  })

  it('allows data: only for raster images', () => {
    for (const type of ['png', 'jpeg', 'gif', 'webp', 'avif']) {
      const raw = `data:image/${type};base64,AAAA`
      assert.equal(safeUrl(raw, 'image', BASE), raw)
      assert.equal(safeUrl(raw, 'video', BASE), undefined)
      assert.equal(safeUrl(raw, 'link', BASE), undefined)
    }
  })

  it('returns undefined for empty, non-string and unparseable values', () => {
    for (const raw of ['', '   ', undefined, null, 42, {}, 'http://[bad']) assert.equal(safeUrl(raw, 'image', BASE), undefined)
  })
})
