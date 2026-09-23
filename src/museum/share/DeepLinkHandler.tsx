/**
 * Follows URL hash deep links (#artwork=… #object=… #exhibit=… #zone=…, see deepLink.ts):
 * once the visitor has entered and the scene has compiled (so items have registered their
 * viewing poses), walk / fade-teleport to the item and open its panel; a zone link
 * teleports to the room's arrival point. Also reacts to later `hashchange`s.
 */
import { useEffect } from 'react'
import { ZONES } from '../config/layout'
import { skipArrival, useArrival } from '../navigation/ArrivalFlight'
import { useMuseum } from '../state/store'
import { teleport } from '../state/visitor'
import { goToItem } from '../tour/navigate'
import { useTour } from '../tour/engine'
import { itemSummary } from '../ui/items'
import { travel } from '../ui/Minimap'
import { parseDeepLink, type DeepLink } from './deepLink'

function follow(link: DeepLink) {
  const s = useMuseum.getState()
  if (useTour.getState().active) return
  if (link.kind === 'zone') {
    const z = ZONES.find((x) => x.id === link.id)
    if (!z) return
    s.select(null)
    travel(() => teleport(z.spawn.x, z.spawn.z, z.spawn.yawDeg, 0))
    return
  }
  const kind = link.kind
  if (!itemSummary(kind, link.id)) return
  s.select(null)
  goToItem(kind, link.id, () => useMuseum.getState().select({ kind, id: link.id }))
}

/** The load-time link is followed once (a quality change recompiles the scene — don't re-run it). */
let initialDone = false

export function DeepLinkHandler() {
  const ready = useMuseum((s) => s.phase === 'entered' && s.sceneCompiled)
  useEffect(() => {
    if (!ready) return
    const run = () => {
      const link = parseDeepLink(window.location.hash)
      if (link) follow(link)
    }
    // let artworks / objects register their poses after the first frames
    const t = window.setTimeout(() => {
      if (initialDone) return
      initialDone = true
      if (!parseDeepLink(window.location.hash)) return
      // a shared link skips the cinematic arrival flight
      if (useArrival.getState().active) {
        skipArrival()
        window.setTimeout(run, 900)
      } else run()
    }, 700)
    window.addEventListener('hashchange', run)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('hashchange', run)
    }
  }, [ready])
  return null
}
