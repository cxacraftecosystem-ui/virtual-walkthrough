/**
 * The building's prop schemas (src/museum/models/propSchemas.ts) against its kinds and the admin's
 * object form (src/admin/fields.ts): every schema names a real kind, every default fits its own
 * range or options, the kind select lists every kind, and zone lists leave out upper storeys.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PROCEDURAL_KINDS } from '../../src/museum/config/objects'
import { ZONES } from '../../src/museum/config/layout'
import { COMMON_PROPS, KIND_SCHEMAS, kindDefaults } from '../../src/museum/models/propSchemas'
import { FIELDS, KIND_IDS, ZONE_IDS, propSchemasOf, template } from '../../src/admin/fields'

describe('prop schemas', () => {
  it('describe only kinds the building has, under their own key', () => {
    for (const [key, k] of Object.entries(KIND_SCHEMAS)) {
      assert.equal(k.kind, key)
      assert.ok((PROCEDURAL_KINDS as readonly string[]).includes(key), `${key} is not a ProceduralModelId`)
    }
  })

  it('have defaults that fit their own range and options, and no key twice', () => {
    for (const k of [...Object.values(KIND_SCHEMAS), { kind: '(common)', props: COMMON_PROPS }]) {
      const keys = k.props.map((p) => p.key)
      assert.equal(new Set(keys).size, keys.length, `${k.kind}: duplicate key`)
      for (const p of k.props) {
        if (p.type === 'number' && p.default !== undefined) {
          if (p.min !== undefined) assert.ok(p.default >= p.min, `${k.kind}.${p.key}`)
          if (p.max !== undefined) assert.ok(p.default <= p.max, `${k.kind}.${p.key}`)
        }
        if (p.type === 'select' && p.default !== undefined) assert.ok(p.options.includes(p.default), `${k.kind}.${p.key}`)
        if (p.type === 'color' && p.default !== undefined) assert.match(p.default, /^#[0-9a-f]{6}$/i, `${k.kind}.${p.key}`)
      }
    }
  })

  it('kindDefaults returns only the props that have a default', () => {
    for (const k of Object.values(KIND_SCHEMAS)) {
      const d = kindDefaults(k.kind)
      assert.deepEqual(Object.keys(d).sort(), k.props.filter((p) => p.default !== undefined).map((p) => p.key).sort())
    }
    assert.deepEqual(kindDefaults('no-such-kind'), {})
  })
})

describe('admin object form', () => {
  it('offers every kind in the kind select, and a typed props field', () => {
    const kind = FIELDS.objects.find((f) => f.path === 'kind')
    assert.equal(kind?.type, 'select')
    assert.deepEqual([...(kind?.options ?? [])].sort(), [...PROCEDURAL_KINDS].sort())
    assert.deepEqual([...KIND_IDS].sort(), [...PROCEDURAL_KINDS].sort())
    assert.equal(FIELDS.objects.find((f) => f.path === 'props')?.type, 'props')
    assert.deepEqual(propSchemasOf('no-such-kind'), [...COMMON_PROPS])
  })

  it('places things only in ground-floor zones, and a new object in the first of them', () => {
    const ground = ZONES.filter((z) => (z.level ?? 1) < 2).map((z) => z.id as string)
    assert.deepEqual([...ZONE_IDS], ground)
    assert.deepEqual(FIELDS.objects.find((f) => f.path === 'zone')?.options, ZONE_IDS)
    const t = template('objects', 'new-1')
    assert.equal(t.zone, ground[0])
    assert.ok(KIND_IDS.includes(t.kind as string))
  })
})
