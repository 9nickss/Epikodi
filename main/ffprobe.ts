import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { isLikelyNativelyPlayable } from '../shared/mediaCompatibility'
import type { MediaProbeResult } from '../shared/types'

const execFileAsync = promisify(execFile)

const FFPROBE_BIN = process.env.FFPROBE_PATH ?? 'ffprobe'

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
}

interface FfprobeFormat {
  format_name?: string
  format_long_name?: string
  duration?: string
}

interface FfprobeOutput {
  format?: FfprobeFormat
  streams?: FfprobeStream[]
}

export async function probeMediaFile(filePath: string): Promise<MediaProbeResult> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ])

  const data = JSON.parse(stdout) as FfprobeOutput
  const streams = data.streams ?? []

  const videoCodec = streams.find((s) => s.codec_type === 'video')?.codec_name ?? null
  const audioCodec = streams.find((s) => s.codec_type === 'audio')?.codec_name ?? null
  const extension = path.extname(filePath).slice(1)

  return {
    formatName: data.format?.format_name ?? null,
    formatLongName: data.format?.format_long_name ?? null,
    durationSeconds: data.format?.duration ? Number(data.format.duration) : null,
    videoCodec,
    audioCodec,
    isNativelyPlayable: isLikelyNativelyPlayable({ extension, videoCodec, audioCodec }),
  }
}
