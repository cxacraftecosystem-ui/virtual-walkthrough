/**
 * Admin colour theme: Light, Dark or System (follows the OS). The choice lives in localStorage
 * (`museum.admin.theme`) and resolves to `data-theme="light" | "dark"` on `.adm-root`, which is the
 * only thing admin.css keys on. `THEME_BOOT_SCRIPT` runs inline in app/admin/layout.tsx while the HTML
 * is parsed, so the first paint already has the right theme; `startThemeController` (mounted by the
 * shell through ui/useTheme.ts) re-applies it after React mounts, since soft navigations and the dev
 * StrictMode remount skip inline scripts, and follows the OS while the choice is System.
 *
 * No React import here: the layout is a server component and imports the boot script from this file.
 */
export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_KEY = 'museum.admin.theme'
export const THEME_LABEL: Record<ThemePref, string> = { light: 'Light', dark: 'Dark', system: 'System' }
/** Canvas colours (keep equal to --bg-0 in admin.css) for the browser chrome. */
export const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#f7f6fb', dark: '#110f19' }

/**
 * Inline, dependency-free version of `readPref` + `resolve` + `apply`, for the layout. It is the
 * first child of `.adm-root`, so `document.currentScript.parentElement` is the root.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;if(!r)return;var p=null;try{p=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);r.setAttribute('data-theme',d?'dark':'light');r.setAttribute('data-theme-pref',p)}catch(e){}})()`

function readPref(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null)
export const resolveTheme = (p: ThemePref): ResolvedTheme => (p === 'system' ? (darkQuery()?.matches ? 'dark' : 'light') : p)

let pref: ThemePref = typeof window === 'undefined' ? 'system' : readPref()
const listeners = new Set<() => void>()

function apply() {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme(pref)
  for (const root of document.querySelectorAll<HTMLElement>('.adm-root')) {
    root.setAttribute('data-theme', resolved)
    root.setAttribute('data-theme-pref', pref)
  }
  // the browser chrome (address bar on phones) follows the admin canvas
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = THEME_COLOR[resolved]
}

export const getThemePref = () => pref
export function setThemePref(p: ThemePref) {
  pref = p
  try {
    if (p === 'system') window.localStorage.removeItem(THEME_KEY)
    else window.localStorage.setItem(THEME_KEY, p)
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
  apply()
  for (const l of listeners) l()
}
/** Light → Dark → System → Light (the command palette's "Toggle theme"). */
export const cycleThemePref = () => setThemePref(pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light')

export const subscribeTheme = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Applies the stored theme now and keeps it in step with the OS and other tabs. Returns a cleanup. */
export function startThemeController(): () => void {
  pref = readPref()
  apply()
  const notify = () => {
    for (const l of listeners) l()
  }
  const q = darkQuery()
  const onChange = () => {
    if (pref !== 'system') return
    apply()
    notify()
  }
  // another tab changed the choice
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return
    pref = readPref()
    apply()
    notify()
  }
  q?.addEventListener('change', onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    q?.removeEventListener('change', onChange)
    window.removeEventListener('storage', onStorage)
  }
}
