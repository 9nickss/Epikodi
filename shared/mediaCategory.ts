import type { MediaKind } from './types'

/** library sections (Issue 4.1) - finer than MediaKind, which only says video/audio */
export type MediaCategory = 'film' | 'music' | 'podcast'

export interface CategoryInput {
  kind: MediaKind
  path: string
  genre: string | null
}

/**
 * Podcasts are audio files tagged with a "Podcast" genre (what most podcast
 * apps write) or stored under a folder whose name contains "podcast"; any
 * other audio is music and every video goes to Films.
 */
export function categoryForMedia({ kind, path, genre }: CategoryInput): MediaCategory {
  if (kind === 'video') return 'film'
  if (genre && /podcast/i.test(genre)) return 'podcast'
  if (path.split(/[\\/]/).some((segment) => /podcast/i.test(segment))) return 'podcast'
  return 'music'
}
