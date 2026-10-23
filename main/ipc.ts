import { ipcMain } from 'electron'
import { transcodeToMp4 } from './ffmpeg'
import { probeMediaFile } from './ffprobe'

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
}
