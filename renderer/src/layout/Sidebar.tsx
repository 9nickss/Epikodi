import { useState } from 'react'
import type { DiscoverMovie, MediaCategory, MediaRecord } from '../../../shared/types'
import { SECTION_LABELS } from '../browse/browseState'
import { displayTitle } from '../format'
import {
  METRO_FACTIONS,
  METRO_THEME_ID,
  nextMetroFaction,
  THEMES,
  type MetroFaction,
} from '../theme/themes'
import type { ThemeControls } from '../theme/useTheme'
import './Sidebar.css'

export type View =
  | { name: 'section'; category: MediaCategory }
  | { name: 'detail'; mediaId: number; category: MediaCategory }
  | { name: 'discover'; movie: DiscoverMovie | null }
  | { name: 'player' }
  | { name: 'sources' }

const SECTION_ICONS: Readonly<Record<MediaCategory, string>> = {
  film: '🎬',
  music: '🎵',
  podcast: '🎙️',
}

const CATEGORIES: readonly MediaCategory[] = ['film', 'music', 'podcast']

const FACTION_EMBLEMS: Readonly<Record<MetroFaction, string>> = {
  base: '☢',
  'dark-ones': '◉',
  'red-line': '★',
}

interface SidebarProps {
  view: View
  counts: Record<MediaCategory, number>
  nowPlaying: MediaRecord | null
  /** a scan or indexing phase is running on at least one source */
  isIndexing: boolean
  theme: ThemeControls
  onNavigate: (view: View) => void
}

/** main navigation between library sections, the player and sources (Issue 4.1) */
export function Sidebar({ view, counts, nowPlaying, isIndexing, theme, onNavigate }: SidebarProps) {
  const activeCategory = view.name === 'section' || view.name === 'detail' ? view.category : null
  const isMetro = theme.preference === METRO_THEME_ID
  /** optional local image, see public/metro/README.md */
  const [hasMetroLogo, setHasMetroLogo] = useState(true)
  const nextFaction = METRO_FACTIONS[nextMetroFaction(theme.faction)]

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        {isMetro && hasMetroLogo ? (
          <img
            className="sidebar__logo-image"
            src={`${import.meta.env.BASE_URL}metro/logo.png`}
            alt=""
            draggable={false}
            onError={() => setHasMetroLogo(false)}
          />
        ) : (
          <span className="sidebar__logo">▶</span>
        )}
        <span>EpiKodi</span>
      </div>

      <nav className="sidebar__nav" aria-label="Sections">
        <p className="sidebar__heading">Bibliotheque</p>
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className={`sidebar__item${activeCategory === category ? ' is-active' : ''}`}
            onClick={() => onNavigate({ name: 'section', category })}
            aria-current={activeCategory === category ? 'page' : undefined}
          >
            <span className="sidebar__icon">{SECTION_ICONS[category]}</span>
            <span className="sidebar__label">{SECTION_LABELS[category]}</span>
            <span className="sidebar__count">{counts[category]}</span>
          </button>
        ))}

        <p className="sidebar__heading">Explorer</p>
        <button
          type="button"
          className={`sidebar__item${view.name === 'discover' ? ' is-active' : ''}`}
          onClick={() => onNavigate({ name: 'discover', movie: null })}
          aria-current={view.name === 'discover' ? 'page' : undefined}
        >
          <span className="sidebar__icon">🧭</span>
          <span className="sidebar__label">Decouvrir</span>
        </button>

        <p className="sidebar__heading">Lecture</p>
        <button
          type="button"
          className={`sidebar__item${view.name === 'player' ? ' is-active' : ''}`}
          onClick={() => onNavigate({ name: 'player' })}
          aria-current={view.name === 'player' ? 'page' : undefined}
        >
          <span className="sidebar__icon">📺</span>
          <span className="sidebar__label">Lecteur</span>
        </button>
        {nowPlaying && view.name !== 'player' && (
          <button
            type="button"
            className="sidebar__now-playing"
            onClick={() => onNavigate({ name: 'player' })}
          >
            <span className="sidebar__now-playing-label">En cours</span>
            <span className="sidebar__now-playing-title">{displayTitle(nowPlaying)}</span>
          </button>
        )}

        <p className="sidebar__heading">Reglages</p>
        <button
          type="button"
          className={`sidebar__item${view.name === 'sources' ? ' is-active' : ''}`}
          onClick={() => onNavigate({ name: 'sources' })}
          aria-current={view.name === 'sources' ? 'page' : undefined}
        >
          <span className="sidebar__icon">📁</span>
          <span className="sidebar__label">Sources</span>
          {isIndexing && <span className="sidebar__spinner" aria-label="Indexation en cours" />}
        </button>
      </nav>

      <div className="sidebar__theme">
        <label htmlFor="sidebar-theme">
          {isMetro && theme.faction !== 'base'
            ? `Theme · ${METRO_FACTIONS[theme.faction].label}`
            : 'Theme'}
        </label>
        <div className="sidebar__theme-controls">
          <select
            id="sidebar-theme"
            value={theme.preference}
            onChange={(event) => theme.choose(event.target.value, event.currentTarget)}
          >
            <option value="system">Systeme</option>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {isMetro && (
            <button
              type="button"
              className="sidebar__faction"
              onClick={theme.switchFaction}
              aria-label={`Passer a : ${nextFaction.label}`}
              title={`Passer a : ${nextFaction.label}`}
            >
              {/* keyed so the flip replays on each switch */}
              <span key={theme.faction} className="sidebar__faction-emblem">
                {FACTION_EMBLEMS[theme.faction]}
              </span>
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
