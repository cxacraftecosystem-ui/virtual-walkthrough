/**
 * The tour editor's unsaved-changes rule (src/admin/pages/tour/dirty.ts): edits typed under
 * Advanced count before "Apply text", so the leave guard is armed and Save is enabled.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tourIsDirty } from '../../src/admin/pages/tour/dirty'

const stops = [{ id: 'gate', title: 'Gate' }, { id: 'hall', title: 'Hall' }]
const saved = JSON.stringify(stops)
const text = (v: unknown) => JSON.stringify(v, null, 2)

describe('tourIsDirty', () => {
  it('is clean while loading', () => {
    assert.equal(tourIsDirty({ stops: null, saved: '[]', view: 'json', jsonText: 'garbage' }), false)
  })

  it('follows the stops in the Stops view, ignoring stale text', () => {
    assert.equal(tourIsDirty({ stops, saved, view: 'stops', jsonText: 'stale' }), false)
    assert.equal(tourIsDirty({ stops: [stops[0]], saved, view: 'stops', jsonText: '' }), true)
  })

  it('is clean when the Advanced text is the stops as opened, or differs only in spacing', () => {
    assert.equal(tourIsDirty({ stops, saved, view: 'json', jsonText: text(stops) }), false)
    assert.equal(tourIsDirty({ stops, saved, view: 'json', jsonText: JSON.stringify(stops) }), false)
  })

  it('counts Advanced text that reads as different stops', () => {
    const renamed = [{ ...stops[0], title: 'Main gate' }, stops[1]]
    assert.equal(tourIsDirty({ stops, saved, view: 'json', jsonText: text(renamed) }), true)
    assert.equal(tourIsDirty({ stops, saved, view: 'json', jsonText: text([...stops, { id: 'yard' }]) }), true)
  })

  it('counts Advanced text that cannot be read yet', () => {
    assert.equal(tourIsDirty({ stops, saved, view: 'json', jsonText: text(stops).slice(0, -3) }), true)
  })

  it('treats empty text as an empty tour', () => {
    assert.equal(tourIsDirty({ stops: [], saved: '[]', view: 'json', jsonText: '' }), false)
    assert.equal(tourIsDirty({ stops, saved, view: 'json', jsonText: '' }), true)
  })

  it('stays dirty when the stops already differ, whatever the text', () => {
    assert.equal(tourIsDirty({ stops: [stops[1], stops[0]], saved, view: 'json', jsonText: text([stops[1], stops[0]]) }), true)
  })
})
