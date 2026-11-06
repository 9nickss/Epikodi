import path from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { categoryForMedia } from '../shared/mediaCategory'
import { canResume, isWatched } from '../shared/playback'
import type {
  MediaKind,
  MediaMetadata,
  MediaRecord,
  PlaybackInfo,
  ScanStatus,
  SourceRecord,
  TmdbInfo,
} from '../shared/types'
import { isNetworkPath } from './network'

let db: Database.Database | null = null

/**
 * Opens (and lazily creates) the library database, idempotently applying
 * the schema. Call eagerly at startup so a broken native module / schema
 * fails fast instead of surfacing later during a scan (Issue 3.2).
 */
export function getDb(): Database.Database {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'epikodi.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = null
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('video', 'audio')),
      title TEXT NOT NULL,
      size_bytes INTEGER,
      duration_seconds REAL,
      format_name TEXT,
      video_codec TEXT,
      audio_codec TEXT,
      is_natively_playable INTEGER,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_media_source_id ON media(source_id);
    CREATE INDEX IF NOT EXISTS idx_media_kind ON media(kind);
  `)

  // columns added after the initial schema - CREATE TABLE IF NOT EXISTS won't add them to an existing db
  addMissingColumns(database, 'sources', [
    // Issue 3.3
    ['last_scan_at', 'TEXT'],
    ['last_scan_status', "TEXT CHECK (last_scan_status IN ('ok', 'partial', 'failed'))"],
    ['last_scan_error', 'TEXT'],
  ])
  addMissingColumns(database, 'media', [
    // Issue 3.4
    ['mtime_ms', 'REAL'],
    ['bit_rate', 'INTEGER'],
    ['width', 'INTEGER'],
    ['height', 'INTEGER'],
    ['artist', 'TEXT'],
    ['album', 'TEXT'],
    ['album_artist', 'TEXT'],
    ['genre', 'TEXT'],
    ['year', 'INTEGER'],
    ['track_number', 'INTEGER'],
    ['probed_at', 'TEXT'],
    ['probe_error', 'TEXT'],
  ])
  addMissingColumns(database, 'media', [
    // Issue 5.2 - tmdb_checked_at set + tmdb_id NULL means "looked up, no confident match"
    ['tmdb_id', 'INTEGER'],
    ['tmdb_title', 'TEXT'],
    ['tmdb_original_title', 'TEXT'],
    ['tmdb_overview', 'TEXT'],
    ['tmdb_year', 'INTEGER'],
    ['tmdb_rating', 'REAL'],
    ['tmdb_poster_path', 'TEXT'],
    ['tmdb_backdrop_path', 'TEXT'],
    ['tmdb_checked_at', 'TEXT'],
  ])
  addMissingColumns(database, 'media', [
    // Issue F2.1 - thumbnail_checked_at set + thumbnail_path NULL means "ffmpeg couldn't extract a frame"
    ['thumbnail_path', 'TEXT'],
    ['thumbnail_checked_at', 'TEXT'],
  ])
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_media_probed_at ON media(source_id, probed_at);

    -- raw TMDB responses keyed by request, so rescans don't hit the API again (Issue 5.2)
    CREATE TABLE IF NOT EXISTS tmdb_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    -- where playback stopped, one row per media (Issue F1.1)
    CREATE TABLE IF NOT EXISTS playback_state (
      media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
      position_seconds REAL NOT NULL,
      duration_seconds REAL NOT NULL,
      watched_at TEXT,
      updated_at TEXT NOT NULL
    );
  `)
}

function addMissingColumns(
  database: Database.Database,
  table: string,
  columns: [name: string, definition: string][],
): void {
  const existing = new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (c) => c.name,
    ),
  )
  for (const [name, definition] of columns) {
    if (!existing.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }
}

// --- sources ---

interface SourceRow {
  id: number
  path: string
  label: string
  created_at: string
  last_scan_at: string | null
  last_scan_status: ScanStatus | null
  last_scan_error: string | null
}

function mapSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    path: row.path,
    label: row.label,
    createdAt: row.created_at,
    isNetwork: isNetworkPath(row.path),
    lastScanAt: row.last_scan_at,
    lastScanStatus: row.last_scan_status,
    lastScanError: row.last_scan_error,
  }
}

export function addSource(sourcePath: string, label?: string): SourceRecord {
  const row = getDb()
    .prepare(
      `INSERT INTO sources (path, label, created_at) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET label = excluded.label
       RETURNING *`,
    )
    .get(sourcePath, label ?? path.basename(sourcePath), new Date().toISOString()) as SourceRow
  return mapSource(row)
}

