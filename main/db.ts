import path from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type { MediaKind, MediaRecord, SourceRecord } from '../shared/types'

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
}

// --- sources ---

interface SourceRow {
  id: number
  path: string
  label: string
  created_at: string
}

function mapSource(row: SourceRow): SourceRecord {
  return { id: row.id, path: row.path, label: row.label, createdAt: row.created_at }
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
  duration_seconds: number | null
  format_name: string | null
  video_codec: string | null
  audio_codec: string | null
  is_natively_playable: number | null
  added_at: string
  updated_at: string
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
    isNativelyPlayable: row.is_natively_playable === null ? null : Boolean(row.is_natively_playable),
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  }
}

export interface UpsertMediaInput {
  sourceId: number
  path: string
  kind: MediaKind
  title: string
  sizeBytes?: number | null
  durationSeconds?: number | null
  formatName?: string | null
  videoCodec?: string | null
  audioCodec?: string | null
  isNativelyPlayable?: boolean | null
}

/** insert a media file, or refresh its metadata if its path is already indexed */
export function upsertMedia(input: UpsertMediaInput): MediaRecord {
  const now = new Date().toISOString()
  const row = getDb()
    .prepare(
      `INSERT INTO media (
         source_id, path, kind, title, size_bytes, duration_seconds,
         format_name, video_codec, audio_codec, is_natively_playable, added_at, updated_at
       ) VALUES (@sourceId, @path, @kind, @title, @sizeBytes, @durationSeconds,
         @formatName, @videoCodec, @audioCodec, @isNativelyPlayable, @addedAt, @updatedAt)
       ON CONFLICT(path) DO UPDATE SET
         title = excluded.title,
         size_bytes = excluded.size_bytes,
         duration_seconds = excluded.duration_seconds,
         format_name = excluded.format_name,
         video_codec = excluded.video_codec,
         audio_codec = excluded.audio_codec,
         is_natively_playable = excluded.is_natively_playable,
         updated_at = excluded.updated_at
       RETURNING *`,
    )
    .get({
      sourceId: input.sourceId,
      path: input.path,
      kind: input.kind,
      title: input.title,
      sizeBytes: input.sizeBytes ?? null,
      durationSeconds: input.durationSeconds ?? null,
      formatName: input.formatName ?? null,
      videoCodec: input.videoCodec ?? null,
      audioCodec: input.audioCodec ?? null,
      isNativelyPlayable:
        input.isNativelyPlayable === undefined || input.isNativelyPlayable === null
          ? null
          : input.isNativelyPlayable
            ? 1
            : 0,
      addedAt: now,
      updatedAt: now,
    }) as MediaRow
  return mapMedia(row)
}

export function listMedia(sourceId?: number): MediaRecord[] {
  const database = getDb()
  const rows = (
    sourceId === undefined
      ? database.prepare('SELECT * FROM media ORDER BY title ASC').all()
      : database.prepare('SELECT * FROM media WHERE source_id = ? ORDER BY title ASC').all(sourceId)
  ) as MediaRow[]
  return rows.map(mapMedia)
}

export function removeMediaForSource(sourceId: number): void {
  getDb().prepare('DELETE FROM media WHERE source_id = ?').run(sourceId)
}
