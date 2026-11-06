import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DiscoverMovie, DiscoverRow, MediaRecord } from '../../../shared/types'
import { formatReleaseDate, ipcErrorMessage } from '../format'
import { DiscoverDetail } from './DiscoverDetail'
import '../browse/MediaBrowser.css'
import '../detail/MediaDetail.css'
import './Discover.css'

function cardSubtitle(movie: DiscoverMovie): string {
  return [
    formatReleaseDate(movie.releaseDate, 'medium'),
    movie.rating ? `★ ${movie.rating.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function DiscoverCard({
  movie,
  isOwned,
  onSelect,
}: {
  movie: DiscoverMovie
  isOwned: boolean
  onSelect: (movie: DiscoverMovie) => void
}) {
  return (
    <li className="card">
      <button type="button" className="card__open" onClick={() => onSelect(movie)}>
        {movie.posterUrl ? (
          <img
            className="artwork artwork--card"
            src={movie.posterUrl}
            alt=""
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="artwork artwork--card artwork--placeholder artwork--film">
            <span className="artwork__icon">🎬</span>
            <span className="artwork__title">{movie.title}</span>
          </div>
        )}
        <span className="card__title">{movie.title}</span>
        <span className="card__subtitle">{cardSubtitle(movie) || ' '}</span>
      </button>
      {isOwned && <span className="discover__owned">✓ Possede</span>}
    </li>
  )
}

interface DiscoverPageProps {
  /** film whose page is open, on top of the (still mounted) rows */
  selected: DiscoverMovie | null
  media: MediaRecord[]
  tmdbConfigured: boolean
  isLibraryLoaded: boolean
  onSelect: (movie: DiscoverMovie | null) => void
  onPlay: (media: MediaRecord) => void
  onOpenMedia: (media: MediaRecord) => void
}

/** films to discover from TMDB, in the library or not */
export function DiscoverPage({
  selected,
  media,
  tmdbConfigured,
  isLibraryLoaded,
  onSelect,
  onPlay,
  onOpenMedia,
}: DiscoverPageProps) {
  const [rows, setRows] = useState<DiscoverRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  /** where the rows were scrolled to when a film was opened */
  const rowsScrollY = useRef(0)

  useEffect(() => {
    if (!tmdbConfigured) return
    let isCancelled = false
    window.epikodi
      .discoverMovies()
      .then((loaded) => {
        if (!isCancelled) setRows(loaded)
      })
      .catch((loadError: unknown) => {
        if (!isCancelled) setError(ipcErrorMessage(loadError))
      })
    return () => {
      isCancelled = true
    }
  }, [tmdbConfigured, attempt])

  useLayoutEffect(() => {
    window.scrollTo(0, selected ? 0 : rowsScrollY.current)
  }, [selected])

  const ownedByTmdbId = useMemo(() => {
    const owned = new Map<number, MediaRecord>()
    for (const item of media) if (item.tmdb) owned.set(item.tmdb.id, item)
    return owned
  }, [media])

  function retry(): void {
    setError(null)
    setAttempt((count) => count + 1)
  }

  function open(movie: DiscoverMovie): void {
    rowsScrollY.current = window.scrollY
    onSelect(movie)
  }

  if (!isLibraryLoaded) return null

  if (!tmdbConfigured) {
    return (
      <section className="browser">
        <h2 className="discover__heading">Decouvrir</h2>
        <div className="browser__empty">
          <p>
            Ajoute une cle TMDB dans le fichier .env puis relance l'app pour voir les films a
            decouvrir.
          </p>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="browser">
        <h2 className="discover__heading">Decouvrir</h2>
        <div className="browser__empty">
          <p>{error}</p>
          <button type="button" onClick={retry}>
            Reessayer
          </button>
        </div>
      </section>
    )
  }

  if (!rows) {
    return (
      <section className="browser">
        <h2 className="discover__heading">Decouvrir</h2>
        <p>Chargement des films...</p>
      </section>
    )
  }

  const featured = rows[0]?.movies.find((movie) => movie.backdropUrl && movie.overview)

  return (
    <>
      {selected && (
        <DiscoverDetail
          key={selected.id}
          movie={selected}
          ownedMedia={ownedByTmdbId.get(selected.id) ?? null}
          onBack={() => onSelect(null)}
          onPlay={onPlay}
          onOpenMedia={onOpenMedia}
        />
      )}

      {/* stays mounted behind a film page, so each row keeps its horizontal scroll */}
      <section className="discover" hidden={selected !== null}>
        {featured ? (
          <div
            className="detail__hero detail__hero--backdrop discover__hero"
            style={{ backgroundImage: `url("${featured.backdropUrl}")` }}
          >
            <div className="detail__hero-shade">
              <p className="detail__tagline">A la une cette semaine</p>
              <h1 className="detail__title">{featured.title}</h1>
              <p className="detail__tagline">
                {[
                  formatReleaseDate(featured.releaseDate, 'long'),
                  featured.rating ? `★ ${featured.rating.toFixed(1)}` : null,
                  featured.genres.slice(0, 3).join(', '),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="detail__overview discover__hero-overview">{featured.overview}</p>
              <div className="detail__actions">
                <button type="button" className="detail__play" onClick={() => open(featured)}>
                  Voir la fiche
                </button>
              </div>
            </div>
          </div>
        ) : (
          <h2 className="discover__heading">Decouvrir</h2>
        )}

        {rows.length === 0 && <p>TMDB n'a renvoye aucun film.</p>}

        {rows.map((row) => (
          <section key={row.id} className="discover__row">
            <h2>{row.title}</h2>
            <ul className="discover__list">
              {row.movies.map((movie) => (
                <DiscoverCard
                  key={movie.id}
                  movie={movie}
                  isOwned={ownedByTmdbId.has(movie.id)}
                  onSelect={open}
                />
              ))}
            </ul>
          </section>
        ))}

        <p className="discover__credit">
          Donnees et images fournies par TMDB. Ce produit utilise l'API TMDB mais n'est ni approuve
          ni certifie par TMDB.
        </p>
      </section>
    </>
  )
}
