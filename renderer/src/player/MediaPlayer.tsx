import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { toMediaUrl } from '../../../shared/mediaUrl'
import type { MediaProbeResult, MediaRecord } from '../../../shared/types'
import { formatDuration } from '../format'
import './MediaPlayer.css'
import { PlayerControls } from './PlayerControls'
import { usePlayerControls } from './usePlayerControls'

type MediaKind = 'video' | 'audio'

/** between two saves of the position while playing (Issue F1.1) */
const SAVE_INTERVAL_MS = 5_000

interface LoadedMedia {
  url: string
  kind: MediaKind
  name: string
}

function kindFromFile(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

interface MediaPlayerProps {
  /** media picked in the library browser; loaded whenever it changes */
  libraryMedia: MediaRecord | null
  /** keyboard shortcuts only while the player is on screen - arrows must not seek a hidden video */
  isActive: boolean
}

/** ffprobe result already stored by library indexing (Issue 3.4) - null if not extracted yet */
function probeFromRecord(media: MediaRecord): MediaProbeResult | null {
  if (!media.probedAt || media.probeError || media.isNativelyPlayable === null) return null
  return {
    formatName: media.formatName,
    formatLongName: null,
    durationSeconds: media.durationSeconds,
    videoCodec: media.videoCodec,
    audioCodec: media.audioCodec,
    isNativelyPlayable: media.isNativelyPlayable,
  }
}

export function MediaPlayer({ libraryMedia, isActive }: MediaPlayerProps) {
  const [media, setMedia] = useState<LoadedMedia | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [probe, setProbe] = useState<MediaProbeResult | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [isProbing, setIsProbing] = useState(false)
  const [transcodedUrl, setTranscodedUrl] = useState<string | null>(null)
  const [transcodeProgress, setTranscodeProgress] = useState<number | null>(null)
  const [transcodeError, setTranscodeError] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const filePathRef = useRef<string | null>(null)
  const transcodeRequestIdRef = useRef<string | null>(null)
  /** position offered to resume from - playback waits for an answer */
  const [resumePosition, setResumePosition] = useState<number | null>(null)
  const resumePositionRef = useRef<number | null>(null)
  /** library media whose position is being saved - null for a file picked by hand, or music */
  const trackedMediaIdRef = useRef<number | null>(null)
  const lastSaveRef = useRef(0)

  const activeUrl = transcodedUrl ?? media?.url ?? ''
  const controls = usePlayerControls(activeUrl, media?.kind === 'video', isActive)

  function offerResume(position: number | null): void {
    resumePositionRef.current = position
    setResumePosition(position)
  }

  /** nothing while the resume offer is open: the element is at 0 and would erase the position */
  function savePosition(): void {
    const playback = controls.getPlayback()
    const mediaId = trackedMediaIdRef.current
    if (mediaId === null || !playback || resumePositionRef.current !== null) return
    lastSaveRef.current = Date.now()
    void window.epikodi.savePlayback(mediaId, playback.position, playback.duration)
  }

  // the latest render's closure, for listeners attached once
  const savePositionRef = useRef(savePosition)
  useEffect(() => {
    savePositionRef.current = savePosition
  })

  useEffect(() => {
    const handleUnload = (): void => savePositionRef.current()
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

  // revoke the last object URL whenever it gets replaced or the component unmounts
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    return window.epikodi.onTranscodeProgress(({ requestId, percent }) => {
      if (requestId === transcodeRequestIdRef.current) {
        setTranscodeProgress(percent)
      }
    })
  }, [])

  /**
   * swaps in a new media and probes it (skipped when knownProbe is given, e.g. metadata
   * already indexed in the library); resolveFilePath may throw if the path can't be known
   */
  async function loadMedia(
    next: LoadedMedia,
    resolveFilePath: () => string,
    {
      objectUrl = null,
      knownProbe = null,
    }: { objectUrl?: string | null; knownProbe?: MediaProbeResult | null } = {},
  ): Promise<void> {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }
    objectUrlRef.current = objectUrl

    setError(null)
    setMedia(next)

    setTranscodedUrl(null)
    setTranscodeProgress(null)
    setTranscodeError(null)
    transcodeRequestIdRef.current = null

    setProbe(knownProbe)
    setProbeError(null)
    setIsProbing(knownProbe === null)
    try {
      const filePath = resolveFilePath()
      filePathRef.current = filePath
      if (!knownProbe) setProbe(await window.epikodi.probeMedia(filePath))
    } catch {
      filePathRef.current = null
      setProbeError(
        'Analyse du format impossible (ffprobe introuvable ou erreur) - lecture tentee quand meme.',
      )
    } finally {
      setIsProbing(false)
    }
  }

  useEffect(() => {
    // the same media again: it's already loaded, and a reload would interrupt it
    if (!libraryMedia || libraryMedia.id === trackedMediaIdRef.current) return
    savePosition()

    // resuming in the middle of a song makes no sense
    const canResume = libraryMedia.category !== 'music'
    let isCancelled = false
    void (async () => {
      // known before the element mounts, which decides whether it autoplays
      const position = canResume
        ? await window.epikodi.getResumePosition(libraryMedia.id).catch(() => null)
        : null
      if (isCancelled) return
      trackedMediaIdRef.current = canResume ? libraryMedia.id : null
      offerResume(position)
      // loads the file chosen in the library (an external selection), not derivable from render
      await loadMedia(
        { url: toMediaUrl(libraryMedia.path), kind: libraryMedia.kind, name: libraryMedia.title },
        () => libraryMedia.path,
        { knownProbe: probeFromRecord(libraryMedia) },
      )
    })()
    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when the selection changes
  }, [libraryMedia])

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const kind = kindFromFile(file)
    if (!kind) {
      setError(`Format non reconnu : ${file.type || file.name}`)
      setMedia(null)
      return
    }

    savePosition()
    trackedMediaIdRef.current = null
    offerResume(null)

    const url = URL.createObjectURL(file)
    await loadMedia({ url, kind, name: file.name }, () => window.epikodi.getPathForFile(file), {
      objectUrl: url,
    })
  }

  async function handleTranscode(): Promise<void> {
    if (!filePathRef.current) return

    const requestId = crypto.randomUUID()
    transcodeRequestIdRef.current = requestId
    setTranscodeError(null)
    setTranscodeProgress(0)
    try {
      const { fileUrl } = await window.epikodi.transcodeMedia(
        filePathRef.current,
        probe?.durationSeconds ?? null,
        requestId,
      )
      if (transcodeRequestIdRef.current === requestId) {
        setTranscodedUrl(fileUrl)
      }
    } catch {
      if (transcodeRequestIdRef.current === requestId) {
        setTranscodeError('Le transcodage a echoue (FFmpeg absent ou fichier illisible).')
      }
    } finally {
      if (transcodeRequestIdRef.current === requestId) {
        setTranscodeProgress(null)
      }
    }
  }

  function answerResume(position: number): void {
    offerResume(null)
    controls.playFrom(position)
  }

  const mediaEventHandlers = {
    ...controls.mediaEventHandlers,
    onTimeUpdate: () => {
      controls.mediaEventHandlers.onTimeUpdate()
      if (Date.now() - lastSaveRef.current >= SAVE_INTERVAL_MS) savePosition()
    },
    onPause: () => {
      controls.mediaEventHandlers.onPause()
      savePosition()
    },
    onEnded: () => {
      controls.mediaEventHandlers.onEnded()
      savePosition()
    },
  }

  /** a file waiting for its MP4 conversion can't be played yet */
  const isPlayable = !probe || probe.isNativelyPlayable || transcodedUrl !== null

  return (
    <section className="media-player">
      <h2 className="media-player__heading">Lecteur</h2>
      <label className="media-player__picker">
        <input type="file" accept="video/*,audio/*" onChange={handleFileChange} />
        Choisir un fichier video ou audio
      </label>

      {error && <p className="media-player__error">{error}</p>}

      {media && (
        <div className="media-player__stage" ref={controls.containerRef}>
          <p className="media-player__name">{media.name}</p>

          {isProbing && (
            <p className="media-player__probe media-player__probe--pending">
              Analyse du format (ffprobe)…
            </p>
          )}

          {probeError && (
            <p className="media-player__probe media-player__probe--warning">{probeError}</p>
          )}

          {probe && (
            <p
              className={`media-player__probe ${probe.isNativelyPlayable || transcodedUrl ? 'media-player__probe--ok' : 'media-player__probe--warning'}`}
            >
              {probe.formatName ?? 'format inconnu'}
              {probe.videoCodec ? ` · video ${probe.videoCodec}` : ''}
              {probe.audioCodec ? ` · audio ${probe.audioCodec}` : ''}
              {' · '}
              {transcodedUrl
                ? 'lecture de la version convertie (MP4)'
                : probe.isNativelyPlayable
                  ? 'lecture directe'
                  : 'lecture native peu probable'}
            </p>
          )}

          {probe && !probe.isNativelyPlayable && !transcodedUrl && (
            <div className="media-player__transcode">
              <button
                type="button"
                className="media-player__transcode-button"
                onClick={handleTranscode}
                disabled={transcodeProgress !== null}
              >
                {transcodeProgress === null
                  ? 'Convertir en MP4 (FFmpeg) et lire'
                  : `Conversion en cours… ${Math.round(transcodeProgress)}%`}
              </button>

              {transcodeProgress !== null && (
                <progress
                  className="media-player__transcode-progress"
                  value={transcodeProgress}
                  max={100}
                />
              )}

              {transcodeError && (
                <p className="media-player__probe media-player__probe--warning">{transcodeError}</p>
              )}
            </div>
          )}

          {resumePosition !== null && isPlayable && (
            <div className="media-player__resume">
              <button
                type="button"
                className="media-player__resume-button"
                onClick={() => answerResume(resumePosition)}
              >
                ▶ Reprendre a {formatDuration(resumePosition)}
              </button>
              <button
                type="button"
                className="media-player__restart-button"
                onClick={() => answerResume(0)}
              >
                Recommencer
              </button>
            </div>
          )}

          {media.kind === 'video' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- controlled via PlayerControls, not native controls
            <video
              key={activeUrl}
              // eslint-disable-next-line react/refs -- callback ref only writes mediaRef.current, standard React pattern
              ref={controls.setMediaElement}
              className="media-player__video"
              src={activeUrl}
              autoPlay={resumePosition === null}
              {...mediaEventHandlers}
            />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- controlled via PlayerControls, not native controls
            <audio
              key={activeUrl}
              // eslint-disable-next-line react/refs -- callback ref only writes mediaRef.current, standard React pattern
              ref={controls.setMediaElement}
              className="media-player__audio"
              src={activeUrl}
              autoPlay={resumePosition === null}
              {...mediaEventHandlers}
            />
          )}

          <PlayerControls
            isPlaying={controls.isPlaying}
            currentTime={controls.currentTime}
            duration={controls.duration}
            volume={controls.volume}
            muted={controls.muted}
            isFullscreen={controls.isFullscreen}
            showFullscreen={media.kind === 'video'}
            onTogglePlay={controls.togglePlay}
            onSeek={controls.seekTo}
            onVolumeChange={controls.setVolume}
            onToggleMute={controls.toggleMute}
            onToggleFullscreen={controls.toggleFullscreen}
          />

          <p className="media-player__hint">
            Espace : lecture/pause · ←/→ : -5s/+5s · ↑/↓ : volume · M : muet
            {media.kind === 'video' ? ' · F : plein ecran' : ''}
          </p>
        </div>
      )}
    </section>
  )
}
