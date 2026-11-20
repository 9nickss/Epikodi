import type { Dir } from 'node:fs'
import { opendir, stat } from 'node:fs/promises'
import path from 'node:path'
import { kindForExtension } from '../shared/mediaExtensions'
import { describeSubtitle, isSubtitleExtension, matchSubtitles } from '../shared/subtitles'
import type { ScanError, ScanResult } from '../shared/types'
import { syncSubtitles, upsertScannedFile } from './db'
import { describeFsError, withTimeout } from './network'

const SKIP_DIR_NAMES = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information'])

/** errors kept in the result - the total is still counted past this */
const MAX_REPORTED_ERRORS = 20

export interface ScanCallbacks {
  onFileIndexed?: (filesFound: number) => void
}

/**
 * Recursively walks a folder (local or network-mounted) and indexes every
 * file whose extension matches a known video/audio kind. Reads directories
 * entry by entry so it never blocks the event loop and never buffers a whole
 * listing in memory.
 *
 * Every fs call is bounded by a timeout (Issue 3.3): a share that hangs or
 * drops mid-walk makes that branch fail instead of stalling the scan forever.
 * Unreadable sub-folders/files are recorded and skipped; only an unreachable
 * root fails the whole scan.
 */
export async function scanDirectory(
  sourceId: number,
  rootPath: string,
  callbacks: ScanCallbacks = {},
): Promise<ScanResult> {
  let filesFound = 0
  let errorCount = 0
  const errors: ScanError[] = []
  let rootFailed = false

  function recordError(errorPath: string, error: unknown): void {
    errorCount += 1
    if (errors.length < MAX_REPORTED_ERRORS) {
      errors.push({ path: errorPath, message: describeFsError(error) })
    }
  }

  async function walk(dirPath: string): Promise<void> {
    let dir: Dir
    try {
      dir = await withTimeout(opendir(dirPath), 'opendir', dirPath)
    } catch (error) {
      if (dirPath === rootPath) rootFailed = true
      recordError(dirPath, error)
      return
    }

    // collected for this folder only: subtitles go with a video next to them (#3.1)
    const videos: { path: string; baseName: string }[] = []
    const subtitles: { path: string; fileName: string }[] = []

    try {
      for (;;) {
        const entry = await withTimeout(dir.read(), 'readdir', dirPath)
        if (!entry) break
        if (entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue
        const entryPath = path.join(dirPath, entry.name)

        if (entry.isDirectory()) {
          await walk(entryPath)
          continue
        }
        if (!entry.isFile()) continue

        const extension = path.extname(entry.name).slice(1)
        if (isSubtitleExtension(extension)) {
          // not a media: only looked at once the whole folder is listed
          subtitles.push({ path: entryPath, fileName: entry.name })
          continue
        }
        const kind = kindForExtension(extension)
        if (!kind) continue

        let info: Awaited<ReturnType<typeof stat>>
        try {
          info = await withTimeout(stat(entryPath), 'stat', entryPath)
        } catch (error) {
          recordError(entryPath, error)
          continue
        }

        upsertScannedFile({
          sourceId,
          path: entryPath,
          kind,
          title: path.basename(entry.name, path.extname(entry.name)),
          sizeBytes: info.size,
          mtimeMs: info.mtimeMs,
        })

        if (kind === 'video') {
          videos.push({
            path: entryPath,
            baseName: path.basename(entry.name, path.extname(entry.name)),
          })
        }
        filesFound += 1
        callbacks.onFileIndexed?.(filesFound)
      }

      // every video of the folder is synced, so a deleted .srt disappears from the library too
      const matched = matchSubtitles(videos, subtitles)
      for (const video of videos) {
        const tracks = (matched.get(video.path) ?? []).map((file, index) => ({
          path: file.path,
          format: file.format,
          ...describeSubtitle(file.qualifier, index + 1),
        }))
        try {
          syncSubtitles(video.path, tracks)
        } catch (error) {
          recordError(video.path, error)
        }
      }
    } catch (error) {
      // directory became unreadable mid-walk (share dropped, timeout, permissions) - stop this branch
      recordError(dirPath, error)
    } finally {
      // a closed handle throws; a hung share may never settle - don't wait on it
      dir.close().catch(() => {})
    }
  }

  await walk(rootPath)

  const status = rootFailed ? 'failed' : errorCount > 0 ? 'partial' : 'ok'
  return { sourceId, filesFound, status, errors, errorCount }
}
