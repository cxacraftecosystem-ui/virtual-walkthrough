/**
 * Google Identity Services (GIS) — "Sign in with Google" for the museum and the admin.
 * The browser gets an ID token (JWT) from Google and POSTs it to /api/auth/google, which
 * verifies it server-side. The public client id comes from GET /api/auth/providers (null → no
 * button). Loads https://accounts.google.com/gsi/client lazily, once.
 */

export interface GisButtonOptions {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  logo_alignment?: 'left' | 'center'
  width?: number
  locale?: string
}

interface GisId {
  initialize(cfg: {
    client_id: string
    callback: (r: { credential?: string }) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    ux_mode?: 'popup' | 'redirect'
    context?: 'signin' | 'signup' | 'use'
    itp_support?: boolean
    use_fedcm_for_button?: boolean
  }): void
  renderButton(el: HTMLElement, opts: GisButtonOptions): void
  disableAutoSelect(): void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GisId } }
  }
}

let providersP: Promise<string | null> | null = null

/** The Google client id configured on the server, or null (also null when the API is unreachable). */
export function googleClientId(): Promise<string | null> {
  providersP ??= fetch('/api/auth/providers', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<{ google?: string | null }>) : { google: null }))
    .then((p) => (typeof p.google === 'string' && p.google ? p.google : null))
    .catch(() => {
      providersP = null // retry next time
      return null
    })
  return providersP
}

let gisP: Promise<GisId> | null = null

export function loadGis(): Promise<GisId> {
  if (typeof window === 'undefined') return Promise.reject(new Error('GIS needs a browser'))
  const ready = window.google?.accounts?.id
  if (ready) return Promise.resolve(ready)
  gisP ??= new Promise<GisId>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => {
      const id = window.google?.accounts?.id
      if (id) resolve(id)
      else reject(new Error('Google sign-in failed to initialise'))
    }
    s.onerror = () => {
      gisP = null
      s.remove()
      reject(new Error('Could not load Google sign-in'))
    }
    document.head.appendChild(s)
  })
  return gisP
}

/** Call on sign-out so One Tap / auto-select does not immediately sign the user back in. */
export function googleSignedOut() {
  try {
    window.google?.accounts?.id?.disableAutoSelect()
  } catch {
    /* not loaded */
  }
}
