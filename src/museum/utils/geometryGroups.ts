import type * as THREE from 'three'

/**
 * ExtrudeGeometry gives every shape its own cap and side groups, and three draws every group with a
 * call of its own: a carved motif of fifty shapes is a hundred draw calls, the map relief some six
 * hundred. Gather them into one group per material through an index buffer — the vertices (and their
 * normals and UVs) are untouched, only the order they are drawn in changes. Non-indexed geometry with
 * more than one group per material only; anything else is left as it is.
 */
export function oneGroupPerMaterial(g: THREE.BufferGeometry) {
  if (g.index || g.groups.length <= 2) return g
  const byMaterial = new Map<number, number[]>()
  for (const group of g.groups) {
    const mi = group.materialIndex ?? 0
    const ids = byMaterial.get(mi) ?? []
    for (let i = group.start; i < group.start + group.count; i++) ids.push(i)
    byMaterial.set(mi, ids)
  }
  if (byMaterial.size === g.groups.length) return g
  const index: number[] = []
  g.clearGroups()
  for (const [mi, ids] of [...byMaterial].sort((x, y) => x[0] - y[0])) {
    g.addGroup(index.length, ids.length, mi)
    for (const i of ids) index.push(i)
  }
  g.setIndex(index)
  return g
}
