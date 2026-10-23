import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface UsePlayerControlsResult {
  setMediaElement: (el: HTMLMediaElement | null) => void
  containerRef: RefObject<HTMLDivElement | null>
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  isFullscreen: boolean
  togglePlay: () => void
  seekTo: (time: number) => void
  seekBy: (deltaSeconds: number) => void
  setVolume: (value: number) => void
  adjustVolume: (delta: number) => void
  toggleMute: () => void
  toggleFullscreen: () => void
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
export function usePlayerControls(resetKey: string, canFullscreen: boolean): UsePlayerControlsResult {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

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

  function toggleFullscreen(): void {
    if (!canFullscreen || !containerRef.current) return
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
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (!mediaRef.current) return

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
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers close over stable refs only
  }, [])

  // stable identity (useCallback) so React doesn't re-fire the ref on every render
  const setMediaElement = useCallback((el: HTMLMediaElement | null) => {
    mediaRef.current = el
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
    togglePlay,
    seekTo,
    seekBy,
    setVolume,
    adjustVolume,
    toggleMute,
    toggleFullscreen,
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
