/**
 * <VideoScreens /> — mounts every configured film (VIDEOS) with its surround speakers,
 * and keeps the shared AudioListener glued to the camera. Mount once inside the Canvas.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Vec3 } from '../config/museum'
import { VIDEOS, type VideoConfig } from '../config/videos'
import { ErrorBoundary } from '../utils/ErrorBoundary'
import { updateListener } from './audioEngine'
import { speakerBehindScreen } from './screenMath'
import { Speaker } from './Speaker'
import { pauseAllVideos, VideoScreen } from './VideoScreen'

function ListenerRig() {
  useFrame(({ camera }) => updateListener(camera))
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) pauseAllVideos()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  return null
}

function Speakers({ config }: { config: VideoConfig }) {
  const list = useMemo(() => {
    const spk = config.audio.mode === 'surround' ? (config.audio.speakers ?? []) : []
    if (!spk.length) return []
    // Aim every cabinet at the centroid of the layout, at seated ear height.
    const n = spk.length
    const aim: Vec3 = [spk.reduce((s, p) => s + p.position[0], 0) / n, 1.15, spk.reduce((s, p) => s + p.position[2], 0) / n]
    return spk.filter((s) => !speakerBehindScreen(config, s.position)).map((s) => ({ ...s, aim }))
  }, [config])
  return (
    <>
      {list.map((s) => (
        <Speaker key={s.channel} videoId={config.id} channel={s.channel} position={s.position} aim={s.aim} />
      ))}
    </>
  )
}

export function VideoScreens() {
  return (
    <group name="video-screens">
      <ListenerRig />
      {VIDEOS.map((v) => (
        <ErrorBoundary key={v.id} fallback={null}>
          <VideoScreen config={v} />
          <Speakers config={v} />
        </ErrorBoundary>
      ))}
    </group>
  )
}
