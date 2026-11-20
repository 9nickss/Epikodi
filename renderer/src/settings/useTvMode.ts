import { useEffect, useState } from 'react'

const STORAGE_KEY = 'epikodi.tv-mode'

function loadTvMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export interface TvModeControls {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

/**
 * TV mode (#2.3): big elements to be read from the couch, whatever the theme.
 * The main process zooms the page and goes fullscreen; data-mode="tv" on
 * <html> lets the CSS add what a zoom can't (thicker focus ring...).
 * Remembered across restarts.
 */
export function useTvMode(): TvModeControls {
  const [enabled, setEnabled] = useState(loadTvMode)

  useEffect(() => {
    const root = document.documentElement
    if (enabled) root.dataset.mode = 'tv'
    else delete root.dataset.mode
    void window.epikodi.setTvMode(enabled).catch(() => undefined)
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
    } catch {
      // storage unavailable - the mode just won't survive a restart
    }
  }, [enabled])

  return { enabled, setEnabled }
}
