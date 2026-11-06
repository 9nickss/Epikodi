import type { MediaCategory, MediaRecord } from '../../../shared/types'
import { displayTitle, displayYear, normalizeForSearch } from '../format'

/** search / sort / view mode of a library section (Issue 4.2) */

export type SortKey = 'title' | 'added' | 'year' | 'duration' | 'rating' | 'artist' | 'album'
export type ViewMode = 'grid' | 'list'

export interface BrowseState {
  query: string
  sort: SortKey
  mode: ViewMode
}

export const SECTION_LABELS: Readonly<Record<MediaCategory, string>> = {
  film: 'Films',
  music: 'Musique',
  podcast: 'Podcasts',
}

export const SORT_OPTIONS: Readonly<Record<MediaCategory, readonly SortKey[]>> = {
  film: ['title', 'added', 'year', 'duration', 'rating'],
  music: ['artist', 'album', 'title', 'added', 'duration'],
  podcast: ['added', 'title', 'duration'],
}

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  title: 'Titre',
  added: 'Ajout recent',
  year: 'Annee',
  duration: 'Duree',
  rating: 'Note TMDB',
  artist: 'Artiste',
  album: 'Album',
}

export const DEFAULT_BROWSE_STATE: Readonly<Record<MediaCategory, BrowseState>> = {
  film: { query: '', sort: 'title', mode: 'grid' },
  music: { query: '', sort: 'artist', mode: 'list' },
  podcast: { query: '', sort: 'added', mode: 'list' },
}

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

/** nulls always last, whatever the direction */
function compareNullable<T>(a: T | null, b: T | null, compare: (x: T, y: T) => number): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return compare(a, b)
}

function compareMedia(sort: SortKey, a: MediaRecord, b: MediaRecord): number {
  const byTitle = collator.compare(displayTitle(a), displayTitle(b))
  const byNumberDesc = (x: number, y: number) => y - x
  switch (sort) {
    case 'title':
      return byTitle
    case 'added':
      return b.addedAt.localeCompare(a.addedAt) || byTitle
    case 'year':
      return compareNullable(displayYear(a), displayYear(b), byNumberDesc) || byTitle
    case 'duration':
      return compareNullable(a.durationSeconds, b.durationSeconds, byNumberDesc) || byTitle
    case 'rating':
      return (
        compareNullable(a.tmdb?.rating ?? null, b.tmdb?.rating ?? null, byNumberDesc) || byTitle
      )
    case 'artist':
    case 'album': {
      const artist = compareNullable(
        a.artist ?? a.albumArtist,
        b.artist ?? b.albumArtist,
        collator.compare,
      )
      const album = compareNullable(a.album, b.album, collator.compare)
      const track = compareNullable(a.trackNumber, b.trackNumber, (x, y) => x - y)
      return (sort === 'artist' ? artist || album : album || artist) || track || byTitle
    }
  }
}

function searchableText(media: MediaRecord): string {
  const fileName = media.path.split(/[\\/]/).at(-1) ?? ''
  return normalizeForSearch(
    [
      displayTitle(media),
      media.title,
      media.tmdb?.originalTitle,
      media.artist,
      media.albumArtist,
      media.album,
      media.genre,
      displayYear(media),
      fileName,
    ]
      .filter(Boolean)
      .join(' '),
  )
}

/** every word of the query must appear somewhere (title, artist, album, file name...) */
export function filterAndSort(media: MediaRecord[], state: BrowseState): MediaRecord[] {
  const words = normalizeForSearch(state.query).split(/\s+/).filter(Boolean)
  const matching = words.length
    ? media.filter((item) => {
        const text = searchableText(item)
        return words.every((word) => text.includes(word))
      })
    : [...media]
  return matching.sort((a, b) => compareMedia(state.sort, a, b))
}
