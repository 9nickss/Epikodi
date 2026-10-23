import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ElectronBridge, TranscodeProgress } from '../shared/types'

const bridge: ElectronBridge = {
  version: process.env.npm_package_version ?? '0.0.0',
  getPathForFile: (file) => webUtils.getPathForFile(file),
  probeMedia: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  transcodeMedia: (filePath, durationSeconds, requestId) =>
    ipcRenderer.invoke('media:transcode', filePath, durationSeconds, requestId),
  onTranscodeProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: TranscodeProgress) => listener(progress)
    ipcRenderer.on('media:transcode-progress', handler)
    return () => ipcRenderer.removeListener('media:transcode-progress', handler)
  },
}

contextBridge.exposeInMainWorld('epikodi', bridge)
