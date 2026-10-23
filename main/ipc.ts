import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import type { AddSourceResult, ScanResult } from '../shared/types'
import { addSource, getSource, listMedia, listSources, recordSourceScan, removeSource } from './db'
import { transcodeToMp4 } from './ffmpeg'
import { probeMediaFile } from './ffprobe'
import { checkSourcePath } from './network'
import { scanDirectory } from './scan'

/** sources with a scan in flight - a rescan request while one runs is ignored */
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

  void scanDirectory(sourceId, folderPath, {
    onFileIndexed: (filesFound) => {
      if (!sender.isDestroyed()) sender.send('library:scan-progress', { sourceId, filesFound })
    },
  })
    .catch((error: unknown): ScanResult => ({
      sourceId,
      filesFound: 0,
      status: 'failed',
      errors: [
        { path: folderPath, message: error instanceof Error ? error.message : String(error) },
      ],
      errorCount: 1,
    }))
    .then((result) => {
      activeScans.delete(sourceId)
      // the source may have been removed while scanning
      if (getSource(sourceId)) recordSourceScan(sourceId, result.status, summarizeScan(result))
      if (!sender.isDestroyed()) sender.send('library:scan-done', result)
    })
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

  ipcMain.handle('library:list-media', (_event, sourceId?: number) => listMedia(sourceId))

  ipcMain.handle('library:remove-source', (_event, sourceId: number) => {
    removeSource(sourceId)
  })
}
