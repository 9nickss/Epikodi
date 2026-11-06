import { useState, type FormEvent } from 'react'
import { toMediaUrl } from '../../../shared/mediaUrl'
import type { MediaRecord } from '../../../shared/types'
import { Artwork } from '../browse/Artwork'
import { SECTION_LABELS } from '../browse/browseState'
import {
  displayTitle,
  displayYear,
  formatBitRate,
  formatRuntime,
  formatSize,
  ipcErrorMessage,
} from '../format'
import './MediaDetail.css'

interface MediaDetailProps {
  media: MediaRecord
  tmdbConfigured: boolean
  onBack: () => void
  onPlay: (media: MediaRecord) => void
  onMediaUpdated: (media: MediaRecord) => void
}

/** "Fiche" of one media (Issue 4.3): artwork, synopsis, tags, technical info and playback */
export function MediaDetail({
  media,
  tmdbConfigured,
  onBack,
  onPlay,
  onMediaUpdated,
}: MediaDetailProps) {
  const [isEditingMatch, setIsEditingMatch] = useState(false)
  const [matchTitle, setMatchTitle] = useState('')
  const [matchYear, setMatchYear] = useState('')
  const [isMatching, setIsMatching] = useState(false)
  const [matchMessage, setMatchMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const title = displayTitle(media)
  const year = displayYear(media)
  const fileName = media.path.split(/[\\/]/).at(-1) ?? media.path
  const isFilm = media.category === 'film'

  async function rematch(query?: { title: string; year: number | null }): Promise<void> {
    setIsMatching(true)
    setMatchMessage(null)
    try {
      const updated = await window.epikodi.rematchTmdb(media.id, query)
      onMediaUpdated(updated)
      setIsEditingMatch(false)
      setMatchMessage(
        updated.tmdb
          ? { text: `Associe a « ${updated.tmdb.title} »`, isError: false }
          : { text: 'Aucun film correspondant trouve sur TMDB.', isError: true },
      )
    } catch (error) {
      setMatchMessage({ text: ipcErrorMessage(error), isError: true })
    } finally {
      setIsMatching(false)
    }
  }

  function startEditingMatch(): void {
    setMatchTitle(media.tmdb?.title ?? media.title)
    setMatchYear(year ? String(year) : '')
    setMatchMessage(null)
    setIsEditingMatch(true)
  }

  function handleMatchSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsedYear = Number(matchYear)
    void rematch({
      title: matchTitle,
      year: matchYear.trim() && Number.isInteger(parsedYear) ? parsedYear : null,
    })
  }

  const facts: [string, string | null][] = [
    ['Duree', formatRuntime(media.durationSeconds)],
    ['Annee', year ? String(year) : null],
    ['Note TMDB', media.tmdb?.rating ? `★ ${media.tmdb.rating.toFixed(1)} / 10` : null],
    ['Artiste', media.artist],
    ['Album', media.album],
    ['Artiste de l’album', media.albumArtist !== media.artist ? media.albumArtist : null],
    ['Piste', media.trackNumber !== null ? String(media.trackNumber) : null],
    ['Genre', media.genre],
  ]

  const technical: [string, string | null][] = [
    ['Fichier', fileName],
    ['Emplacement', media.path],
    ['Taille', formatSize(media.sizeBytes)],
    ['Conteneur', media.formatName],
    ['Video', media.videoCodec],
    ['Audio', media.audioCodec],
    ['Resolution', media.width && media.height ? `${media.width} × ${media.height}` : null],
    ['Debit', formatBitRate(media.bitRate)],
    [
      'Lecture',
      media.isNativelyPlayable === null
        ? null
        : media.isNativelyPlayable
          ? 'Directe'
          : 'Conversion MP4 necessaire (FFmpeg)',
    ],
  ]

  const backdrop = media.tmdb?.backdropPath

  return (
    <article className="detail">
      <div
        className={`detail__hero${backdrop ? ' detail__hero--backdrop' : ''}`}
        style={backdrop ? { backgroundImage: `url("${toMediaUrl(backdrop)}")` } : undefined}
      >
        <div className="detail__hero-shade">
          <button type="button" className="detail__back" onClick={onBack}>
            ← {SECTION_LABELS[media.category]}
          </button>

          <div className="detail__main">
            <div className={`detail__artwork detail__artwork--${media.category}`}>
              <Artwork media={media} size="poster" />
            </div>

            <div className="detail__info">
              <h1 className="detail__title">{title}</h1>
              {media.tmdb && media.tmdb.originalTitle !== media.tmdb.title && (
                <p className="detail__original-title">{media.tmdb.originalTitle}</p>
              )}
              <p className="detail__tagline">
                {[year, formatRuntime(media.durationSeconds), media.artist, media.album]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              <div className="detail__actions">
                <button type="button" className="detail__play" onClick={() => onPlay(media)}>
                  ▶ Lire
                </button>
                {isFilm && tmdbConfigured && !isEditingMatch && (
                  <button
                    type="button"
                    className="detail__secondary"
                    onClick={startEditingMatch}
                    disabled={isMatching}
                  >
                    {media.tmdb ? 'Corriger la fiche TMDB' : 'Chercher sur TMDB'}
                  </button>
                )}
              </div>

              {isEditingMatch && (
                <form className="detail__match-form" onSubmit={handleMatchSubmit}>
                  <input
                    type="text"
                    value={matchTitle}
                    onChange={(event) => setMatchTitle(event.target.value)}
                    placeholder="Titre du film"
                    aria-label="Titre du film"
                    autoFocus
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={matchYear}
                    onChange={(event) => setMatchYear(event.target.value)}
                    placeholder="Annee"
                    aria-label="Annee"
                    className="detail__match-year"
                  />
                  <button type="submit" disabled={isMatching || !matchTitle.trim()}>
                    {isMatching ? 'Recherche...' : 'Rechercher'}
                  </button>
                  <button
                    type="button"
                    className="detail__secondary"
                    onClick={() => setIsEditingMatch(false)}
                  >
                    Annuler
                  </button>
                </form>
              )}

              {matchMessage && (
                <p
                  className={`detail__match-message${matchMessage.isError ? ' detail__match-message--error' : ''}`}
                >
                  {matchMessage.text}
                </p>
              )}

              {media.tmdb?.overview ? (
                <p className="detail__overview">{media.tmdb.overview}</p>
              ) : (
                isFilm && (
                  <p className="detail__overview detail__overview--muted">
                    {!tmdbConfigured
                      ? 'Ajoute une cle TMDB dans le fichier .env pour recuperer affiche et synopsis.'
                      : media.tmdbCheckedAt
                        ? 'Aucune fiche TMDB associee a ce fichier.'
                        : 'Fiche TMDB pas encore recherchee (relance un scan de la source).'}
                  </p>
                )
              )}
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
        </section>

        <section className="detail__section">
          <h2>Fichier</h2>
          {media.probeError && <p className="detail__warning">{media.probeError}</p>}
          <dl className="detail__facts detail__facts--technical">
            {technical
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        </section>
      </div>
    </article>
  )
}
