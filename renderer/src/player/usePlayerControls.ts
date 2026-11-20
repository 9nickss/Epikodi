import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** speeds offered in the player (#2.1) - `<` / `>` step through them */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

interface UsePlayerControlsResult {
  setMediaElement: (el: HTMLMediaElement | null) => void
  containerRef: RefObject<HTMLDivElement | null>
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  isFullscreen: boolean
  playbackRate: number
  isPictureInPicture: boolean
  /** live position read off the element, null when nothing with a known duration is loaded */
  getPlayback: () => { position: number; duration: number } | null
  /** starts playing from `time`, waiting for the metadata when they aren't loaded yet */
  playFrom: (time: number) => void
  togglePlay: () => void
  seekTo: (time: number) => void
  seekBy: (deltaSeconds: number) => void
  setVolume: (value: number) => void
  adjustVolume: (delta: number) => void
  toggleMute: () => void
  toggleFullscreen: () => void
  /** kept across files: applied to every element mounted afterwards */
  setPlaybackRate: (rate: number) => void
  /** video only - keeps playing in a floating window while browsing the library */
  togglePictureInPicture: () => void
  mediaEventHandlers: {
    onPlay: () => void
    onPause: () => void
    onEnded: () => void
    onTimeUpdate: () => void
    onLoadedMetadata: () => void
    onVolumeChange: () => void
  }
}

/** Drives a <video>/<audio> element imperatively and mirrors its state back into React. */
export function usePlayerControls(
  resetKey: string,
  canFullscreen: boolean,
  shortcutsEnabled = true,
): UsePlayerControlsResult {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // the keydown effect below only attaches once (empty deps), so it needs a
  // ref to read the *current* canFullscreen instead of closing over the
  // value from whichever render first mounted it
  const canFullscreenRef = useRef(canFullscreen)
  const shortcutsEnabledRef = useRef(shortcutsEnabled)
  useEffect(() => {
    canFullscreenRef.current = canFullscreen
    shortcutsEnabledRef.current = shortcutsEnabled
  })

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const playbackRateRef = useRef(1)
  const [isPictureInPicture, setIsPictureInPicture] = useState(false)

  // the <video>/<audio> element remounts (key={media.url}) whenever a new file is picked
  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }, [resetKey])

  useEffect(() => {
    function handleFullscreenChange(): void {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  function togglePlay(): void {
    const el = mediaRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }

  function seekTo(time: number): void {
    const el = mediaRef.current
    if (!el) return
    el.currentTime = clamp(time, 0, el.duration || 0)
  }

  function getPlayback(): { position: number; duration: number } | null {
    const el = mediaRef.current
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return null
    return { position: el.currentTime, duration: el.duration }
  }

  function playFrom(time: number): void {
    const el = mediaRef.current
    if (!el) return
    const start = (): void => {
      el.currentTime = clamp(time, 0, el.duration)
      void el.play()
    }
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) start()
    else el.addEventListener('loadedmetadata', start, { once: true })
  }

  function seekBy(deltaSeconds: number): void {
    const el = mediaRef.current
    if (!el) return
    seekTo(el.currentTime + deltaSeconds)
  }

  function setVolume(value: number): void {
    const el = mediaRef.current
    if (!el) return
    const next = clamp(value, 0, 1)
    el.volume = next
    el.muted = next === 0
  }

  function adjustVolume(delta: number): void {
    const el = mediaRef.current
    if (!el) return
    setVolume((el.muted ? 0 : el.volume) + delta)
  }

  function toggleMute(): void {
    const el = mediaRef.current
    if (!el) return
    el.muted = !el.muted
  }

  function setPlaybackRate(rate: number): void {
    const next = clamp(rate, PLAYBACK_RATES[0], PLAYBACK_RATES[PLAYBACK_RATES.length - 1])
    playbackRateRef.current = next
    setPlaybackRateState(next)
    const el = mediaRef.current
    if (el) {
      el.defaultPlaybackRate = next
      el.playbackRate = next
    }
  }

  function stepPlaybackRate(direction: 1 | -1): void {
    const index = PLAYBACK_RATES.findIndex((rate) => rate >= playbackRateRef.current)
    const current = index === -1 ? PLAYBACK_RATES.length - 1 : index
    setPlaybackRate(PLAYBACK_RATES[clamp(current + direction, 0, PLAYBACK_RATES.length - 1)])
  }

  function togglePictureInPicture(): void {
    const el = mediaRef.current
    if (!(el instanceof HTMLVideoElement) || !document.pictureInPictureEnabled) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture()
    else void el.requestPictureInPicture().catch(() => undefined)
  }

  function toggleFullscreen(): void {
    if (!canFullscreenRef.current || !containerRef.current) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void containerRef.current.requestFullscreen()
    }
  }

  // keyboard shortcuts - handlers below read live values off the DOM element,
  // so this only needs to be attached once per mount
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (!mediaRef.current || !shortcutsEnabledRef.current) return
      // Ctrl+K and friends belong to the app, not to the player
      if (event.ctrlKey || event.metaKey || event.altKey) return

      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowRight':
          seekBy(5)
          break
        case 'ArrowLeft':
          seekBy(-5)
          break
        case 'ArrowUp':
          event.preventDefault()
          adjustVolume(0.05)
          break
        case 'ArrowDown':
          event.preventDefault()
          adjustVolume(-0.05)
          break
        case 'm':
          toggleMute()
          break
        case 'f':
          toggleFullscreen()
          break
        case '<':
          stepPlaybackRate(-1)
          break
        case '>':
          stepPlaybackRate(1)
          break
        case 'p':
          togglePictureInPicture()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers close over stable refs only
  }, [])

  // stable identity (useCallback) so React doesn't re-fire the ref on every render
  const setMediaElement = useCallback((el: HTMLMediaElement | null) => {
    mediaRef.current = el
    if (!el) return
    // a new file remounts the element at 1x: keep the chosen speed
    el.defaultPlaybackRate = playbackRateRef.current
    el.playbackRate = playbackRateRef.current
    el.addEventListener('enterpictureinpicture', () => setIsPictureInPicture(true))
    el.addEventListener('leavepictureinpicture', () => setIsPictureInPicture(false))
  }, [])

  return {
    setMediaElement,
    containerRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    isFullscreen,
    playbackRate,
    isPictureInPicture,
    getPlayback,
    playFrom,
    togglePlay,
    seekTo,
    seekBy,
    setVolume,
    adjustVolume,
    toggleMute,
    toggleFullscreen,
    setPlaybackRate,
    togglePictureInPicture,
    mediaEventHandlers: {
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onEnded: () => setIsPlaying(false),
      onTimeUpdate: () => {
        if (mediaRef.current) setCurrentTime(mediaRef.current.currentTime)
      },
      onLoadedMetadata: () => {
        if (mediaRef.current) setDuration(mediaRef.current.duration || 0)
      },
      onVolumeChange: () => {
        if (mediaRef.current) {
          setVolumeState(mediaRef.current.volume)
          setMuted(mediaRef.current.muted)
        }
      },
    },
  }
}
