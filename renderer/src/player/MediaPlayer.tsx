import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { MediaProbeResult } from '../../../shared/types'
import './MediaPlayer.css'
import { PlayerControls } from './PlayerControls'
import { usePlayerControls } from './usePlayerControls'

type MediaKind = 'video' | 'audio'

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

export function MediaPlayer() {
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

  const activeUrl = transcodedUrl ?? media?.url ?? ''
  const controls = usePlayerControls(activeUrl, media?.kind === 'video')

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

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }

    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setError(null)
    setMedia({ url, kind, name: file.name })

    setTranscodedUrl(null)
    setTranscodeProgress(null)
    setTranscodeError(null)
    transcodeRequestIdRef.current = null

    setProbe(null)
    setProbeError(null)
    setIsProbing(true)
    try {
      const filePath = window.epikodi.getPathForFile(file)
      filePathRef.current = filePath
      setProbe(await window.epikodi.probeMedia(filePath))
    } catch {
      filePathRef.current = null
      setProbeError(
        "Analyse du format impossible (ffprobe introuvable ou erreur) - lecture tentee quand meme.",
      )
    } finally {
      setIsProbing(false)
    }
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

  return (
    <section className="media-player">
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

          {probeError && <p className="media-player__probe media-player__probe--warning">{probeError}</p>}

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

              {transcodeError && <p className="media-player__probe media-player__probe--warning">{transcodeError}</p>}
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
              autoPlay
              {...controls.mediaEventHandlers}
            />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- controlled via PlayerControls, not native controls
            <audio
              key={activeUrl}
              // eslint-disable-next-line react/refs -- callback ref only writes mediaRef.current, standard React pattern
              ref={controls.setMediaElement}
              className="media-player__audio"
              src={activeUrl}
              autoPlay
              {...controls.mediaEventHandlers}
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
