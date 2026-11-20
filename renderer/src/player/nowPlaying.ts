import type { MediaKind, MediaRecord } from '../../../shared/types'
import { displayTitle } from '../format'

/** a remote stream a plugin asked to play (`player.play`, see shared/plugins.ts) */
export interface StreamMedia {
  url: string
  title: string
  subtitle: string | null
  kind: MediaKind
  pluginId: string
  pluginName: string
}

/** what the player was last asked to play: a library entry or a plugin stream */
export type NowPlaying =
  { type: 'library'; media: MediaRecord } | { type: 'stream'; stream: StreamMedia }

export function nowPlayingTitle(nowPlaying: NowPlaying): string {
  return nowPlaying.type === 'library' ? displayTitle(nowPlaying.media) : nowPlaying.stream.title
}