export function getSource(id: number): SourceRecord | null {
  const row = getDb().prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined
  return row ? mapSource(row) : null
}

export function recordSourceScan(id: number, status: ScanStatus, error: string | null): void {
  getDb()
    .prepare(
      'UPDATE sources SET last_scan_at = ?, last_scan_status = ?, last_scan_error = ? WHERE id = ?',
    )
    .run(new Date().toISOString(), status, error, id)
}

export function listSources(): SourceRecord[] {
  const rows = getDb().prepare('SELECT * FROM sources ORDER BY created_at ASC').all() as SourceRow[]
  return rows.map(mapSource)
}

export function removeSource(id: number): void {
  getDb().prepare('DELETE FROM sources WHERE id = ?').run(id)
}

// --- media ---

interface MediaRow {
  id: number
  source_id: number
  path: string
  kind: MediaKind
  title: string
  size_bytes: number | null
  mtime_ms: number | null
  duration_seconds: number | null
  format_name: string | null
  video_codec: string | null
  audio_codec: string | null
  is_natively_playable: number | null
  bit_rate: number | null
  width: number | null
  height: number | null
  artist: string | null
  album: string | null
  album_artist: string | null
  genre: string | null
  year: number | null
  track_number: number | null
  probed_at: string | null
  probe_error: string | null
  tmdb_id: number | null
  tmdb_title: string | null
  tmdb_original_title: string | null
  tmdb_overview: string | null
  tmdb_year: number | null
  tmdb_rating: number | null
  tmdb_poster_path: string | null
  tmdb_backdrop_path: string | null
  tmdb_checked_at: string | null
  thumbnail_path: string | null
  thumbnail_checked_at: string | null
  playback_position: number | null
  playback_duration: number | null
  playback_updated_at: string | null
  added_at: string
  updated_at: string
}

function mapTmdb(row: MediaRow): TmdbInfo | null {
  if (row.tmdb_id === null) return null
  return {
    id: row.tmdb_id,
    title: row.tmdb_title ?? row.title,
    originalTitle: row.tmdb_original_title ?? row.tmdb_title ?? row.title,
    overview: row.tmdb_overview ?? '',
    year: row.tmdb_year,
    rating: row.tmdb_rating,
    posterPath: row.tmdb_poster_path,
    backdropPath: row.tmdb_backdrop_path,
  }
}

/** media rows always come with their playback state, see MediaRow */
const SELECT_MEDIA = `
  SELECT media.*,
    playback_state.position_seconds AS playback_position,
    playback_state.duration_seconds AS playback_duration,
    playback_state.updated_at AS playback_updated_at
  FROM media
  LEFT JOIN playback_state ON playback_state.media_id = media.id`

function mapPlayback(row: MediaRow): PlaybackInfo | null {
  if (row.playback_position === null || row.playback_duration === null) return null
  return {
    positionSeconds: row.playback_position,
    durationSeconds: row.playback_duration,
    updatedAt: row.playback_updated_at ?? row.updated_at,
  }
}

function mapMedia(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    path: row.path,
    kind: row.kind,
    title: row.title,
    sizeBytes: row.size_bytes,
    durationSeconds: row.duration_seconds,
    formatName: row.format_name,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    isNativelyPlayable:
      row.is_natively_playable === null ? null : Boolean(row.is_natively_playable),
    bitRate: row.bit_rate,
    width: row.width,
    height: row.height,
    artist: row.artist,
    album: row.album,
    albumArtist: row.album_artist,
    genre: row.genre,
    year: row.year,
    trackNumber: row.track_number,
    probedAt: row.probed_at,
    probeError: row.probe_error,
    category: categoryForMedia({ kind: row.kind, path: row.path, genre: row.genre }),
    tmdb: mapTmdb(row),
    tmdbCheckedAt: row.tmdb_checked_at,
    thumbnailPath: row.thumbnail_path,
    playback: mapPlayback(row),
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  }
}

export interface ScannedFileInput {
  sourceId: number
  path: string
  kind: MediaKind
  /** file name without extension - replaced by the tag title once metadata is extracted */
  title: string
  sizeBytes: number
  mtimeMs: number
}

/** SQL condition: the scanned file differs from what's in the db (upsert conflict branch) */
const CHANGED = '(size_bytes IS NOT excluded.size_bytes OR mtime_ms IS NOT excluded.mtime_ms)'

