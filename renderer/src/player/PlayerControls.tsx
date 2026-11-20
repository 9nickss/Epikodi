import './PlayerControls.css'
import { PLAYBACK_RATES } from './usePlayerControls'

interface PlayerControlsProps {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  isFullscreen: boolean
  showFullscreen: boolean
  playbackRate: number
  /** null hides the button (audio, or PiP unavailable) */
  isPictureInPicture: boolean | null
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onVolumeChange: (value: number) => void
  onToggleMute: () => void
  onToggleFullscreen: () => void
  onPlaybackRateChange: (rate: number) => void
  onTogglePictureInPicture: () => void
}

function formatRate(rate: number): string {
  return `${String(rate).replace('.', ',')}x`
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
  playbackRate,
  isPictureInPicture,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  onPlaybackRateChange,
  onTogglePictureInPicture,
}: PlayerControlsProps) {
  const safeDuration = Number.isFinite(duration) ? duration : 0
  /** web radios and other live streams report an infinite duration - nothing to seek */
  const isLive = duration === Infinity

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
        disabled={isLive}
        aria-label="Progression de la lecture"
      />

      {isLive ? (
        <span className="player-controls__live">● En direct</span>
      ) : (
        <span className="player-controls__time">{formatTime(safeDuration)}</span>
      )}

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

      {!isLive && (
        <select
          className="player-controls__rate"
          value={playbackRate}
          onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          aria-label="Vitesse de lecture"
          title="Vitesse de lecture (< / >)"
        >
          {PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {formatRate(rate)}
            </option>
          ))}
        </select>
      )}

      {isPictureInPicture !== null && (
        <button
          type="button"
          className={`player-controls__pip${isPictureInPicture ? ' is-active' : ''}`}
          onClick={onTogglePictureInPicture}
          aria-label={isPictureInPicture ? 'Quitter le Picture-in-Picture' : 'Picture-in-Picture'}
          aria-pressed={isPictureInPicture}
          title="Picture-in-Picture (P)"
        >
          ⧉
        </button>
      )}

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
