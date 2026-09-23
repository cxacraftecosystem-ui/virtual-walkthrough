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
import { WallDecor } from './architecture/WallDecor'
import { ARTWORKS } from './config/artworks'
import { EXHIBITS } from './config/exhibits'
import { SURFACES, WALLS } from './config/layout'
import { INFOGRAPHICS } from './config/infographics'
import { DebugScene } from './debug/DebugScene'
import { PostFX } from './effects/PostFX'
import { RayTraceManager } from './effects/PathTracer'
import { ArrivalFlight } from './navigation/ArrivalFlight'
import { PresenceLayer } from './live/PresenceLayer'
import { XRRoot } from './xr/XRRoot'
import { useXRMode } from './xr/xrStore'
import { Precompile } from './effects/Precompile'
import { StaticMerge } from './effects/StaticMerge'
import { ZoneCuller, ZoneGroup } from './navigation/zoneCulling'
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
import { Amenities } from './amenities/Amenities'
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
      {/* static shell: merged into one mesh per material (a handful of draw calls) */}
      <StaticMerge name="shell">
        {WALLS.filter((w) => w.render !== false).map((w) => (
          <Wall key={w.id} wall={w} />
        ))}
        <CeilingAndRoof />
        <Reception />
        {RAILS.map((r) => (
          <TrackRail key={r.id} rail={r} />
        ))}
        <Benches />
      </StaticMerge>
      <Wings />
      <WallDecor />
      <Floor />
      <ExteriorGround />
    </group>
  )
}

function Content() {
  return (
    <group>
      {ARTWORKS.map((a) => (
        <ZoneGroup key={a.id} zones={[SURFACES[a.placement.surface]?.zone ?? 'reveal']}>
          <Artwork config={a} />
        </ZoneGroup>
      ))}
      {EXHIBITS.map((e) => (
        <ZoneGroup key={e.id} zones={[SURFACES[e.placement.surface]?.zone ?? 'reveal']}>
          <ErrorBoundary fallback={null}>
            <Exhibit exhibit={e} />
          </ErrorBoundary>
        </ZoneGroup>
      ))}
      <ZoneGroup zones={['reveal', 'passage', 'reception']}>
        <RevealWallTitle />
      </ZoneGroup>
      <ZoneGroup zones={[...new Set(INFOGRAPHICS.map((i) => SURFACES[i.placement.surface]?.zone ?? 'reveal'))]}>
        <ProductWall />
      </ZoneGroup>
    </group>
  )
}

export function MuseumScene() {
  const debug = useMuseum((s) => s.debug)
  const inXR = useXRMode((s) => s.mode === 'vr')
  return (
    <>
      <VisitorController />
      <ArrivalFlight />
      <ZoneCuller />
      <Lighting />
      <Architecture />
      <Suspense fallback={null}>
        <Content />
        <VideoScreens />
        <SceneObjects />
        <ErrorBoundary fallback={null}>
          <Amenities />
        </ErrorBoundary>
      </Suspense>
      {/* post-processing can't render into a WebXR framebuffer: off while in VR */}
      {!inXR && <PostFX />}
      {!inXR && <RayTraceManager />}
      {debug && <DebugScene />}
      <Precompile />
      <PresenceLayer />
      <XRRoot />
    </>
  )
}