/**
 * Inserts a file found by the scanner, or refreshes it on a rescan. Metadata
 * is kept as long as the file looks unchanged (same size and mtime) so a
 * rescan doesn't re-run ffprobe on the whole library; a changed file gets
 * its title reset and is queued for extraction again (probed_at = NULL),
 * and for a new thumbnail (thumbnail_checked_at = NULL).
 */
export function upsertScannedFile(input: ScannedFileInput): void {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO media (source_id, path, kind, title, size_bytes, mtime_ms, added_at, updated_at)
       VALUES (@sourceId, @path, @kind, @title, @sizeBytes, @mtimeMs, @now, @now)
       ON CONFLICT(path) DO UPDATE SET
         source_id = excluded.source_id,
         kind = excluded.kind,
         title = CASE WHEN ${CHANGED} THEN excluded.title ELSE title END,
         probed_at = CASE WHEN ${CHANGED} THEN NULL ELSE probed_at END,
         probe_error = CASE WHEN ${CHANGED} THEN NULL ELSE probe_error END,
         thumbnail_checked_at = CASE WHEN ${CHANGED} THEN NULL ELSE thumbnail_checked_at END,
         size_bytes = excluded.size_bytes,
         mtime_ms = excluded.mtime_ms,
         updated_at = excluded.updated_at`,
    )
    .run({ ...input, now })
}

/** files of a source that still need ffprobe - never probed, or changed since */
export function listMediaToProbe(sourceId: number): { id: number; path: string }[] {
  return getDb()
    .prepare('SELECT id, path FROM media WHERE source_id = ? AND probed_at IS NULL ORDER BY path')
    .all(sourceId) as { id: number; path: string }[]
}

export function saveMediaMetadata(id: number, metadata: MediaMetadata): void {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE media SET
         title = COALESCE(@tagTitle, title),
         duration_seconds = @durationSeconds,
         format_name = @formatName,
         video_codec = @videoCodec,
         audio_codec = @audioCodec,
         is_natively_playable = @isNativelyPlayable,
         bit_rate = @bitRate,
         width = @width,
         height = @height,
         artist = @artist,
         album = @album,
         album_artist = @albumArtist,
         genre = @genre,
         year = @year,
         track_number = @trackNumber,
         probed_at = @now,
         probe_error = NULL,
         updated_at = @now
       WHERE id = @id`,
    )
    .run({
      id,
      now,
      tagTitle: metadata.tagTitle,
      durationSeconds: metadata.durationSeconds,
      formatName: metadata.formatName,
      videoCodec: metadata.videoCodec,
      audioCodec: metadata.audioCodec,
      isNativelyPlayable: metadata.isNativelyPlayable ? 1 : 0,
      bitRate: metadata.bitRate,
      width: metadata.width,
      height: metadata.height,
      artist: metadata.artist,
      album: metadata.album,
      albumArtist: metadata.albumArtist,
      genre: metadata.genre,
      year: metadata.year,
      trackNumber: metadata.trackNumber,
    })
}

/** marks a file as probed-but-failed so it isn't retried on every rescan (until it changes) */
export function saveProbeError(id: number, message: string): void {
  const now = new Date().toISOString()
  getDb()
    .prepare('UPDATE media SET probed_at = ?, probe_error = ?, updated_at = ? WHERE id = ?')
    .run(now, message, now, id)
}

export function getMedia(id: number): MediaRecord | null {
  const row = getDb().prepare(`${SELECT_MEDIA} WHERE media.id = ?`).get(id) as MediaRow | undefined
  return row ? mapMedia(row) : null
}

/** films of a source not looked up on TMDB yet */
export function listMediaToEnrich(sourceId: number): { id: number; path: string }[] {
  return getDb()
    .prepare(
      `SELECT id, path FROM media
       WHERE source_id = ? AND kind = 'video' AND tmdb_checked_at IS NULL
       ORDER BY path`,
    )
    .all(sourceId) as { id: number; path: string }[]
}

export interface TmdbMatchInput {
  tmdbId: number
  title: string
  originalTitle: string
  overview: string
  year: number | null
  rating: number | null
  posterPath: string | null
  backdropPath: string | null
}

