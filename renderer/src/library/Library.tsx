import { useEffect, useState, type FormEvent } from 'react'
import type { AddSourceResult, MediaRecord, SourceRecord } from '../../../shared/types'
import './Library.css'

interface LibraryProps {
  onPlayMedia: (media: MediaRecord) => void
}

interface FolderListing {
  folders: string[]
  files: MediaRecord[]
}

/** path segments of a media file below its source root, e.g. ['Series', 'S01', 'ep1.mkv'] */
function relativeSegments(source: SourceRecord, media: MediaRecord): string[] {
  return media.path.slice(source.path.length).split(/[\\/]/).filter(Boolean)
}

/**
 * Derives the content of one sub-folder from the flat list of indexed media:
 * the scanner only stores files, so folders are whatever path segments sit
 * between the source root and those files (empty folders aren't shown).
 */
function listFolder(
  source: SourceRecord,
  media: MediaRecord[],
  folderPath: string[],
): FolderListing {
  const folders = new Set<string>()
  const files: MediaRecord[] = []
  for (const item of media) {
    const segments = relativeSegments(source, item)
    if (!folderPath.every((name, index) => segments[index] === name)) continue
    if (segments.length === folderPath.length + 1) files.push(item)
    else if (segments.length > folderPath.length + 1) folders.add(segments[folderPath.length])
  }
  return { folders: [...folders].sort((a, b) => a.localeCompare(b)), files }
}

