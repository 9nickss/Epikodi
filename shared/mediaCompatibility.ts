/**
 * Heuristic for whether Chromium (and thus Electron's <video>/<audio>) can
 * decode a file natively, based on its extension and the codecs ffprobe
 * reports - not exhaustive, but covers the common MVP cases. Anything not
 * listed here (avi, mkv, wmv, flv, hevc, ...) is treated as needing the
 * FFmpeg transcode fallback (Issue 2.4).
 */

const NATIVE_VIDEO_CODECS: Readonly<Record<string, readonly string[]>> = {
  mp4: ['h264', 'vp9', 'av1'],
  m4v: ['h264', 'vp9', 'av1'],
  mov: ['h264', 'vp9', 'av1'],
  webm: ['vp8', 'vp9', 'av1'],
  ogg: ['theora'],
  ogv: ['theora'],
}

const NATIVE_AUDIO_CODECS: Readonly<Record<string, readonly string[]>> = {
  mp4: ['aac', 'mp3', 'opus', 'flac', 'alac'],
  m4v: ['aac', 'mp3', 'opus', 'flac', 'alac'],
  mov: ['aac', 'mp3', 'opus', 'flac', 'alac'],
  m4a: ['aac', 'alac'],
  webm: ['opus', 'vorbis'],
  ogg: ['vorbis', 'opus', 'flac'],
  ogv: ['vorbis', 'opus'],
  oga: ['vorbis', 'opus', 'flac'],
  wav: ['pcm_s16le', 'pcm_u8', 'pcm_s24le', 'pcm_f32le'],
  mp3: ['mp3'],
  flac: ['flac'],
  aac: ['aac'],
}

export interface CompatibilityCheckInput {
  /** lowercase file extension, no leading dot (e.g. "mp4") */
  extension: string
  videoCodec: string | null
  audioCodec: string | null
}

export function isLikelyNativelyPlayable({
  extension,
  videoCodec,
  audioCodec,
}: CompatibilityCheckInput): boolean {
  const ext = extension.toLowerCase()
  const allowedVideo = NATIVE_VIDEO_CODECS[ext]
  const allowedAudio = NATIVE_AUDIO_CODECS[ext]

  // unknown/unsupported container (avi, mkv, wmv, flv, ts, ...)
  if (!allowedVideo && !allowedAudio) return false

  const videoOk = !videoCodec || (allowedVideo?.includes(videoCodec) ?? false)
  const audioOk = !audioCodec || (allowedAudio?.includes(audioCodec) ?? false)

  return videoOk && audioOk
}
