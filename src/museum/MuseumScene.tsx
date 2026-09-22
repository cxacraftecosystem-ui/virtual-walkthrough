/**
 * MuseumScene — composes architecture, lighting, content and navigation.
 * Pure composition: all dimensions come from config/, all content from config/*.
 */
import { Suspense } from 'react'
import { CeilingAndRoof } from './architecture/CeilingAndSkylight'
import { ExteriorGround, Floor } from './architecture/Floor'
import { Reception } from './architecture/Reception'
import { Wall } from './architecture/Wall'
import { Wings } from './architecture/Wings'
import { ARTWORKS } from './config/artworks'
import { EXHIBITS } from './config/exhibits'
import { WALLS } from './config/layout'
import { DebugScene } from './debug/DebugScene'
import { PostFX } from './effects/PostFX'
import { Precompile } from './effects/Precompile'
import { Artwork } from './exhibits/Artwork'
import { Exhibit } from './exhibits/Exhibit'
import { ProductWall, RevealWallTitle } from './exhibits/WallGraphics'
import { Benches } from './furniture/Bench'
import { Lighting } from './lighting/Lighting'
import { VideoScreens } from './media/VideoScreens'
import { TrackRail } from './lighting/TrackLight'
import { RAILS } from './lighting/tracks'
import { VisitorController } from './navigation/VisitorController'
import { SceneObjects } from './models/SceneObjects'
import { useMuseum } from './state/store'
import { ErrorBoundary } from './utils/ErrorBoundary'

/**
 * R3F only raycasts objects that have handlers. These no-op handlers make the whole
 * architecture part of pointer hit-testing, so (with the nearest-hit filter in
 * VisitorController) walls occlude clicks and hover on exhibits behind them.
 */
const occlude = () => {}

function Architecture() {
  return (
    <group onClick={occlude} onPointerOver={occlude}>
      {WALLS.filter((w) => w.render !== false).map((w) => (
        <Wall key={w.id} wall={w} />
      ))}
      <Wings />
      <Floor />
      <ExteriorGround />
      <CeilingAndRoof />
      <Reception />
      {RAILS.map((r) => (
        <TrackRail key={r.id} rail={r} />
      ))}
      <Benches />
    </group>
  )
}

function Content() {
  return (
    <group>
      {ARTWORKS.map((a) => (
        <Artwork key={a.id} config={a} />
      ))}
      {EXHIBITS.map((e) => (
        <ErrorBoundary key={e.id} fallback={null}>
          <Exhibit exhibit={e} />
        </ErrorBoundary>
      ))}
      <RevealWallTitle />
      <ProductWall />
    </group>
  )
}

export function MuseumScene() {
  const debug = useMuseum((s) => s.debug)
  return (
    <>
      <VisitorController />
      <Lighting />
      <Architecture />
      <Suspense fallback={null}>
        <Content />
        <VideoScreens />
        <SceneObjects />
      </Suspense>
      <PostFX />
      {debug && <DebugScene />}
      <Precompile />
    </>
  )
}
