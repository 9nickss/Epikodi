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

export type MediaKind = 'video' | 'audio'

/** a scanned folder (local or network) that media files are indexed from - Issue 3.2 */
export interface SourceRecord {
  id: number
  path: string
  label: string
  createdAt: string
}

/** a media file indexed in the library, with its ffprobe metadata - Issue 3.2/3.4 */
export interface MediaRecord {
  id: number
  sourceId: number
  path: string
  kind: MediaKind
  title: string
  sizeBytes: number | null
  durationSeconds: number | null
  formatName: string | null
  videoCodec: string | null
  audioCodec: string | null
  isNativelyPlayable: boolean | null
  addedAt: string
  updatedAt: string
}

export interface ScanProgress {
  sourceId: number
  filesFound: number
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

  /** opens a native folder picker and, if one is chosen, adds it as a source and starts scanning it */
  addSource: () => Promise<SourceRecord | null>
  listSources: () => Promise<SourceRecord[]>
  listMedia: (sourceId?: number) => Promise<MediaRecord[]>
  removeSource: (sourceId: number) => Promise<void>
  onScanProgress: (listener: (progress: ScanProgress) => void) => () => void
  onScanDone: (listener: (progress: ScanProgress) => void) => () => void
}

declare global {
  interface Window {
    epikodi: ElectronBridge
  }
}

export {}
