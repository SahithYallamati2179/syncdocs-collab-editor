'use client'

import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'collab-editor:theme'

/**
 * Applied as a `data-theme` stamp on <html>. The stylesheet declares its dark
 * values under both the OS media query and this stamp, so an explicit choice
 * beats the OS setting in either direction.
 */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', preference)
  }
}

export function readTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    /* private mode */
  }
  return 'system'
}

export function useTheme(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>('system')

  useEffect(() => {
    const stored = readTheme()
    setPreference(stored)
    applyTheme(stored)
  }, [])

  const update = useCallback((next: ThemePreference) => {
    setPreference(next)
    applyTheme(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* non-fatal */
    }
  }, [])

  return [preference, update]
}

/**
 * Runs before first paint so a dark-mode user never sees a white flash.
 * Injected as an inline script from the root layout.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('collab-editor:theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`
