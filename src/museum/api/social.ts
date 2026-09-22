/**
 * Social features glue: backend probe, session restore, auth actions, favourites.
 * All state lives in the zustand store (online, user, favorites…); components call these.
 * Nothing here throws into React: failures surface as returned error messages.
 */
import { itemKey, useMuseum, type SelectionKind } from '../state/store'
import { api, checkBackend, errorMessage, type User } from './client'
import { googleSignedOut } from './google'

let started = false

/** Probe the backend once; restore the session and favourites when available. */
export async function initSocial() {
  if (started) return
  started = true
  const ok = await checkBackend()
  const s = useMuseum.getState()
  s.setOnline(ok)
  if (!ok) return
  try {
    const me = await api.auth.me()
    if (me) await onSignedIn(me)
  } catch {
    /* ignore: stays signed out */
  }
}

async function onSignedIn(user: User) {
  useMuseum.getState().setUser(user)
  await refreshFavorites()
}

export async function refreshFavorites() {
  if (!useMuseum.getState().user) return
  try {
    const list = await api.favorites.list()
    useMuseum.getState().setFavorites(list.map((f) => itemKey(f.itemKind, f.itemId)))
  } catch {
    /* keep what we have */
  }
}

/** Returns an error message, or null on success. */
export async function signIn(email: string, password: string): Promise<string | null> {
  try {
    await onSignedIn(await api.auth.login(email.trim(), password))
    return null
  } catch (e) {
    return errorMessage(e)
  }
}

/** Sign in with a Google ID token (from the GIS button). */
export async function signInWithGoogle(credential: string): Promise<string | null> {
  try {
    await onSignedIn(await api.auth.google(credential))
    return null
  } catch (e) {
    return errorMessage(e)
  }
}

export async function register(email: string, password: string, displayName: string): Promise<string | null> {
  try {
    await onSignedIn(await api.auth.register(email.trim(), password, displayName.trim()))
    return null
  } catch (e) {
    return errorMessage(e)
  }
}

export async function signOut() {
  try {
    await api.auth.logout()
  } catch {
    /* cookie may already be gone */
  }
  googleSignedOut()
  const s = useMuseum.getState()
  s.setUser(null)
  if (s.drawer === 'favourites') s.setDrawer(null)
}

export function isFavorite(kind: SelectionKind, id: string) {
  return useMuseum.getState().favorites.includes(itemKey(kind, id))
}

/** Optimistic toggle. Signed-out visitors get the sign-in prompt instead. */
export async function toggleFavorite(kind: SelectionKind, id: string) {
  const s = useMuseum.getState()
  if (!s.online) return
  if (!s.user) {
    s.openAuth('Sign in to keep a list of your favourite works.')
    return
  }
  const key = itemKey(kind, id)
  const had = s.favorites.includes(key)
  s.setFavorites(had ? s.favorites.filter((k) => k !== key) : [...s.favorites, key])
  try {
    if (had) await api.favorites.remove(kind, id)
    else await api.favorites.add(kind, id)
  } catch {
    // roll back to the server's truth
    await refreshFavorites()
  }
}
