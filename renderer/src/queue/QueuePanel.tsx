import { displayTitle, formatDuration } from '../format'
import { Artwork } from '../browse/Artwork'
import type { QueueEntry } from './useQueue'
import './QueuePanel.css'

interface QueuePanelProps {
  entries: QueueEntry[]
  index: number
  onJump: (index: number) => void
  onRemove: (key: string) => void
  onClear: () => void
}

function entryTitle(entry: QueueEntry): string {
  return entry.item.type === 'library' ? displayTitle(entry.item.media) : entry.item.stream.title
}

function entrySubtitle(entry: QueueEntry): string {
  if (entry.item.type === 'stream') return `${entry.item.stream.pluginName} · en direct`
  const { media } = entry.item
  return (
    [media.artist ?? media.albumArtist, media.album].filter(Boolean).join(' · ') ||
    formatDuration(media.durationSeconds) ||
    ''
  )
}

/** "À suivre" under the player (#3.4): the queue, with the current entry highlighted */
export function QueuePanel({ entries, index, onJump, onRemove, onClear }: QueuePanelProps) {
  const upcoming = index >= 0 ? entries.length - index - 1 : entries.length

  return (
    <section className="queue" aria-label="File de lecture">
      <header className="queue__header">
        <h2>A suivre</h2>
        <span className="queue__count">
          {entries.length === 0
            ? 'vide'
            : upcoming === 0
              ? 'dernier element'
              : `${upcoming} element${upcoming > 1 ? 's' : ''} ensuite`}
        </span>
        {entries.length > 1 && (
          <button type="button" className="queue__clear" onClick={onClear}>
            Vider
          </button>
        )}
      </header>

      {entries.length === 0 ? (
        <p className="queue__empty">
          La file est vide. Ajoute des elements avec le bouton ＋ des vignettes, ou lance « Tout
          lire » dans une section, un album ou un dossier.
        </p>
      ) : (
        <ol className="queue__list">
          {entries.map((entry, position) => {
            const isCurrent = position === index
            const isPast = index >= 0 && position < index
            return (
              <li
                key={entry.key}
                className={`queue__entry${isCurrent ? ' is-current' : ''}${isPast ? ' is-past' : ''}`}
              >
                <button
                  type="button"
                  className="queue__open"
                  onClick={() => onJump(position)}
                  aria-current={isCurrent ? 'true' : undefined}
                  title={isCurrent ? 'En cours' : 'Lire maintenant'}
                >
                  <span className="queue__position">{isCurrent ? '▶' : position + 1}</span>
                  {entry.item.type === 'library' ? (
                    <Artwork media={entry.item.media} size="thumb" />
                  ) : (
                    <span className="queue__stream-icon" aria-hidden="true">
                      📻
                    </span>
                  )}
                  <span className="queue__text">
                    <span className="queue__title">{entryTitle(entry)}</span>
                    <span className="queue__subtitle">{entrySubtitle(entry)}</span>
                  </span>
                </button>
                {!isCurrent && (
                  <button
                    type="button"
                    className="queue__remove"
                    onClick={() => onRemove(entry.key)}
                    aria-label={`Retirer ${entryTitle(entry)} de la file`}
                    title="Retirer de la file"
                  >
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
