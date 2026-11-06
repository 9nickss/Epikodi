import { useEffect, useMemo, useState } from 'react'
import type {
  AddSourceResult,
  IndexingPhase,
  IndexingProgress,
  MediaRecord,
  SourceRecord,
} from '../../../shared/types'

/** refresh the library every N files during indexing, so tags/posters show up progressively */
const REFRESH_EVERY = 10

export interface LibraryState {
  sources: SourceRecord[]
  media: MediaRecord[]
  mediaBySource: Record<number, MediaRecord[]>
  /** file walk in progress per source: files found so far */
  scanning: Record<number, number>
  /** post-walk indexing in progress per source (metadata, TMDB, then thumbnails) */
  indexing: Record<number, IndexingProgress>
  /** indexing phases that stopped early, per source */
  indexingErrors: Record<number, Partial<Record<IndexingPhase, string>>>
  tmdbConfigured: boolean
  isLoaded: boolean
  refresh: () => Promise<void>
  addSource: (request: () => Promise<AddSourceResult | null>) => Promise<AddSourceResult | null>
  removeSource: (sourceId: number) => Promise<void>
  rescanSource: (sourceId: number) => void
  /** swaps in a record updated outside a scan (e.g. TMDB rematch) */
  replaceMedia: (media: MediaRecord) => void
}

function without<T>(record: Record<number, T>, key: number): Record<number, T> {
  const next = { ...record }
  delete next[key]
  return next
}

/** single source of truth for the library, shared by every view (Issue 4.1) */
export function useLibrary(): LibraryState {
  const [sources, setSources] = useState<SourceRecord[]>([])
  const [media, setMedia] = useState<MediaRecord[]>([])
  const [scanning, setScanning] = useState<Record<number, number>>({})
  const [indexing, setIndexing] = useState<Record<number, IndexingProgress>>({})
  const [indexingErrors, setIndexingErrors] = useState<LibraryState['indexingErrors']>({})
  const [tmdbConfigured, setTmdbConfigured] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  async function refresh(): Promise<void> {
    const [nextSources, nextMedia] = await Promise.all([
      window.epikodi.listSources(),
      window.epikodi.listMedia(),
    ])
    setSources(nextSources)
    setMedia(nextMedia)
    setIsLoaded(true)
  }

  useEffect(() => {
    // fetch-on-mount: syncs with the external SQLite library via IPC, not derivable from render
    // eslint-disable-next-line react/set-state-in-effect -- see comment above
    void refresh()
    void window.epikodi.tmdbStatus().then(({ configured }) => setTmdbConfigured(configured))
  }, [])

  useEffect(() => {
    const unsubscribers = [
      window.epikodi.onScanProgress(({ sourceId, filesFound }) => {
        setScanning((prev) => ({ ...prev, [sourceId]: filesFound }))
      }),
      window.epikodi.onScanDone(({ sourceId }) => {
        setScanning((prev) => without(prev, sourceId))
        void refresh()
      }),
      window.epikodi.onIndexingProgress((progress) => {
        setIndexing((prev) => ({ ...prev, [progress.sourceId]: progress }))
        if (progress.done % REFRESH_EVERY === 0) void refresh()
      }),
      window.epikodi.onIndexingDone(({ sourceId, phase, error }) => {
        setIndexing((prev) => without(prev, sourceId))
        setIndexingErrors((prev) => {
          const phases = { ...prev[sourceId] }
          if (error) phases[phase] = error
          else delete phases[phase]
          return { ...prev, [sourceId]: phases }
        })
        void refresh()
      }),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])

  const mediaBySource = useMemo(() => {
    const grouped: Record<number, MediaRecord[]> = {}
    for (const item of media) (grouped[item.sourceId] ??= []).push(item)
    return grouped
  }, [media])

  async function addSource(
    request: () => Promise<AddSourceResult | null>,
  ): Promise<AddSourceResult | null> {
    const result = await request()
    if (result?.ok) {
      const { source } = result
      setSources((prev) => (prev.some((s) => s.id === source.id) ? prev : [...prev, source]))
    }
    return result
  }

  async function removeSource(sourceId: number): Promise<void> {
    await window.epikodi.removeSource(sourceId)
    await refresh()
  }

  function rescanSource(sourceId: number): void {
    setIndexingErrors((prev) => without(prev, sourceId))
    void window.epikodi.rescanSource(sourceId)
  }

  function replaceMedia(updated: MediaRecord): void {
    setMedia((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
  }

  return {
    sources,
    media,
    mediaBySource,
    scanning,
    indexing,
    indexingErrors,
    tmdbConfigured,
    isLoaded,
    refresh,
    addSource,
    removeSource,
    rescanSource,
    replaceMedia,
  }
}
