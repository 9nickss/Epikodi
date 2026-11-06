import type { DiscoverMovie, MediaCategory, MediaRecord } from '../../../shared/types'
import { SECTION_LABELS } from '../browse/browseState'
import { displayTitle } from '../format'
import { THEMES, type ThemePreference } from '../theme/themes'
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

interface SidebarProps {
  view: View
  counts: Record<MediaCategory, number>
  nowPlaying: MediaRecord | null
  /** a scan or indexing phase is running on at least one source */
  isIndexing: boolean
  theme: ThemePreference
  onNavigate: (view: View) => void
  onThemeChange: (theme: ThemePreference) => void
}

/** main navigation between library sections, the player and sources (Issue 4.1) */
export function Sidebar({
  view,
  counts,
  nowPlaying,
  isIndexing,
  theme,
  onNavigate,
  onThemeChange,
}: SidebarProps) {
  const activeCategory = view.name === 'section' || view.name === 'detail' ? view.category : null

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo">▶</span>
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

      <label className="sidebar__theme">
        <span>Theme</span>
        <select value={theme} onChange={(event) => onThemeChange(event.target.value)}>
          <option value="system">Systeme</option>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
    </aside>
  )
}