/** stores a TMDB match, or `null` to record "looked up, nothing confident" (not retried on rescan) */
export function saveTmdbMatch(id: number, match: TmdbMatchInput | null): void {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE media SET
         tmdb_id = @tmdbId,
         tmdb_title = @title,
         tmdb_original_title = @originalTitle,
         tmdb_overview = @overview,
         tmdb_year = @year,
         tmdb_rating = @rating,
         tmdb_poster_path = @posterPath,
         tmdb_backdrop_path = @backdropPath,
         tmdb_checked_at = @now,
         updated_at = @now
       WHERE id = @id`,
    )
    .run({
      id,
      now,
      tmdbId: match?.tmdbId ?? null,
      title: match?.title ?? null,
      originalTitle: match?.originalTitle ?? null,
      overview: match?.overview ?? null,
      year: match?.year ?? null,
      rating: match?.rating ?? null,
      posterPath: match?.posterPath ?? null,
      backdropPath: match?.backdropPath ?? null,
    })
}

export interface ThumbnailQueueItem {
  id: number
  path: string
  durationSeconds: number | null
}

/** videos of a source still without a thumbnail attempt - no video_codec means no frame to grab */
export function listMediaToThumbnail(sourceId: number): ThumbnailQueueItem[] {
  return getDb()
    .prepare(
      `SELECT id, path, duration_seconds AS durationSeconds FROM media
       WHERE source_id = ? AND kind = 'video' AND video_codec IS NOT NULL
         AND thumbnail_checked_at IS NULL
       ORDER BY path`,
    )
    .all(sourceId) as ThumbnailQueueItem[]
}

/** stores a thumbnail, or `null` to record a failed attempt; false if the row no longer exists */
export function saveThumbnail(id: number, thumbnailPath: string | null): boolean {
  const now = new Date().toISOString()
  const { changes } = getDb()
    .prepare(
      `UPDATE media SET thumbnail_path = ?, thumbnail_checked_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(thumbnailPath, now, now, id)
  return changes > 0
}

/** the SELECT makes this a no-op when the media was removed during playback */
export function savePlaybackState(
  mediaId: number,
  positionSeconds: number,
  durationSeconds: number,
): void {
  const now = new Date().toISOString()
  const watchedAt = isWatched(positionSeconds, durationSeconds) ? now : null
  getDb()
    .prepare(
      `INSERT INTO playback_state (media_id, position_seconds, duration_seconds, watched_at, updated_at)
       SELECT id, @positionSeconds, @durationSeconds, @watchedAt, @now FROM media WHERE id = @mediaId
       ON CONFLICT(media_id) DO UPDATE SET
         position_seconds = excluded.position_seconds,
         duration_seconds = excluded.duration_seconds,
         watched_at = COALESCE(excluded.watched_at, watched_at),
         updated_at = excluded.updated_at`,
    )
    .run({ mediaId, positionSeconds, durationSeconds, watchedAt, now })
}

/** where to offer resuming a media from, null when it should just start over */
export function getResumePosition(mediaId: number): number | null {
  const row = getDb()
    .prepare('SELECT position_seconds, duration_seconds FROM playback_state WHERE media_id = ?')
    .get(mediaId) as { position_seconds: number; duration_seconds: number } | undefined
  return row && canResume(row.position_seconds, row.duration_seconds) ? row.position_seconds : null
}

export function getTmdbCache(cacheKey: string, maxAgeMs: number): string | null {
  const row = getDb()
    .prepare('SELECT payload, fetched_at FROM tmdb_cache WHERE cache_key = ?')
    .get(cacheKey) as { payload: string; fetched_at: string } | undefined
  if (!row || Date.now() - Date.parse(row.fetched_at) > maxAgeMs) return null
  return row.payload
}

export function setTmdbCache(cacheKey: string, payload: string): void {
  getDb()
    .prepare(
      `INSERT INTO tmdb_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .run(cacheKey, payload, new Date().toISOString())
}

export function listMedia(sourceId?: number): MediaRecord[] {
  const database = getDb()
  const rows = (
    sourceId === undefined
      ? database.prepare(`${SELECT_MEDIA} ORDER BY title ASC`).all()
      : database.prepare(`${SELECT_MEDIA} WHERE source_id = ? ORDER BY title ASC`).all(sourceId)
  ) as MediaRow[]
  return rows.map(mapMedia)
}

export function listMediaIds(sourceId: number): number[] {
  const rows = getDb().prepare('SELECT id FROM media WHERE source_id = ?').all(sourceId) as {
    id: number
  }[]
  return rows.map((row) => row.id)
}

export function removeMediaForSource(sourceId: number): void {
  getDb().prepare('DELETE FROM media WHERE source_id = ?').run(sourceId)
}
