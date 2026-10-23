/**
 * Types and contracts shared between the Electron main process and the
 * React renderer. Grows as IPC channels (scan, playback, plugins, …) land.
 */

export interface MediaProbeResult {
  formatName: string | null
  formatLongName: string | null
  durationSeconds: number | null
  videoCodec: string | null
  audioCodec: string | null
  /** whether Chromium can likely decode this natively, see shared/mediaCompatibility.ts */
  isNativelyPlayable: boolean
}

export interface TranscodeProgress {
  requestId: string
  /** 0-100 */
  percent: number
}

export interface TranscodeResult {
  /** file:// URL of the transcoded MP4, ready to use as a <video>/<audio> src */
  fileUrl: string
}

export interface ElectronBridge {
  version: string
  /** resolves the real filesystem path of a <input type="file"> selection */
  getPathForFile: (file: File) => string
  /** runs ffprobe on a local file and reports its format/codecs */
  probeMedia: (filePath: string) => Promise<MediaProbeResult>
  /** transcodes a file to H.264/AAC MP4 (fallback for files ffprobe flagged as non-native) */
  transcodeMedia: (
    filePath: string,
    durationSeconds: number | null,
    requestId: string,
  ) => Promise<TranscodeResult>
  /** subscribes to transcode progress events; returns an unsubscribe function */
  onTranscodeProgress: (listener: (progress: TranscodeProgress) => void) => () => void
}

declare global {
  interface Window {
    epikodi: ElectronBridge
  }
}

export {}
