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
}
