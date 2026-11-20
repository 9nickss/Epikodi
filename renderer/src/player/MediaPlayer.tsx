import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { toMediaUrl } from '../../../shared/mediaUrl'
import type { MediaProbeResult, MediaRecord } from '../../../shared/types'
import {
  EMPTY_REMOTE_STATE,
  type RemoteCommand,
  type RemotePlayerState,
} from '../../../shared/remote'
import { displayTitle, formatDuration } from '../format'
import './MediaPlayer.css'
import type { NowPlaying } from './nowPlaying'
import { PlayerControls } from './PlayerControls'
import { PLAYBACK_RATES, usePlayerControls } from './usePlayerControls'

type MediaKind = 'video' | 'audio'

/** between two saves of the position while playing (Issue F1.1) */
const SAVE_INTERVAL_MS = 5_000

interface LoadedMedia {
  url: string
  kind: MediaKind
  name: string
  /** second line, e.g. "Radio web · Jazz" for a plugin stream */
  origin?: string
  /** how the phone remote shows it (#1.2) */
  remote: Pick<RemotePlayerState, 'title' | 'subtitle' | 'category'>
  /** poster or thumbnail URL, shown by the OS media controls (#2.1) */
  artwork?: string
}

type SpeedCategory = NonNullable<RemotePlayerState['category']>

const SPEED_STORAGE_PREFIX = 'epikodi.speed.'

/** speed is remembered per section (#2.1): podcasts are often listened to at 1.5x, films never */
function loadSpeed(category: SpeedCategory): number {
  try {
    const stored = Number(localStorage.getItem(SPEED_STORAGE_PREFIX + category))
    return (PLAYBACK_RATES as readonly number[]).includes(stored) ? stored : 1
  } catch {
    return 1
  }
}

function saveSpeed(category: SpeedCategory, rate: number): void {
  try {
    localStorage.setItem(SPEED_STORAGE_PREFIX + category, String(rate))
  } catch {
    // storage unavailable - the speed just won't be remembered
  }
}

/** state published to the phones at most once a second while only the position moves */
const REMOTE_PUBLISH_INTERVAL_MS = 1_000

