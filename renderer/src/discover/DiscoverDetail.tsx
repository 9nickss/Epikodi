import { useEffect, useState } from 'react'
import type { DiscoverDetails, DiscoverMovie, MediaRecord } from '../../../shared/types'
import { formatReleaseDate, formatRuntime } from '../format'

function languageName(code: string | null): string | null {
  return code ? (new Intl.DisplayNames(['fr'], { type: 'language' }).of(code) ?? code) : null
}

function isUpcoming(releaseDate: string | null): boolean {
  return releaseDate !== null && releaseDate > new Date().toISOString().slice(0, 10)
}

interface DiscoverDetailProps {
  movie: DiscoverMovie
  /** the library's copy of this film, if there is one */
  ownedMedia: MediaRecord | null
  onBack: () => void
  onPlay: (media: MediaRecord) => void
  onOpenMedia: (media: MediaRecord) => void
}

/** TMDB page of a film - shown from the list data at once, completed when the details arrive */
export function DiscoverDetail({
  movie,
  ownedMedia,
  onBack,
  onPlay,
  onOpenMedia,
}: DiscoverDetailProps) {
  const [details, setDetails] = useState<DiscoverDetails | null>(null)
  const [hasDetailsError, setHasDetailsError] = useState(false)

  useEffect(() => {
    let isCancelled = false
    window.epikodi
      .discoverDetails(movie.id)
      .then((loaded) => {
        if (!isCancelled) setDetails(loaded)
      })
      .catch(() => {
        if (!isCancelled) setHasDetailsError(true)
      })
    return () => {
      isCancelled = true
    }
  }, [movie.id])

  const release = formatReleaseDate(movie.releaseDate, 'long')
  const runtime = details?.runtimeMinutes ? formatRuntime(details.runtimeMinutes * 60) : null

  const facts: [string, string | null][] = [
    [isUpcoming(movie.releaseDate) ? 'Sortie prevue' : 'Sortie', release],
    ['Duree', runtime],
    ['Genres', movie.genres.join(', ') || null],
    [
      'Note TMDB',
      movie.rating
        ? `★ ${movie.rating.toFixed(1)} / 10 (${movie.voteCount.toLocaleString('fr-FR')} votes)`
        : null,
    ],
    ['Realisation', details?.directors.join(', ') || null],
    ['Langue originale', languageName(movie.originalLanguage)],
    ['Pays', details?.countries.join(', ') || null],
  ]

  return (
    <article className="detail discover-detail">
      <div
        className={`detail__hero${movie.backdropUrl ? ' detail__hero--backdrop' : ''}`}
        style={movie.backdropUrl ? { backgroundImage: `url("${movie.backdropUrl}")` } : undefined}
      >
        <div className="detail__hero-shade">
          <button type="button" className="detail__back" onClick={onBack}>
            ← Decouvrir
          </button>

          <div className="detail__main">
            <div className="detail__artwork detail__artwork--film">
              {movie.posterUrl ? (
                <img className="artwork artwork--poster" src={movie.posterUrl} alt="" />
              ) : (
                <div className="artwork artwork--poster artwork--placeholder artwork--film">
                  <span className="artwork__icon">🎬</span>
                </div>
              )}
            </div>

            <div className="detail__info">
              <h1 className="detail__title">{movie.title}</h1>
              {movie.originalTitle !== movie.title && (
                <p className="detail__original-title">{movie.originalTitle}</p>
              )}
              <p className="detail__tagline">
                {[release, runtime, movie.rating ? `★ ${movie.rating.toFixed(1)}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {details?.tagline && (
                <p className="detail__tagline discover-detail__slogan">{details.tagline}</p>
              )}

              {ownedMedia && (
                <div className="detail__actions">
                  <button type="button" className="detail__play" onClick={() => onPlay(ownedMedia)}>
                    ▶ Lire
                  </button>
                  <button
                    type="button"
                    className="detail__secondary"
                    onClick={() => onOpenMedia(ownedMedia)}
                  >
                    Voir dans la bibliotheque
                  </button>
                </div>
              )}

              <p className={`detail__overview${movie.overview ? '' : ' detail__overview--muted'}`}>
                {movie.overview || 'Pas de synopsis disponible sur TMDB.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="detail__sections">
        <section className="detail__section">
          <h2>Informations</h2>
          <dl className="detail__facts">
            {facts
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {hasDetailsError && (
            <p className="detail__warning">Duree et casting indisponibles pour le moment.</p>
          )}
        </section>

        {details && details.cast.length > 0 && (
          <section className="detail__section">
            <h2>Casting</h2>
            <ul className="discover-detail__cast">
              {details.cast.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  )
}
