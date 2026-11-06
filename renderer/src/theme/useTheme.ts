import { useEffect, useState } from 'react'
import { animateThemeChange, prefersReducedMotion } from './themeTransition'
import {
  applyTheme,
  loadMetroFaction,
  loadThemePreference,
  METRO_THEME_ID,
  nextMetroFaction,
  onSystemThemeChange,
  resolveTheme,
  saveMetroFaction,
  saveThemePreference,
  type MetroFaction,
  type ThemePreference,
} from './themes'

export interface ThemeControls {
  preference: ThemePreference
  faction: MetroFaction
  /** Metro animation to play, null when there is none */
  intro: MetroFaction | null
  /** `origin` is the control used - the transition starts from it */
  choose: (preference: ThemePreference, origin: HTMLElement) => void
  switchFaction: () => void
  endIntro: () => void
}

export function useTheme(): ThemeControls {
  const [preference, setPreference] = useState<ThemePreference>(loadThemePreference)
  const [faction, setFaction] = useState<MetroFaction>(loadMetroFaction)
  const [intro, setIntro] = useState<MetroFaction | null>(null)

  useEffect(() => {
    applyTheme(resolveTheme(preference, faction))
    if (preference !== 'system') return
    return onSystemThemeChange(() => applyTheme(resolveTheme('system', faction)))
  }, [preference, faction])

  /** the intro overlay hides the color change, so no reveal here */
  function showFaction(next: MetroFaction, nextPreference: ThemePreference): void {
    saveMetroFaction(next)
    applyTheme(resolveTheme(nextPreference, next))
    setFaction(next)
    setIntro(prefersReducedMotion() ? null : next)
  }

  function choose(next: ThemePreference, origin: HTMLElement): void {
    saveThemePreference(next)
    if (next === METRO_THEME_ID) {
      // Metro always starts without a faction, on Artyom
      setPreference(next)
      showFaction('base', next)
      return
    }
    setIntro(null)
    animateThemeChange(origin, () => {
      applyTheme(resolveTheme(next, faction))
      setPreference(next)
    })
  }

  return {
    preference,
    faction,
    intro,
    choose,
    switchFaction: () => showFaction(nextMetroFaction(faction), preference),
    endIntro: () => setIntro(null),
  }
}
