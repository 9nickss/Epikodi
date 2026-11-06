import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { isLikelyNativelyPlayable } from '../shared/mediaCompatibility'
import type { MediaMetadata, MediaProbeResult } from '../shared/types'

const execFileAsync = promisify(execFile)

const FFPROBE_BIN = process.env.FFPROBE_PATH ?? 'ffprobe'

/** ffprobe only reads headers, but a file on a stalled network share can still hang it (Issue 3.3) */
const FFPROBE_TIMEOUT_MS = 30_000

type FfprobeTags = Record<string, string | undefined>

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  /** cover art in audio files shows up as a one-frame "video" stream */
  disposition?: { attached_pic?: number }
  tags?: FfprobeTags
}

interface FfprobeFormat {
  format_name?: string
  format_long_name?: string
  duration?: string
  bit_rate?: string
  tags?: FfprobeTags
}

interface FfprobeOutput {
  format?: FfprobeFormat
  streams?: FfprobeStream[]
}

/** true when ffprobe itself couldn't be started - no point probing the rest of a library */
export function isFfprobeMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

async function runFfprobe(filePath: string): Promise<FfprobeOutput> {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
  )
  return JSON.parse(stdout) as FfprobeOutput
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Tag keys vary in case between containers (ID3 → "artist", Vorbis comments →
 * "ARTIST", MP4 → "artist") and live either on the container (mp3, mp4, flac)
 * or on the audio stream (ogg/opus) - look in both, case-insensitively.
 */
function readTags(data: FfprobeOutput): (key: string) => string | null {
  const merged = new Map<string, string>()
  const audioStream = data.streams?.find((s) => s.codec_type === 'audio')
  for (const tags of [audioStream?.tags, data.format?.tags]) {
    for (const [key, value] of Object.entries(tags ?? {})) {
      const trimmed = value?.trim()
      if (trimmed) merged.set(key.toLowerCase(), trimmed)
    }
  }
  return (key) => merged.get(key) ?? null
}

/** "2009-05-12", "2009" → 2009 */
function parseYear(value: string | null): number | null {
  const match = value ? /\d{4}/.exec(value) : null
  return match ? Number(match[0]) : null
}

/** "3/12", "03" → 3 */
function parseTrackNumber(value: string | null): number | null {
  const match = value ? /^\s*(\d+)/.exec(value) : null
  return match ? Number(match[1]) : null
}

function toProbeResult(filePath: string, data: FfprobeOutput): MediaProbeResult {
  const streams = data.streams ?? []
  const videoCodec =
    streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)?.codec_name ??
    null
  const audioCodec = streams.find((s) => s.codec_type === 'audio')?.codec_name ?? null
  const extension = path.extname(filePath).slice(1)

  return {
    formatName: data.format?.format_name ?? null,
    formatLongName: data.format?.format_long_name ?? null,
    durationSeconds: toNumber(data.format?.duration),
    videoCodec,
    audioCodec,
    isNativelyPlayable: isLikelyNativelyPlayable({ extension, videoCodec, audioCodec }),
  }
}

export async function probeMediaFile(filePath: string): Promise<MediaProbeResult> {
  return toProbeResult(filePath, await runFfprobe(filePath))
}

/** full metadata for library indexing (Issue 3.4): codecs/duration plus resolution and audio tags */
export async function extractMediaMetadata(filePath: string): Promise<MediaMetadata> {
  const data = await runFfprobe(filePath)
  const tag = readTags(data)
  const video = data.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)

  return {
    ...toProbeResult(filePath, data),
    bitRate: toNumber(data.format?.bit_rate),
    width: video?.width ?? null,
    height: video?.height ?? null,
    tagTitle: tag('title'),
    artist: tag('artist'),
    album: tag('album'),
    albumArtist: tag('album_artist') ?? tag('albumartist'),
    genre: tag('genre'),
    year: parseYear(tag('date') ?? tag('year')),
    trackNumber: parseTrackNumber(tag('track') ?? tag('tracknumber')),
  }
}
