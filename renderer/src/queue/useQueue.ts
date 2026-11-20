import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaRecord } from '../../../shared/types'
import type { NowPlaying, StreamMedia } from '../player/nowPlaying'

/**
 * Play queue (#3.3): what's playing plus what comes next. It replaces the
 * single "now playing" of the app: playing a film makes a one-item queue,
 * "Tout lire" a queue of the whole album / folder / section, ＋ appends.
 *
 * Library entries are saved in SQLite and restored at startup, paused on the
 * current entry (the resume offer of F1.1 then applies). Plugin streams are
 * not saved: a radio URL from last week may not exist anymore.
 */

export type QueueItem =
  { type: 'library'; media: MediaRecord } | { type: 'stream'; stream: StreamMedia }

export interface QueueEntry {
  /** unique per entry, so the same film twice in the queue stays two entries */
  key: string
  item: QueueItem
}

interface QueueState {
  entries: QueueEntry[]
  /** current entry, -1 when the queue is empty */
  index: number
  /** false right after a restore: the current entry loads without starting */
  autoplay: boolean
  /** how the current entry treats a saved position, see NowPlaying.resume */
  resume: 'ask' | 'auto'
}

const EMPTY: QueueState = { entries: [], index: -1, autoplay: true, resume: 'ask' }

let nextKey = 0
const entryOf = (item: QueueItem): QueueEntry => ({ key: `q${(nextKey += 1)}`, item })
const libraryEntry = (media: MediaRecord): QueueEntry => entryOf({ type: 'library', media })

export interface QueueControls {
  entries: QueueEntry[]
  index: number
  nowPlaying: NowPlaying | null
  hasPrevious: boolean
  hasNext: boolean
  /** plays this media right away - what was queued after the current entry still follows */
  playNow: (media: MediaRecord) => void
  /** replaces the queue with the list and starts at `start` */
  playAll: (list: MediaRecord[], start?: number) => void
  playStream: (stream: StreamMedia) => void
  /** appends at the end - starts playing when nothing was queued */
  enqueue: (list: MediaRecord[]) => void
  remove: (key: string) => void
  /** keeps only what's playing */
  clear: () => void
  jumpTo: (index: number) => void
  next: () => void
  previous: () => void
}

export function useQueue(library: MediaRecord[], isLibraryLoaded: boolean): QueueControls {
  const [state, setState] = useState<QueueState>(EMPTY)

  // restore once, when the library records are there to map the saved ids to
  const restoredRef = useRef(false)
  /** no save before the saved queue has been read back - it would erase it */
  const [canSave, setCanSave] = useState(false)
  useEffect(() => {
    if (!isLibraryLoaded || restoredRef.current) return
    restoredRef.current = true
    void window.epikodi.loadQueue().then(
      ({ mediaIds, index }) => {
        const byId = new Map(library.map((media) => [media.id, media]))
        const entries = mediaIds
          .map((id) => byId.get(id))
          .filter((media): media is MediaRecord => media !== undefined)
          .map(libraryEntry)
        setCanSave(true)
        if (entries.length === 0) return
        // something was started meanwhile: don't replace it
        setState((current) =>
          current.entries.length > 0
            ? current
            : {
                entries,
                index: Math.min(index, entries.length - 1),
                autoplay: false,
                resume: 'ask',
              },
        )
      },
      () => setCanSave(true),
    )
  }, [isLibraryLoaded, library])

  // keep the records fresh (TMDB title, progress...) and drop media removed from the library
  const entries = useMemo(() => {
    if (!isLibraryLoaded) return state.entries
    const byId = new Map(library.map((media) => [media.id, media]))
    return state.entries.flatMap((entry): QueueEntry[] => {
      if (entry.item.type !== 'library') return [entry]
      const media = byId.get(entry.item.media.id)
      return media ? [{ key: entry.key, item: { type: 'library', media } }] : []
    })
  }, [state.entries, library, isLibraryLoaded])

  const current = state.index >= 0 ? state.entries[state.index] : undefined
  const index = current ? entries.findIndex((entry) => entry.key === current.key) : -1

  // saved after each change (only library entries), restored at the next startup
  useEffect(() => {
    if (!canSave) return
    const saved = entries.filter((entry) => entry.item.type === 'library')
    const mediaIds = saved.map((entry) => (entry.item as { media: MediaRecord }).media.id)
    const savedIndex = current ? saved.findIndex((entry) => entry.key === current.key) : -1
    void window.epikodi
      .saveQueue({ mediaIds, index: Math.max(0, savedIndex) })
      .catch(() => undefined)
  }, [entries, current, canSave])

  const nowPlaying = useMemo((): NowPlaying | null => {
    const entry = index >= 0 ? entries[index] : undefined
    if (!entry) return null
    const common = { key: entry.key, autoplay: state.autoplay, resume: state.resume }
    return entry.item.type === 'library'
      ? { type: 'library', media: entry.item.media, ...common }
      : { type: 'stream', stream: entry.item.stream, ...common }
  }, [entries, index, state.autoplay, state.resume])

  /** moves within the queue as it's displayed (entries of removed media already gone) */
  function goTo(target: number): void {
    const entry = entries[target]
    if (!entry) return
    setState({ entries, index: target, autoplay: true, resume: 'auto' })
  }

  return {
    entries,
    index,
    nowPlaying,
    hasPrevious: index > 0,
    hasNext: index >= 0 && index < entries.length - 1,
    // what was queued with ＋ after the current entry still follows (never wiped by a ▶)
    playNow: (media) =>
      setState({
        entries: [libraryEntry(media), ...entries.slice(index + 1)],
        index: 0,
        autoplay: true,
        resume: 'ask',
      }),
    playAll: (list, start = 0) => {
      if (list.length === 0) return
      setState({
        entries: list.map(libraryEntry),
        index: Math.min(Math.max(start, 0), list.length - 1),
        autoplay: true,
        resume: 'ask',
      })
    },
    playStream: (stream) =>
      setState({
        entries: [entryOf({ type: 'stream', stream })],
        index: 0,
        autoplay: true,
        resume: 'ask',
      }),
    enqueue: (list) => {
      if (list.length === 0) return
      const added = list.map(libraryEntry)
      setState(
        index === -1
          ? {
              entries: [...entries, ...added],
              index: entries.length,
              autoplay: true,
              resume: 'ask',
            }
          : { ...state, entries: [...entries, ...added], index },
      )
    },
    remove: (key) => {
      const target = entries.findIndex((entry) => entry.key === key)
      // the current entry stays: removing it would cut playback without warning
      if (target === -1 || target === index) return
      const remaining = entries.filter((entry) => entry.key !== key)
      setState({ ...state, entries: remaining, index: target < index ? index - 1 : index })
    },
    clear: () => {
      const entry = entries[index]
      setState(entry ? { ...state, entries: [entry], index: 0 } : EMPTY)
    },
    jumpTo: goTo,
    next: () => goTo(index + 1),
    previous: () => goTo(index - 1),
  }
}
