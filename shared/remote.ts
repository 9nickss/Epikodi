/**
 * Phone remote (#1): a small HTTP server in the main process, reachable from
 * the local network and protected by a token generated each time it starts.
 */

/** tried first - another free port is picked if it's taken */
export const REMOTE_DEFAULT_PORT = 8765

export interface RemoteStatus {
  running: boolean
  port: number | null
  /** LAN IPv4 addresses of this machine, private ranges first - empty when offline */
  addresses: string[]
  /** full URL with the token, on the first address - what the QR code will hold (#1.4) */
  url: string | null
  /** why the last start failed, if it did */
  error: string | null
  /** phones currently connected to the live state stream (#1.2) */
  clients: number
}

/** what's playing, published by the renderer (throttled) and streamed to the phones (#1.2) */
export interface RemotePlayerState {
  /** null while nothing is loaded in the player */
  title: string | null
  /** artist, plugin name... */
  subtitle: string | null
  /** library section, or 'stream' for a plugin stream / 'file' for a file picked by hand */
  category: 'film' | 'music' | 'podcast' | 'stream' | 'file' | null
  kind: 'video' | 'audio' | null
  /** seconds */
  position: number
  /** seconds, null for a live stream or while unknown */
  duration: number | null
  isPlaying: boolean
  /** 0-1 */
  volume: number
  muted: boolean
  /** waiting for "resume / start over" in the player - play resumes */
  awaitsResume: boolean
}

export const EMPTY_REMOTE_STATE: RemotePlayerState = {
  title: null,
  subtitle: null,
  category: null,
  kind: null,
  position: 0,
  duration: null,
  isPlaying: false,
  volume: 1,
  muted: false,
  awaitsResume: false,
}

/** sent by the phone (POST /api/command), applied by the renderer through usePlayerControls */
export type RemoteCommand =
  | { type: 'togglePlay' }
  | { type: 'seekBy'; seconds: number }
  | { type: 'seekTo'; position: number }
  | { type: 'setVolume'; volume: number }
  | { type: 'toggleMute' }

/** validates a command received over the network - null when malformed */
export function parseRemoteCommand(raw: unknown): RemoteCommand | null {
  if (!raw || typeof raw !== 'object') return null
  const command = raw as Record<string, unknown>
  const isNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value)
  switch (command.type) {
    case 'togglePlay':
    case 'toggleMute':
      return { type: command.type }
    case 'seekBy':
      return isNumber(command.seconds) && Math.abs(command.seconds) <= 3600
        ? { type: 'seekBy', seconds: command.seconds }
        : null
    case 'seekTo':
      return isNumber(command.position) && command.position >= 0
        ? { type: 'seekTo', position: command.position }
        : null
    case 'setVolume':
      return isNumber(command.volume) && command.volume >= 0 && command.volume <= 1
        ? { type: 'setVolume', volume: command.volume }
        : null
    default:
      return null
  }
}
