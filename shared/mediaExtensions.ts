import type { MediaKind } from './types'

/** extensions the scanner indexes (Issue 3.2) - not exhaustive, covers common MVP cases */
const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'mkv',
  'avi',
  'mov',
  'webm',
  'wmv',
  'flv',
  'mpg',
  'mpeg',
  'ts',
  'ogv',
  '3gp',
])

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'oga',
  'm4a',
  'wma',
  'opus',
  'aiff',
  'alac',
])

export function kindForExtension(extension: string): MediaKind | null {
  const ext = extension.toLowerCase()
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  return null
}
