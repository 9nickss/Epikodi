import { useMemo } from 'react'
import type { MediaCategory, MediaRecord } from '../../../shared/types'
import { displayTitle, displayYear, formatDuration, formatRuntime } from '../format'
import { Artwork } from './Artwork'
import {
  filterAndSort,
  SECTION_LABELS,
  SORT_LABELS,
  SORT_OPTIONS,
  type BrowseState,
  type SortKey,
} from './browseState'
import './MediaBrowser.css'

function subtitle(media: MediaRecord): string {
  if (media.category === 'film') {
    return [displayYear(media), formatRuntime(media.durationSeconds)].filter(Boolean).join(' · ')
  }
  return [media.artist ?? media.albumArtist, media.album].filter(Boolean).join(' · ')
}

interface MediaBrowserProps {
  category: MediaCategory
  media: MediaRecord[]
  state: BrowseState
  hasSources: boolean
  onStateChange: (state: BrowseState) => void
  onOpen: (media: MediaRecord) => void
  onPlay: (media: MediaRecord) => void
  onGoToSources: () => void
}

/** one library section (Films / Musique / Podcasts) as a grid or list - Issue 4.2 */
export function MediaBrowser({
  category,
  media,
  state,
  hasSources,
  onStateChange,
  onOpen,
  onPlay,
  onGoToSources,
}: MediaBrowserProps) {
  const visible = useMemo(() => filterAndSort(media, state), [media, state])
  const update = (patch: Partial<BrowseState>) => onStateChange({ ...state, ...patch })

  return (
    <section className="browser">
      <header className="browser__header">
        <div>
          <h2>{SECTION_LABELS[category]}</h2>
          <p className="browser__count">
            {state.query && visible.length !== media.length
              ? `${visible.length} / ${media.length} element(s)`
              : `${media.length} element(s)`}
          </p>
        </div>

        <div className="browser__toolbar">
          <input
            type="search"
            className="browser__search"
            placeholder="Rechercher..."
            value={state.query}
            onChange={(event) => update({ query: event.target.value })}
            aria-label={`Rechercher dans ${SECTION_LABELS[category]}`}
          />
          <select
            className="browser__sort"
            value={state.sort}
            onChange={(event) => update({ sort: event.target.value as SortKey })}
            aria-label="Trier par"
          >
            {SORT_OPTIONS[category].map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
          <div className="browser__modes" role="group" aria-label="Affichage">
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={state.mode === mode ? 'is-active' : ''}
                onClick={() => update({ mode })}
                aria-pressed={state.mode === mode}
                title={mode === 'grid' ? 'Grille' : 'Liste'}
              >
                {mode === 'grid' ? '▦' : '☰'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {media.length === 0 ? (
        <div className="browser__empty">
          <p>
            {hasSources
              ? `Aucun element dans ${SECTION_LABELS[category]} pour l'instant.`
              : 'Ta bibliotheque est vide : ajoute un dossier pour commencer.'}
          </p>
          {!hasSources && (
            <button type="button" onClick={onGoToSources}>
              Ajouter une source
            </button>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="browser__empty">
          <p>{`Aucun resultat pour « ${state.query} ».`}</p>
        </div>
      ) : state.mode === 'grid' ? (
        <ul className={`browser__grid browser__grid--${category}`}>
          {visible.map((item) => (
            <li key={item.id} className="card">
              <button type="button" className="card__open" onClick={() => onOpen(item)}>
                <Artwork media={item} size="card" />
                <span className="card__title">{displayTitle(item)}</span>
                <span className="card__subtitle">{subtitle(item) || ' '}</span>
              </button>
              <button
                type="button"
                className="card__play"
                onClick={() => onPlay(item)}
                aria-label={`Lire ${displayTitle(item)}`}
              >
                ▶
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="browser__list">
          {visible.map((item) => (
            <li key={item.id} className="row">
              <button
                type="button"
                className="row__play"
                onClick={() => onPlay(item)}
                aria-label={`Lire ${displayTitle(item)}`}
              >
                ▶
              </button>
              <button type="button" className="row__open" onClick={() => onOpen(item)}>
                <Artwork media={item} size="thumb" />
                <span className="row__text">
                  <span className="row__title">
                    {item.trackNumber !== null && category === 'music' && (
                      <span className="row__track">{item.trackNumber}.</span>
                    )}
                    {displayTitle(item)}
                  </span>
                  <span className="row__subtitle">{subtitle(item)}</span>
                </span>
                <span className="row__meta">{formatDuration(item.durationSeconds)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