const SCAN_STATUS_LABELS: Readonly<Record<NonNullable<SourceRecord['lastScanStatus']>, string>> = {
  ok: 'Dernier scan OK',
  partial: 'Scan incomplet',
  failed: 'Source inaccessible',
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function Library({ onPlayMedia }: LibraryProps) {
  const [sources, setSources] = useState<SourceRecord[]>([])
  const [mediaBySource, setMediaBySource] = useState<Record<number, MediaRecord[]>>({})
  const [scanning, setScanning] = useState<Record<number, number>>({})
  const [error, setError] = useState<string | null>(null)
  /** source currently being browsed, and the sub-folder path inside it */
  const [browsing, setBrowsing] = useState<{ sourceId: number; folderPath: string[] } | null>(null)
  /** typed path for network shares the native picker can't reach (UNC, mount points) */
  const [pathInput, setPathInput] = useState('')
  /** a source is being validated - a hung share can take up to the main-process timeout */
  const [isAdding, setIsAdding] = useState(false)

  async function refresh(): Promise<void> {
    const [nextSources, nextMedia] = await Promise.all([
      window.epikodi.listSources(),
      window.epikodi.listMedia(),
    ])
    setSources(nextSources)
    const grouped: Record<number, MediaRecord[]> = {}
    for (const media of nextMedia) {
      ;(grouped[media.sourceId] ??= []).push(media)
    }
    setMediaBySource(grouped)
  }

  useEffect(() => {
    // fetch-on-mount: syncs with the external SQLite library via IPC, not derivable from render
    // eslint-disable-next-line react/set-state-in-effect -- see comment above
    void refresh()
  }, [])

  useEffect(() => {
    const unsubscribeProgress = window.epikodi.onScanProgress(({ sourceId, filesFound }) => {
      setScanning((prev) => ({ ...prev, [sourceId]: filesFound }))
    })
    const unsubscribeDone = window.epikodi.onScanDone(({ sourceId }) => {
      setScanning((prev) => {
        const next = { ...prev }
        delete next[sourceId]
        return next
      })
      void refresh()
    })
    return () => {
      unsubscribeProgress()
      unsubscribeDone()
    }
  }, [])

  /** shared by the folder picker and the typed path; returns true when the source was added */
  async function addWith(request: () => Promise<AddSourceResult | null>): Promise<boolean> {
    setError(null)
    setIsAdding(true)
    try {
      const result = await request()
      if (!result) return false
      if (!result.ok) {
        setError(`Impossible d'ajouter ce dossier : ${result.error}`)
        return false
      }
      const { source } = result
      setSources((prev) => (prev.some((s) => s.id === source.id) ? prev : [...prev, source]))
      return true
    } catch {
      setError("Impossible d'ajouter ce dossier.")
      return false
    } finally {
      setIsAdding(false)
    }
  }

  async function handleAddSource(): Promise<void> {
    await addWith(() => window.epikodi.addSource())
  }

  async function handleAddPath(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!pathInput.trim()) return
    if (await addWith(() => window.epikodi.addSourcePath(pathInput))) setPathInput('')
  }

  async function handleRemoveSource(id: number): Promise<void> {
    await window.epikodi.removeSource(id)
    if (browsing?.sourceId === id) setBrowsing(null)
    await refresh()
  }

  function toggleBrowse(sourceId: number): void {
    setBrowsing((prev) => (prev?.sourceId === sourceId ? null : { sourceId, folderPath: [] }))
  }

  function openFolder(folderPath: string[]): void {
    setBrowsing((prev) => (prev ? { ...prev, folderPath } : prev))
  }

  function renderBrowser(source: SourceRecord, folderPath: string[]) {
    const { folders, files } = listFolder(source, mediaBySource[source.id] ?? [], folderPath)
    return (
      <div className="library__browser">
        <nav className="library__breadcrumbs">
          <button type="button" onClick={() => openFolder([])}>
            {source.label}
          </button>
          {folderPath.map((name, index) => (
            <span key={index}>
              <span className="library__breadcrumb-sep">/</span>
              <button type="button" onClick={() => openFolder(folderPath.slice(0, index + 1))}>
                {name}
              </button>
            </span>
          ))}
        </nav>

        {folders.length === 0 && files.length === 0 ? (
          <p className="library__empty">Aucun media dans ce dossier.</p>
        ) : (
          <ul className="library__entries">
            {folderPath.length > 0 && (
              <li>
                <button
                  type="button"
                  className="library__entry"
                  onClick={() => openFolder(folderPath.slice(0, -1))}
                >
                  <span className="library__entry-icon">↩</span>
                  <span className="library__entry-name">..</span>
                </button>
              </li>
            )}
            {folders.map((name) => (
              <li key={`dir:${name}`}>
                <button
                  type="button"
                  className="library__entry"
                  onClick={() => openFolder([...folderPath, name])}
                >
                  <span className="library__entry-icon">📁</span>
                  <span className="library__entry-name">{name}</span>
                </button>
              </li>
            ))}
            {files.map((media) => (
              <li key={media.id}>
                <button
                  type="button"
                  className="library__entry"
                  title={media.path}
                  onClick={() => onPlayMedia(media)}
                >
                  <span className="library__entry-icon">
                    {media.kind === 'video' ? '🎬' : '🎵'}
                  </span>
                  <span className="library__entry-name">{media.title}</span>
                  {formatDuration(media.durationSeconds) && (
                    <span className="library__entry-meta">
                      {formatDuration(media.durationSeconds)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <section className="library">
      <div className="library__header">
        <h2>Bibliotheque</h2>
        <button type="button" onClick={handleAddSource} disabled={isAdding}>
          Ajouter un dossier
        </button>
      </div>

      <form className="library__path-form" onSubmit={(event) => void handleAddPath(event)}>
        <input
          type="text"
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          placeholder="Ou un chemin reseau : /mnt/nas/films, \\serveur\partage (Windows)..."
          aria-label="Chemin du dossier source"
          disabled={isAdding}
        />
        <button type="submit" disabled={isAdding || !pathInput.trim()}>
          {isAdding ? 'Verification...' : 'Ajouter'}
        </button>
      </form>

      {error && <p className="library__error">{error}</p>}

      {sources.length === 0 ? (
        <p className="library__empty">Aucune source pour l'instant.</p>
      ) : (
        <ul className="library__sources">
          {sources.map((source) => {
            const mediaCount = mediaBySource[source.id]?.length ?? 0
            const scanCount = scanning[source.id]
            return (
              <li key={source.id} className="library__source">
                <div className="library__source-header">
                  <div>
                    <p className="library__source-label">
                      {source.label}
                      {source.isNetwork && <span className="library__badge">reseau</span>}
                    </p>
                    <p className="library__source-path">{source.path}</p>
                  </div>
                  <div className="library__source-actions">
                    <button
                      type="button"
                      className="library__browse-button"
                      onClick={() => toggleBrowse(source.id)}
                      aria-expanded={browsing?.sourceId === source.id}
                    >
                      {browsing?.sourceId === source.id ? 'Fermer' : 'Parcourir'}
                    </button>
                    <button
                      type="button"
                      className="library__browse-button"
                      onClick={() => void window.epikodi.rescanSource(source.id)}
                      disabled={scanCount !== undefined}
                    >
                      Rescanner
                    </button>
                    <button
                      type="button"
                      className="library__remove-button"
                      onClick={() => void handleRemoveSource(source.id)}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
                <p className="library__source-status">
                  {scanCount !== undefined ? (
                    `Analyse en cours... ${scanCount} fichier(s) trouve(s)`
                  ) : (
                    <>
                      {`${mediaCount} media(s)`}
                      {source.lastScanStatus && (
                        <span
                          className={`library__scan-status library__scan-status--${source.lastScanStatus}`}
                        >
                          {SCAN_STATUS_LABELS[source.lastScanStatus]}
                        </span>
                      )}
                    </>
                  )}
                </p>
                {scanCount === undefined && source.lastScanError && (
                  <p className="library__source-error">{source.lastScanError}</p>
                )}
                {browsing?.sourceId === source.id && renderBrowser(source, browsing.folderPath)}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
