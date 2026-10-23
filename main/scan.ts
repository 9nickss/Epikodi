import type { Dir } from 'node:fs'
import { opendir, stat } from 'node:fs/promises'
import path from 'node:path'
import { kindForExtension } from '../shared/mediaExtensions'
import type { ScanError, ScanResult } from '../shared/types'
import { upsertMedia } from './db'
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
        const kind = kindForExtension(extension)
        if (!kind) continue

        let sizeBytes: number
        try {
          sizeBytes = (await withTimeout(stat(entryPath), 'stat', entryPath)).size
        } catch (error) {
          recordError(entryPath, error)
          continue
        }

        upsertMedia({
          sourceId,
          path: entryPath,
          kind,
          title: path.basename(entry.name, path.extname(entry.name)),
          sizeBytes,
        })

        filesFound += 1
        callbacks.onFileIndexed?.(filesFound)
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
