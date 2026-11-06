import type { MediaRecord } from '../../shared/types'

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** "2 h 14 min" / "42 min" - for cards and detail pages, where 2:14:03 reads too technical */
export function formatRuntime(seconds: number | null): string | null {
  if (seconds === null) return null
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return `${Math.round(seconds)} s`
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

/** "12 mars 2026" from TMDB's YYYY-MM-DD - parsed as local time, or it can shift a day */
export function formatReleaseDate(date: string | null, style: 'medium' | 'long'): string | null {
  if (!date) return null
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { dateStyle: style })
}

export function formatSize(bytes: number | null): string | null {
  if (bytes === null) return null
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function formatBitRate(bitsPerSecond: number | null): string | null {
  if (bitsPerSecond === null) return null
  return bitsPerSecond >= 1_000_000
    ? `${(bitsPerSecond / 1_000_000).toFixed(1)} Mb/s`
    : `${Math.round(bitsPerSecond / 1000)} kb/s`
}

/** TMDB title for matched films, otherwise the tag/file title */
export function displayTitle(media: MediaRecord): string {
  return media.tmdb?.title ?? media.title
}

export function displayYear(media: MediaRecord): number | null {
  return media.tmdb?.year ?? media.year
}

/** secondary line of a file entry: artist/album for music, resolution/codec for video */
export function describeMedia(media: MediaRecord): string | null {
  if (media.probeError) return media.probeError
  const parts =
    media.kind === 'audio'
      ? [media.artist ?? media.albumArtist, media.album, media.year]
      : [
          media.width && media.height ? `${media.width}×${media.height}` : null,
          media.videoCodec,
          displayYear(media),
        ]
  const text = parts.filter((part) => part !== null && part !== undefined).join(' · ')
  return text || null
}

/** lowercase without accents, for search */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** ipcRenderer.invoke wraps errors as "Error invoking remote method 'x': Error: message" */
export function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}
