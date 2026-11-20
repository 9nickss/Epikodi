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
export type NowPlaying = (
  { type: 'library'; media: MediaRecord } | { type: 'stream'; stream: StreamMedia }
) & {
  /**
   * queue entry it comes from (#3.3) - the player reloads when it changes, so
   * playing the same film again restarts it, while a library refresh (new
   * record, same entry) doesn't interrupt it
   */
  key: string
  /** false for a queue restored at startup: loaded, waiting for play */
  autoplay: boolean
  /**
   * saved position: 'ask' offers "Reprendre / Recommencer" (a ▶ clicked, a restored queue);
   * 'auto' resumes without asking - moving through the queue must never stall on a question
   */
  resume: 'ask' | 'auto'
}

export function nowPlayingTitle(nowPlaying: Pick<NowPlaying, 'type'> & NowPlaying): string {
  return nowPlaying.type === 'library' ? displayTitle(nowPlaying.media) : nowPlaying.stream.title
}
