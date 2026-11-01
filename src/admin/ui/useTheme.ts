/**
 * React bindings for the admin theme store in ../theme.ts.
 * - `useThemePref()` → `[pref, setPref]`, re-renders when the choice changes (any tab).
 * - `useThemeController()` → mount once in the shell; applies the theme before paint.
 */
import { useLayoutEffect, useSyncExternalStore } from 'react'
import { getThemePref, setThemePref, startThemeController, subscribeTheme, type ThemePref } from '../theme'

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const p = useSyncExternalStore(subscribeTheme, getThemePref, () => 'system' as ThemePref)
  return [p, setThemePref]
}

export function useThemeController() {
  useLayoutEffect(() => startThemeController(), [])
}
