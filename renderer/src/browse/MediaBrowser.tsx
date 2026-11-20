import { useMemo, useState } from 'react'
import type { MediaCategory, MediaRecord } from '../../../shared/types'
import { displayTitle, displayYear, formatDuration, formatRuntime } from '../format'
import { Artwork } from './Artwork'
import {
  continueWatching,
  filterAndSort,
  isUnwatched,
  recentlyAdded,
  SECTION_LABELS,
  SORT_LABELS,
  SORT_OPTIONS,
  type BrowseState,
  type SortKey,
  watchProgress,
} from './browseState'
import './MediaBrowser.css'
import { SurpriseRoulette } from './SurpriseRoulette'

function subtitle(media: MediaRecord): string {
  if (media.category === 'film') {
    return [displayYear(media), formatRuntime(media.durationSeconds)].filter(Boolean).join(' · ')
  }
  return [media.artist ?? media.albumArtist, media.album].filter(Boolean).join(' · ')
}

function MediaCard({
  media,
  onOpen,
  onPlay,
  onEnqueue,
}: {
  media: MediaRecord
  onOpen: (media: MediaRecord) => void
  onPlay: (media: MediaRecord) => void
  onEnqueue: (media: MediaRecord) => void
}) {
  const progress = watchProgress(media)
  return (
    <li className="card">
      <button type="button" className="card__open" onClick={() => onOpen(media)}>
        <span className="card__artwork">
          <Artwork media={media} size="card" />
          {progress !== null && (
            <span className="card__progress">
              <span style={{ width: `${progress * 100}%` }} />
            </span>
          )}
        </span>
        <span className="card__title">{displayTitle(media)}</span>
        <span className="card__subtitle">{subtitle(media) || ' '}</span>
      </button>
      <button
        type="button"
        className="card__play"
        onClick={() => onPlay(media)}
        aria-label={`Lire ${displayTitle(media)}`}
      >
        ▶
      </button>
      <button
        type="button"
        className="card__enqueue"
        onClick={() => onEnqueue(media)}
        aria-label={`Ajouter ${displayTitle(media)} a la file`}
        title="Ajouter a la file"
      >
        ＋
      </button>
    </li>
  )
}

interface MediaBrowserProps {
  category: MediaCategory
  media: MediaRecord[]
  state: BrowseState
  hasSources: boolean
  onStateChange: (state: BrowseState) => void
  onOpen: (media: MediaRecord) => void
  onPlay: (media: MediaRecord) => void
  /** play queue (#3.3) */
  onPlayAll: (list: MediaRecord[]) => void
  onEnqueue: (media: MediaRecord) => void
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
  onPlayAll,
  onEnqueue,
  onGoToSources,
}: MediaBrowserProps) {
  const visible = useMemo(() => filterAndSort(media, state), [media, state])
  /** "Surprends-moi" (#2.4): the pool is drawn when the button is pressed, then kept for the draw */
  const [surprisePool, setSurprisePool] = useState<MediaRecord[] | null>(null)
  const [surpriseMessage, setSurpriseMessage] = useState<string | null>(null)

  function startSurprise(): void {
    // respects the current search: "a comedy, surprise me" works
    // already without what was watched when "Pas encore vus" is ticked
    const pool = visible
    if (pool.length === 0) {
      setSurpriseMessage(
        state.hideWatched ? "Tout a deja ete vu jusqu'au bout ici !" : 'Rien a tirer au sort ici.',
      )
      return
    }
    setSurpriseMessage(null)
    setSurprisePool(pool)
  }
  const update = (patch: Partial<BrowseState>) => onStateChange({ ...state, ...patch })
  // a search is looking for something precise - the rows would only push the results down
  const rows = useMemo(
    () =>
      state.query
        ? []
        : [
            { title: 'Continuer a regarder', items: continueWatching(media) },
            {
              title: 'Recemment ajoutes',
              items: recentlyAdded(state.hideWatched ? media.filter(isUnwatched) : media),
            },
          ].filter((row) => row.items.length > 0),
    [media, state.query, state.hideWatched],
  )

  return (
    <section className="browser">
      <header className="browser__header">
        <div>
          <h2>{SECTION_LABELS[category]}</h2>
          <p className="browser__count">
            {(state.query || state.hideWatched) && visible.length !== media.length
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
          <button
            type="button"
            className="browser__play-all"
            onClick={() => onPlayAll(visible)}
            disabled={visible.length === 0}
            title="Lire tout, dans l'ordre affiche"
          >
            ▶ Tout lire
          </button>
          <div className="browser__surprise">
            <button
              type="button"
              className="browser__surprise-button"
              onClick={startSurprise}
              disabled={media.length === 0}
              title="Lancer un element au hasard"
            >
              🎲 Surprends-moi
            </button>
            <label
              className="browser__surprise-filter"
              title="Masquer ce qui a ete vu jusqu'au bout (grille, Tout lire, Surprends-moi)"
            >
              <input
                type="checkbox"
                checked={state.hideWatched}
                onChange={(event) => {
                  update({ hideWatched: event.target.checked })
                  setSurpriseMessage(null)
                }}
              />
              Pas encore vus
            </label>
          </div>
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

      {surpriseMessage && (
        <p className="browser__surprise-message" role="status">
          {surpriseMessage}
        </p>
      )}

      {surprisePool && (
        <SurpriseRoulette
          pool={surprisePool}
          onPlay={(item) => {
            setSurprisePool(null)
            onPlay(item)
          }}
          onClose={() => setSurprisePool(null)}
        />
      )}

      {rows.map((row) => (
        <section key={row.title} className="browser__row">
          <h2>{row.title}</h2>
          <ul className={`browser__row-list browser__grid--${category}`}>
            {row.items.map((item) => (
              <MediaCard
                key={item.id}
                media={item}
                onOpen={onOpen}
                onPlay={onPlay}
                onEnqueue={onEnqueue}
              />
            ))}
          </ul>
        </section>
      ))}

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
          <p>
            {state.query
              ? `Aucun resultat pour « ${state.query} »${state.hideWatched ? ' parmi les elements pas encore vus' : ''}.`
              : "Tout a deja ete vu jusqu'au bout ici. Decoche « Pas encore vus » pour tout revoir."}
          </p>
        </div>
      ) : state.mode === 'grid' ? (
        <ul className={`browser__grid browser__grid--${category}`}>
          {visible.map((item) => (
            <MediaCard
              key={item.id}
              media={item}
              onOpen={onOpen}
              onPlay={onPlay}
              onEnqueue={onEnqueue}
            />
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
              <button
                type="button"
                className="row__enqueue"
                onClick={() => onEnqueue(item)}
                aria-label={`Ajouter ${displayTitle(item)} a la file`}
                title="Ajouter a la file"
              >
                ＋
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