function kindFromFile(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

interface MediaPlayerProps {
  /** library media or plugin stream to play; loaded whenever it changes */
  nowPlaying: NowPlaying | null
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

export function MediaPlayer({ nowPlaying, isActive }: MediaPlayerProps) {
  const libraryMedia = nowPlaying?.type === 'library' ? nowPlaying.media : null
  const stream = nowPlaying?.type === 'stream' ? nowPlaying.stream : null
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
   * already indexed in the library); resolveFilePath may throw if the path can't be known,
   * and is null for a remote stream - nothing local to probe or transcode
   */
  async function loadMedia(
    next: LoadedMedia,
    resolveFilePath: (() => string) | null,
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
    if (!resolveFilePath) {
      filePathRef.current = null
      setIsProbing(false)
      return
    }
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
        {
          url: toMediaUrl(libraryMedia.path),
          kind: libraryMedia.kind,
          name: libraryMedia.title,
          remote: {
            title: displayTitle(libraryMedia),
            subtitle:
              libraryMedia.kind === 'audio'
                ? (libraryMedia.artist ?? libraryMedia.albumArtist ?? libraryMedia.album)
                : ((libraryMedia.tmdb?.year ?? libraryMedia.year)?.toString() ?? null),
            category: libraryMedia.category,
          },
          artwork: (() => {
            const image = libraryMedia.tmdb?.posterPath ?? libraryMedia.thumbnailPath
            return image ? toMediaUrl(image) : undefined
          })(),
        },
        () => libraryMedia.path,
        { knownProbe: probeFromRecord(libraryMedia) },
      )
    })()
    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when the selection changes
  }, [libraryMedia])

  useEffect(() => {
    if (!stream) return
    savePosition()
    trackedMediaIdRef.current = null
    offerResume(null)
    const origin = [stream.pluginName, stream.subtitle].filter(Boolean).join(' · ')
    // a stream chosen in a plugin page (an external selection), not derivable from render
    void loadMedia(
      {
        url: stream.url,
        kind: stream.kind,
        name: stream.title,
        origin,
        remote: { title: stream.title, subtitle: origin, category: 'stream' },
      },
      null,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when the selection changes
  }, [stream])

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
    const remote = { title: file.name, subtitle: null, category: 'file' } as const
    await loadMedia(
      { url, kind, name: file.name, remote },
      () => window.epikodi.getPathForFile(file),
      {
        objectUrl: url,
      },
    )
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

  // --- phone remote (#1.2) -------------------------------------------------

  const lastPublishRef = useRef<{ at: number; key: string; state: RemotePlayerState | null }>({
    at: 0,
    key: '',
    state: null,
  })

  useEffect(() => {
    const state: RemotePlayerState = media
      ? {
          ...media.remote,
          kind: media.kind,
          position: controls.currentTime,
          duration:
            Number.isFinite(controls.duration) && controls.duration > 0 ? controls.duration : null,
          isPlaying: controls.isPlaying,
          volume: controls.volume,
          muted: controls.muted,
          awaitsResume: resumePosition !== null,
        }
      : EMPTY_REMOTE_STATE
    const last = lastPublishRef.current
    const now = Date.now()
    // everything but the position: a change there is sent right away
    const key = JSON.stringify({ ...state, position: 0 })
    // the phone extrapolates the position while playing - only a seek makes it drift
    const expected = last.state
      ? last.state.position + (last.state.isPlaying ? (now - last.at) / 1000 : 0)
      : 0
    const hasJumped = Math.abs(state.position - expected) > 2
    if (key === last.key && !hasJumped && now - last.at < REMOTE_PUBLISH_INTERVAL_MS) return
    lastPublishRef.current = { at: now, key, state }
    window.epikodi.publishRemoteState(state)
    // same rhythm for the OS media controls (#2.1), which extrapolate the position on their own
    if (state.duration !== null && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.setPositionState({
          duration: state.duration,
          position: Math.min(state.position, state.duration),
          playbackRate: controls.playbackRate,
        })
      } catch {
        // position past the end while a new file loads - the next update fixes it
      }
    }
  }, [
    media,
    controls.currentTime,
    controls.duration,
    controls.isPlaying,
    controls.volume,
    controls.muted,
    controls.playbackRate,
    resumePosition,
  ])

  // --- speed and OS media controls (#2.1) ----------------------------------

  const speedCategory: SpeedCategory | null = media ? (media.remote.category ?? 'file') : null
  useEffect(() => {
    // a live stream has no speed: back to 1x, the selector is hidden
    if (speedCategory)
      controls.setPlaybackRate(speedCategory === 'stream' ? 1 : loadSpeed(speedCategory))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the kind of media changes
  }, [speedCategory, media])

  function changeSpeed(rate: number): void {
    controls.setPlaybackRate(rate)
    if (speedCategory) saveSpeed(speedCategory, rate)
  }

  // keyboard < > change the speed inside the hook: remember it too
  const lastRateRef = useRef(controls.playbackRate)
  useEffect(() => {
    if (controls.playbackRate === lastRateRef.current) return
    lastRateRef.current = controls.playbackRate
    if (speedCategory && speedCategory !== 'stream') saveSpeed(speedCategory, controls.playbackRate)
  }, [controls.playbackRate, speedCategory])

  // title/artwork for the system media overlay and the ⏯ ⏮ ⏭ keys (MPRIS on Linux, SMTC on Windows)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = media
      ? new MediaMetadata({
          title: media.remote.title ?? media.name,
          artist: media.remote.subtitle ?? 'EpiKodi',
          album: 'EpiKodi',
          artwork: media.artwork ? [{ src: media.artwork }] : [],
        })
      : null
  }, [media])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = media
      ? controls.isPlaying
        ? 'playing'
        : 'paused'
      : 'none'
  }, [media, controls.isPlaying])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => !controls.isPlaying && applyRemoteCommandRef.current({ type: 'togglePlay' })],
      ['pause', () => controls.isPlaying && applyRemoteCommandRef.current({ type: 'togglePlay' })],
      ['stop', () => controls.isPlaying && applyRemoteCommandRef.current({ type: 'togglePlay' })],
      [
        'seekbackward',
        (details) =>
          applyRemoteCommandRef.current({ type: 'seekBy', seconds: -(details.seekOffset ?? 10) }),
      ],
      [
        'seekforward',
        (details) =>
          applyRemoteCommandRef.current({ type: 'seekBy', seconds: details.seekOffset ?? 10 }),
      ],
      [
        'seekto',
        (details) =>
          details.seekTime !== undefined &&
          applyRemoteCommandRef.current({ type: 'seekTo', position: details.seekTime }),
      ],
    ]
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // action not supported by this platform
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null)
        } catch {
          // same
        }
      }
    }
  }, [controls.isPlaying])

  function applyRemoteCommand(command: RemoteCommand): void {
    const canSeek = Number.isFinite(controls.duration) && controls.duration > 0
    switch (command.type) {
      case 'togglePlay':
        // the resume offer is still open: "play" from the phone means resume
        if (resumePositionRef.current !== null) answerResume(resumePositionRef.current)
        else controls.togglePlay()
        break
      case 'seekBy':
        if (canSeek) controls.seekBy(command.seconds)
        break
      case 'seekTo':
        if (canSeek) controls.seekTo(command.position)
        break
      case 'setVolume':
        controls.setVolume(command.volume)
        break
      case 'toggleMute':
        controls.toggleMute()
        break
    }
  }

  const applyRemoteCommandRef = useRef(applyRemoteCommand)
  useEffect(() => {
    applyRemoteCommandRef.current = applyRemoteCommand
  })
  useEffect(
    () => window.epikodi.onRemoteCommand((command) => applyRemoteCommandRef.current(command)),
    [],
  )

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
    // local files get the ffprobe/transcode hints instead; a stream has nothing else to say why
    onError: () => {
      if (!filePathRef.current && media?.origin) {
        setError('Flux injoignable : URL invalide, hors-ligne ou format non supporte.')
      }
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
          {media.origin && <p className="media-player__origin">{media.origin}</p>}

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
            playbackRate={controls.playbackRate}
            isPictureInPicture={
              media.kind === 'video' && document.pictureInPictureEnabled
                ? controls.isPictureInPicture
                : null
            }
            onPlaybackRateChange={changeSpeed}
            onTogglePictureInPicture={controls.togglePictureInPicture}
          />

          <p className="media-player__hint">
            Espace : lecture/pause · ←/→ : -5s/+5s · ↑/↓ : volume · M : muet · &lt; / &gt; : vitesse
            {media.kind === 'video' ? ' · F : plein ecran · P : Picture-in-Picture' : ''}
          </p>
        </div>
      )}
    </section>
  )
}
