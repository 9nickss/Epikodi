import { opendir, stat } from 'node:fs/promises'
import path from 'node:path'
import { kindForExtension } from '../shared/mediaExtensions'
import { upsertMedia } from './db'

const SKIP_DIR_NAMES = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information'])

export interface ScanCallbacks {
  onFileIndexed?: (filesFound: number) => void
}

/**
 * Recursively walks a folder (local or network-mounted) and indexes every
 * file whose extension matches a known video/audio kind. Uses opendir's
 * async iterator so it never blocks the event loop and never buffers a
 * whole directory listing in memory. Unreadable folders/files (permissions,
 * a network share going away mid-walk) are skipped rather than aborting the
 * whole scan - proper timeout/error reporting for network sources is
 * Issue 3.3.
 */
export async function scanDirectory(
  sourceId: number,
  rootPath: string,
  callbacks: ScanCallbacks = {},
): Promise<number> {
  let filesFound = 0

  async function walk(dirPath: string): Promise<void> {
    let dir: Awaited<ReturnType<typeof opendir>>
    try {
      dir = await opendir(dirPath)
    } catch {
      return
    }

    try {
      for await (const entry of dir) {
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

        let sizeBytes: number | null = null
        try {
          sizeBytes = (await stat(entryPath)).size
        } catch {
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
    } catch {
      // directory became unreadable mid-walk (unmounted share, permissions) - stop this branch
    }
  }

  await walk(rootPath)
  return filesFound
}
