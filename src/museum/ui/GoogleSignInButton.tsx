/**
 * Google's own rendered "Sign in with Google" button (brand-compliant). Renders nothing while
 * loading, when GOOGLE_CLIENT_ID is not configured on the server, or when GIS cannot load.
 * `onCredential` receives the ID token; POST it to /api/auth/google.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { googleClientId, loadGis, type GisButtonOptions } from '../api/google'

export function GoogleSignInButton({
  onCredential,
  onError,
  className,
  options,
  children,
}: {
  onCredential: (credential: string) => void
  onError?: (message: string) => void
  className?: string
  options?: GisButtonOptions
  /** Rendered after the button once it is shown (e.g. an “or” divider). */
  children?: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef({ onCredential, onError })
  const [state, setState] = useState<'loading' | 'ready' | 'off'>('loading')
  const opts = JSON.stringify(options ?? {})

  useEffect(() => {
    cb.current = { onCredential, onError }
  })

  useEffect(() => {
    let alive = true
    ;(async () => {
      const clientId = await googleClientId()
      if (!alive) return
      if (!clientId) return setState('off')
      let gis
      try {
        gis = await loadGis()
      } catch (e) {
        if (!alive) return
        setState('off')
        cb.current.onError?.(e instanceof Error ? e.message : 'Could not load Google sign-in')
        return
      }
      if (!alive || !host.current) return
      gis.initialize({
        client_id: clientId,
        callback: (r) => {
          if (r.credential) cb.current.onCredential(r.credential)
          else cb.current.onError?.('Google sign-in was cancelled')
        },
        ux_mode: 'popup',
        auto_select: false,
        itp_support: true,
        context: 'signin',
      })
      const width = Math.min(Math.max(Math.round(host.current.getBoundingClientRect().width) || 320, 200), 400)
      host.current.replaceChildren()
      gis.renderButton(host.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'center', width, ...(JSON.parse(opts) as GisButtonOptions) })
      setState('ready')
    })()
    return () => {
      alive = false
    }
  }, [opts])

  if (state === 'off') return null
  return (
    <div className={className} hidden={state !== 'ready'}>
      <div ref={host} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
      {state === 'ready' && children}
    </div>
  )
}
