import './PlayerControls.css'

interface PlayerControlsProps {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  isFullscreen: boolean
  showFullscreen: boolean
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onVolumeChange: (value: number) => void
  onToggleMute: () => void
  onToggleFullscreen: () => void
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function PlayerControls({
  isPlaying,
  currentTime,
  duration,
  volume,
  muted,
  isFullscreen,
  showFullscreen,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
}: PlayerControlsProps) {
  const safeDuration = Number.isFinite(duration) ? duration : 0

  return (
    <div className="player-controls">
      <button
        type="button"
        className="player-controls__play"
        onClick={onTogglePlay}
        aria-label={isPlaying ? 'Pause' : 'Lecture'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      <span className="player-controls__time">{formatTime(currentTime)}</span>

      <input
        type="range"
        className="player-controls__seek"
        min={0}
        max={safeDuration}
        step={0.1}
        value={Math.min(currentTime, safeDuration)}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="Progression de la lecture"
      />

      <span className="player-controls__time">{formatTime(safeDuration)}</span>

      <button
        type="button"
        className="player-controls__mute"
        onClick={onToggleMute}
        aria-label={muted ? 'Activer le son' : 'Couper le son'}
      >
        {muted || volume === 0 ? '🔇' : '🔊'}
      </button>

      <input
        type="range"
        className="player-controls__volume"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(event) => onVolumeChange(Number(event.target.value))}
        aria-label="Volume"
      />

      {showFullscreen && (
        <button
          type="button"
          className="player-controls__fullscreen"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Quitter le plein ecran' : 'Plein ecran'}
        >
          {isFullscreen ? '⤡' : '⛶'}
        </button>
      )}
    </div>
  )
}
