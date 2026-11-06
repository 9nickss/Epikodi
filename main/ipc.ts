import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import type {
  AddSourceResult,
  IndexingDone,
  IndexingPhase,
  IndexingProgress,
  ScanResult,
} from '../shared/types'
import {
  addSource,
  getResumePosition,
  getSource,
  listMedia,
  listMediaIds,
  listSources,
  recordSourceScan,
  removeSource,
  savePlaybackState,
} from './db'
import { getDiscoverDetails, listDiscoverRows } from './discover'
import { transcodeToMp4 } from './ffmpeg'
import { probeMediaFile } from './ffprobe'
import { enrichSourceFromTmdb, rematchMedia } from './enrich'
import { extractSourceMetadata } from './metadata'
import { checkSourcePath } from './network'
import { scanDirectory } from './scan'
import { generateSourceThumbnails, removeThumbnails } from './thumbnails'
import { isTmdbConfigured } from './tmdb'

/** sources with a scan (file walk + metadata + TMDB + thumbnails) in flight - a rescan request while one runs is ignored */
const activeScans = new Set<number>()

function summarizeScan(result: ScanResult): string | null {
  if (result.status === 'ok') return null
  const first = result.errors[0]
  const detail = first ? `${first.message} (${first.path})` : 'erreur inconnue'
  if (result.status === 'failed') return detail
  const others = result.errorCount - 1
  return others > 0 ? `${detail} et ${others} autre(s) erreur(s)` : detail
}

function startScan(sender: WebContents, sourceId: number, folderPath: string): void {
  if (activeScans.has(sourceId)) return
  activeScans.add(sourceId)

  // also tell the renderer a scan started, so a rescan shows progress before the first file
  sender.send('library:scan-progress', { sourceId, filesFound: 0 })

  const send = (channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }

  void (async () => {
    // phase 1: walk the folder - files show up in the library as soon as this is done
    const result = await scanDirectory(sourceId, folderPath, {
      onFileIndexed: (filesFound) => send('library:scan-progress', { sourceId, filesFound }),
    }).catch((error: unknown): ScanResult => ({
      sourceId,
      filesFound: 0,
      status: 'failed',
      errors: [
        { path: folderPath, message: error instanceof Error ? error.message : String(error) },
      ],
      errorCount: 1,
    }))
    // the source may have been removed while scanning
    if (getSource(sourceId)) recordSourceScan(sourceId, result.status, summarizeScan(result))
    send('library:scan-done', result)

    if (result.status === 'failed') return

    const runPhase = async (
      phase: IndexingPhase,
      run: (
        onProgress: (done: number, total: number) => void,
      ) => Promise<{ done: number; total: number; error: string | null }>,
    ): Promise<void> => {
      if (!getSource(sourceId)) return
      const outcome = await run((done, total) =>
        send('library:indexing-progress', {
          sourceId,
          phase,
          done,
          total,
        } satisfies IndexingProgress),
      ).catch((error: unknown) => ({
        done: 0,
        total: 0,
        error: error instanceof Error ? error.message : String(error),
      }))
      send('library:indexing-done', { sourceId, phase, ...outcome } satisfies IndexingDone)
    }

    // phase 2: ffprobe the new/changed files (Issue 3.4)
    await runPhase('metadata', (onProgress) => extractSourceMetadata(sourceId, { onProgress }))
    // phase 3: TMDB lookup of new films (Issue 5.2) - no-op without a key in .env
    await runPhase('tmdb', (onProgress) => enrichSourceFromTmdb(sourceId, { onProgress }))
    // phase 4: thumbnails of new/changed videos (Issue F2.1) - needs the duration from phase 2
    await runPhase('thumbnails', (onProgress) => generateSourceThumbnails(sourceId, { onProgress }))
  })().finally(() => activeScans.delete(sourceId))
}

async function addAndScan(sender: WebContents, rawPath: string): Promise<AddSourceResult> {
  const checked = await checkSourcePath(rawPath)
  if (!checked.ok) return checked

  const source = addSource(checked.path)
  startScan(sender, source.id, source.path)
  return { ok: true, source }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('media:probe', (_event, filePath: string) => probeMediaFile(filePath))

  ipcMain.handle(
    'media:transcode',
    async (event, filePath: string, durationSeconds: number | null, requestId: string) => {
      const fileUrl = await transcodeToMp4(filePath, durationSeconds, (percent) => {
        event.sender.send('media:transcode-progress', { requestId, percent })
      })
      return { fileUrl }
    },
  )

  ipcMain.handle('playback:get-resume', (_event, mediaId: number) => getResumePosition(mediaId))

  ipcMain.handle(
    'playback:save',
    (_event, mediaId: number, positionSeconds: number, durationSeconds: number) =>
      savePlaybackState(mediaId, positionSeconds, durationSeconds),
  )

  ipcMain.handle('library:add-source', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })

    if (result.canceled || result.filePaths.length === 0) return null
    return addAndScan(event.sender, result.filePaths[0])
  })

  ipcMain.handle('library:add-source-path', (event, sourcePath: string) =>
    addAndScan(event.sender, sourcePath),
  )

  ipcMain.handle('library:rescan-source', (event, sourceId: number) => {
    const source = getSource(sourceId)
    if (source) startScan(event.sender, source.id, source.path)
  })

  ipcMain.handle('library:list-sources', () => listSources())

  ipcMain.handle('tmdb:status', () => ({ configured: isTmdbConfigured() }))

  ipcMain.handle(
    'tmdb:rematch',
    (_event, mediaId: number, query?: { title: string; year: number | null }) =>
      rematchMedia(mediaId, query),
  )

  ipcMain.handle('tmdb:discover', () => listDiscoverRows())

  ipcMain.handle('tmdb:discover-details', (_event, movieId: number) => getDiscoverDetails(movieId))

  ipcMain.handle('library:list-media', (_event, sourceId?: number) => listMedia(sourceId))

  ipcMain.handle('library:remove-source', async (_event, sourceId: number) => {
    const mediaIds = listMediaIds(sourceId)
    removeSource(sourceId)
    await removeThumbnails(mediaIds)
  })
}
