import { BrowserWindow, dialog, ipcMain } from 'electron'
import { addSource, listMedia, listSources, removeSource } from './db'
import { transcodeToMp4 } from './ffmpeg'
import { probeMediaFile } from './ffprobe'
import { scanDirectory } from './scan'

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

    const folderPath = result.filePaths[0]
    const source = addSource(folderPath)

    void scanDirectory(source.id, folderPath, {
      onFileIndexed: (filesFound) => {
        event.sender.send('library:scan-progress', { sourceId: source.id, filesFound })
      },
    }).then((filesFound) => {
      event.sender.send('library:scan-done', { sourceId: source.id, filesFound })
    })

    return source
  })

  ipcMain.handle('library:list-sources', () => listSources())

  ipcMain.handle('library:list-media', (_event, sourceId?: number) => listMedia(sourceId))

  ipcMain.handle('library:remove-source', (_event, sourceId: number) => {
    removeSource(sourceId)
  })
}
