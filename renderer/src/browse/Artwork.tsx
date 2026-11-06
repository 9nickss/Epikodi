import { toMediaUrl } from '../../../shared/mediaUrl'
import type { MediaRecord } from '../../../shared/types'
import { displayTitle } from '../format'
import './MediaBrowser.css'

/** TMDB poster when the film was matched, then the video's own thumbnail, then a per-section placeholder */
export function Artwork({
  media,
  size,
}: {
  media: MediaRecord
  size: 'card' | 'thumb' | 'poster'
}) {
  const image = media.tmdb?.posterPath ?? media.thumbnailPath
  if (image) {
    return (
      <img
        className={`artwork artwork--${size}`}
        src={toMediaUrl(image)}
        alt=""
        loading="lazy"
        draggable={false}
      />
    )
  }
  const icon = media.category === 'film' ? '🎬' : media.category === 'podcast' ? '🎙️' : '🎵'
  return (
    <div className={`artwork artwork--${size} artwork--placeholder artwork--${media.category}`}>
      <span className="artwork__icon">{icon}</span>
      {size !== 'thumb' && <span className="artwork__title">{displayTitle(media)}</span>}
    </div>
  )
}
