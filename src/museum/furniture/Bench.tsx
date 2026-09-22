/** Low-profile white museum bench (PDF: "minimalist seating positioned along key focal axes"). */
import { useMemo } from 'react'
import { BENCH_SIZE, BENCHES, type BenchPlacement } from '../config/layout'
import { createMeterBoxGeometry } from '../materials/geometry'
import { useMaterials } from '../materials/materials'

const { length: L, depth: D, height: H } = BENCH_SIZE
const TOP_T = 0.06
const LEG_T = 0.06
const LEG_INSET = 0.12

export function Bench({ bench }: { bench: BenchPlacement }) {
  const m = useMaterials()
  const top = useMemo(() => createMeterBoxGeometry(L, TOP_T, D), [])
  const leg = useMemo(() => createMeterBoxGeometry(LEG_T, H - TOP_T, D - 0.04), [])
  return (
    <group position={[bench.x, 0, bench.z]} rotation={[0, bench.along === 'z' ? Math.PI / 2 : 0, 0]}>
      <mesh geometry={top} material={m.benchWhite} position={[0, H - TOP_T / 2, 0]} castShadow receiveShadow />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={leg} material={m.benchWhite} position={[s * (L / 2 - LEG_INSET), (H - TOP_T) / 2, 0]} castShadow receiveShadow />
      ))}
    </group>
  )
}

export function Benches() {
  return (
    <>
      {BENCHES.map((b) => (
        <Bench key={b.id} bench={b} />
      ))}
    </>
  )
}
