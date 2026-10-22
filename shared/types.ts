/**
 * Types and contracts shared between the Electron main process and the
 * React renderer. Grows as IPC channels (scan, playback, plugins, …) land.
 */

export interface ElectronBridge {
  version: string
}

declare global {
  interface Window {
    epikodi: ElectronBridge
  }
}

export {}
