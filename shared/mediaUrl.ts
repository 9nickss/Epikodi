/**
 * URL scheme the main process serves local media files on (see
 * main/protocols.ts). Lives in shared/ so the renderer can build a playable
 * URL for a library entry without an IPC round-trip.
 */
export const MEDIA_PROTOCOL = 'app-media'

export function toMediaUrl(filePath: string): string {
  return `${MEDIA_PROTOCOL}://local/${encodeURIComponent(filePath)}`
}
