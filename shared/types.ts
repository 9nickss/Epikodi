/**
 * Types and contracts shared between the Electron main process and the
 * React renderer. Grows as IPC channels (scan, playback, plugins, …) land.
 */

import type { MediaCategory } from './mediaCategory'

export interface MediaProbeResult {
  formatName: string | null
  formatLongName: string | null
  durationSeconds: number | null
  videoCodec: string | null
  audioCodec: string | null
  /** whether Chromium can likely decode this natively, see shared/mediaCompatibility.ts */
  isNativelyPlayable: boolean
}

/** what library indexing extracts with ffprobe (Issue 3.4) - tags are null when absent */
export interface MediaMetadata extends MediaProbeResult {
  /** bits per second, container-level */
  bitRate: number | null
  width: number | null
  height: number | null
  /** "title" tag - preferred over the file name for display when present */
  tagTitle: string | null
  artist: string | null
  album: string | null
  albumArtist: string | null
  genre: string | null
  year: number | null
  trackNumber: number | null
}

export type MediaKind = 'video' | 'audio'

export type { MediaCategory } from './mediaCategory'

/** movie info matched on TMDB (Issue 5.2) - images are cached locally, see main/tmdb.ts */
export interface TmdbInfo {
  id: number
  title: string
  originalTitle: string
  overview: string
  year: number | null
  /** 0-10 */
  rating: number | null
  /** local file paths, use toMediaUrl() to display them */
  posterPath: string | null
  backdropPath: string | null
}

/** a film listed by TMDB, in the library or not - images are remote URLs, unlike TmdbInfo */
export interface DiscoverMovie {
  id: number
  title: string
  originalTitle: string
  /** ISO 639-1 code */
  originalLanguage: string | null
  overview: string
  /** YYYY-MM-DD */
  releaseDate: string | null
  /** 0-10, null while the film has no votes */
  rating: number | null
  voteCount: number
  genres: string[]
  posterUrl: string | null
  backdropUrl: string | null
}

/** one themed list of the Discover page */
export interface DiscoverRow {
  id: string
  title: string
  movies: DiscoverMovie[]
}

/** what TMDB only returns film by film, see main/discover.ts */
export interface DiscoverDetails {
  tagline: string | null
  runtimeMinutes: number | null
  countries: string[]
  directors: string[]
  cast: string[]
}

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
  /** tag title when the file has one, otherwise the file name without extension */
  title: string
  sizeBytes: number | null
  durationSeconds: number | null
  formatName: string | null
  videoCodec: string | null
  audioCodec: string | null
  isNativelyPlayable: boolean | null
  bitRate: number | null
  width: number | null
  height: number | null
  artist: string | null
  album: string | null
  albumArtist: string | null
  genre: string | null
  year: number | null
  trackNumber: number | null
  /** when ffprobe last read this file - null until metadata extraction reached it */
  probedAt: string | null
  /** why ffprobe failed on this file, if it did */
  probeError: string | null
  /** library section the file belongs to (Issue 4.1) */
  category: MediaCategory
  /** null when not looked up yet, or looked up without a confident match - see tmdbCheckedAt */
  tmdb: TmdbInfo | null
  tmdbCheckedAt: string | null
  /** frame extracted from a video (Issue F2.1) - local file path, use toMediaUrl() to display it */
  thumbnailPath: string | null
  addedAt: string
  updatedAt: string
}

export interface ScanProgress {
  sourceId: number
  filesFound: number
}

/**
 * background work that runs after the file walk of a scan: ffprobe metadata
 * extraction (Issue 3.4), then TMDB enrichment of films (Issue 5.2)
 */
export type IndexingPhase = 'metadata' | 'tmdb' | 'thumbnails'

export interface IndexingProgress {
  sourceId: number
  phase: IndexingPhase
  done: number
  total: number
}

export interface IndexingDone extends IndexingProgress {
  /** set when the phase stopped early (ffprobe missing, TMDB key invalid, offline...) */
  error: string | null
}

export interface TmdbStatus {
  configured: boolean
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
  onIndexingProgress: (listener: (progress: IndexingProgress) => void) => () => void
  onIndexingDone: (listener: (done: IndexingDone) => void) => () => void

  tmdbStatus: () => Promise<TmdbStatus>
  /**
   * re-runs the TMDB lookup of one film, optionally with a corrected title/year
   * (wrong or missing match); resolves to the updated record
   */
  rematchTmdb: (
    mediaId: number,
    query?: { title: string; year: number | null },
  ) => Promise<MediaRecord>
  /** films to discover on TMDB, whether or not they're in the library */
  discoverMovies: () => Promise<DiscoverRow[]>
  discoverDetails: (movieId: number) => Promise<DiscoverDetails>
}

declare global {
  interface Window {
    epikodi: ElectronBridge
  }
}

export {}
