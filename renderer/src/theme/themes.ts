/**
 * Theme system (Issue 4.4). A theme is just a set of CSS custom properties
 * applied on <html>, so every component styled with var(--...) follows it.
 * Adding a theme = adding an entry here; later a plugin or an imported JSON
 * file can register one the same way (base for customizable themes).
 */

export interface ThemeDefinition {
  id: string
  label: string
  /** drives native widgets (scrollbars, form controls) via color-scheme */
  scheme: 'light' | 'dark'
  vars: Readonly<Record<string, string>>
}

const light: ThemeDefinition = {
  id: 'light',
  label: 'Clair',
  scheme: 'light',
  vars: {
    '--text': '#6b6375',
    '--text-h': '#08060d',
    '--bg': '#ffffff',
    '--bg-elevated': '#f7f6f9',
    '--bg-sidebar': '#f3f2f6',
    '--border': '#e5e4e7',
    '--code-bg': '#f4f3ec',
    '--accent': '#aa3bff',
    '--accent-contrast': '#ffffff',
    '--accent-bg': 'rgba(170, 59, 255, 0.1)',
    '--accent-border': 'rgba(170, 59, 255, 0.5)',
    '--danger': '#d1304d',
    '--warning': '#b45309',
    '--ok': '#15803d',
    '--shadow': '0 6px 20px rgba(20, 10, 40, 0.12)',
  },
}

const dark: ThemeDefinition = {
  id: 'dark',
  label: 'Sombre',
  scheme: 'dark',
  vars: {
    '--text': '#9ca3af',
    '--text-h': '#f3f4f6',
    '--bg': '#16171d',
    '--bg-elevated': '#1e1f27',
    '--bg-sidebar': '#111217',
    '--border': '#2e303a',
    '--code-bg': '#1f2028',
    '--accent': '#c084fc',
    '--accent-contrast': '#16171d',
    '--accent-bg': 'rgba(192, 132, 252, 0.15)',
    '--accent-border': 'rgba(192, 132, 252, 0.5)',
    '--danger': '#f27a90',
    '--warning': '#fbbf24',
    '--ok': '#4ade80',
    '--shadow': '0 8px 24px rgba(0, 0, 0, 0.45)',
  },
}

/** example of a custom theme on top of the two base ones */
const cinema: ThemeDefinition = {
  id: 'cinema',
  label: 'Cinema',
  scheme: 'dark',
  vars: {
    ...dark.vars,
    '--bg': '#0d0b09',
    '--bg-elevated': '#1a1612',
    '--bg-sidebar': '#080706',
    '--border': '#2c251d',
    '--text': '#b3a593',
    '--text-h': '#fbf3e4',
    '--accent': '#f5b041',
    '--accent-contrast': '#0d0b09',
    '--accent-bg': 'rgba(245, 176, 65, 0.14)',
    '--accent-border': 'rgba(245, 176, 65, 0.5)',
  },
}

export const THEMES: readonly ThemeDefinition[] = [light, dark, cinema]

/** what the user picked - "system" follows the OS light/dark setting */
export type ThemePreference = 'system' | string

const STORAGE_KEY = 'epikodi.theme'

export function loadThemePreference(): ThemePreference {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'system'
  } catch {
    return 'system'
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // storage unavailable - the choice just won't survive a restart
  }
}

const darkQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(preference: ThemePreference): ThemeDefinition {
  if (preference !== 'system') {
    const theme = THEMES.find((t) => t.id === preference)
    if (theme) return theme
  }
  return darkQuery().matches ? dark : light
}

export function applyTheme(theme: ThemeDefinition): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value)
  root.style.colorScheme = theme.scheme
  root.dataset.theme = theme.id
}

/** calls back when the OS switches light/dark - only matters for the "system" preference */
export function onSystemThemeChange(listener: () => void): () => void {
  const query = darkQuery()
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
