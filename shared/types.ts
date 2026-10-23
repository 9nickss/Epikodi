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

export type ScanStatus = 'ok' | 'partial' | 'failed'

/** a scanned folder (local or network) that media files are indexed from - Issue 3.2/3.3 */
export interface SourceRecord {
  id: number
  path: string
  label: string
  createdAt: string
  /** mounted share / UNC path, detected when the source is listed (Issue 3.3) */
  isNetwork: boolean
  /** outcome of the last finished scan - null while it has never completed */
  lastScanAt: string | null
  lastScanStatus: ScanStatus | null
  /** summary of what went wrong during the last scan, if anything */
  lastScanError: string | null
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

export interface ScanError {
  path: string
  message: string
}

export interface ScanResult extends ScanProgress {
  /** failed: root unreachable · partial: some folders/files skipped · ok: everything read */
  status: ScanStatus
  /** first few errors only, see errorCount for the total */
  errors: ScanError[]
  errorCount: number
}

export type AddSourceResult = { ok: true; source: SourceRecord } | { ok: false; error: string }

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

  /** opens a native folder picker and, if one is chosen, validates it, adds it as a source and starts scanning it; null if cancelled */
  addSource: () => Promise<AddSourceResult | null>
  /** same as addSource for a typed path (mounted share, UNC path on Windows) */
  addSourcePath: (sourcePath: string) => Promise<AddSourceResult>
  /** re-runs the scan of an existing source (e.g. once a network share is back) */
  rescanSource: (sourceId: number) => Promise<void>
  listSources: () => Promise<SourceRecord[]>
  listMedia: (sourceId?: number) => Promise<MediaRecord[]>
  removeSource: (sourceId: number) => Promise<void>
  onScanProgress: (listener: (progress: ScanProgress) => void) => () => void
  onScanDone: (listener: (result: ScanResult) => void) => () => void
}

declare global {
  interface Window {
    epikodi: ElectronBridge
  }
}

export {}
