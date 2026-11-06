import { useEffect, useState } from 'react'
import {
  applyTheme,
  loadThemePreference,
  onSystemThemeChange,
  resolveTheme,
  saveThemePreference,
  type ThemePreference,
} from './themes'

export function useTheme(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(loadThemePreference)

  useEffect(() => {
    applyTheme(resolveTheme(preference))
    if (preference !== 'system') return
    return onSystemThemeChange(() => applyTheme(resolveTheme('system')))
  }, [preference])

  function choose(next: ThemePreference): void {
    saveThemePreference(next)
    setPreference(next)
  }

  return [preference, choose]
}
