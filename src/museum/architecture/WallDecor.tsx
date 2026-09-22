/**
 * <WallDecor/> — wall finishes & decorated feature sections (content: config/decor.ts).
 *
 * Each decor group becomes ONE merged mesh per material bucket (built once per tier by
 * decorGeometry.ts), wrapped in a <ZoneGroup> so it costs nothing while its zone can't be
 * seen. Layers are thin quads 1.5 mm proud of the plaster (polygonOffset) or real relief
 * slabs; none of them raycast (the walls behind already occlude pointer hits).
 *
 * renderOrder −1: decor draws BEFORE the (merged) walls, so the plaster fragments it covers
 * fail the early depth test instead of being shaded twice — layering is ~free in fill rate.
 */
import { useEffect, useMemo } from 'react'
import { DECOR } from '../config/decor'
import { useDecorMaterials } from '../materials/decorMaterials'
import { ZoneGroup } from '../navigation/zoneCulling'
import { useMuseum } from '../state/store'
import { buildDecorGroup } from './decorGeometry'

const noRaycast = () => null

/** Dev-only A/B switch for profiling: `?decor=0` hides the whole system. */
const disabled = process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('decor') === '0'

export function WallDecor() {
  const tier = useMuseum((s) => s.tier)
  const mats = useDecorMaterials()
  const groups = useMemo(() => DECOR.map((g) => ({ id: g.id, zones: g.zones, buckets: buildDecorGroup(g, tier) })), [tier])
  useEffect(() => () => groups.forEach((g) => g.buckets.forEach((b) => b.geometry.dispose())), [groups])
  if (disabled) return null
  return (
    <group name="wall-decor">
      {groups.map((g) => (
        <ZoneGroup key={g.id} zones={g.zones}>
          {g.buckets.map((b) => (
            <mesh
              key={b.key}
              name={`decor:${g.id}:${b.material}`}
              geometry={b.geometry}
              material={mats.get(b.material)}
              castShadow={b.cast}
              receiveShadow
              renderOrder={-1}
              raycast={noRaycast}
            />
          ))}
        </ZoneGroup>
      ))}
    </group>
  )
}
