import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ElectronBridge, ScanProgress, SourceRecord, TranscodeProgress } from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const bridge: ElectronBridge = {
  version: process.env.npm_package_version ?? '0.0.0',
  getPathForFile: (file) => webUtils.getPathForFile(file),
  probeMedia: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  transcodeMedia: (filePath, durationSeconds, requestId) =>
    ipcRenderer.invoke('media:transcode', filePath, durationSeconds, requestId),
  onTranscodeProgress: (listener) => subscribe<TranscodeProgress>('media:transcode-progress', listener),

  addSource: () => ipcRenderer.invoke('library:add-source') as Promise<SourceRecord | null>,
  listSources: () => ipcRenderer.invoke('library:list-sources'),
  listMedia: (sourceId) => ipcRenderer.invoke('library:list-media', sourceId),
  removeSource: (sourceId) => ipcRenderer.invoke('library:remove-source', sourceId),
  onScanProgress: (listener) => subscribe<ScanProgress>('library:scan-progress', listener),
  onScanDone: (listener) => subscribe<ScanProgress>('library:scan-done', listener),
}

contextBridge.exposeInMainWorld('epikodi', bridge)
