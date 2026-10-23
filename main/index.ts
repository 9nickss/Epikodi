import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { closeDatabase, getDb } from './db'
import { registerIpcHandlers } from './ipc'
import { registerMediaProtocolHandler, registerMediaProtocolScheme } from './protocols'

const isDev = !app.isPackaged
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'

// otherwise userData (and the SQLite db in it) lands under a generic
// "Electron" folder instead of "EpiKodi" while running unpackaged
app.setName('EpiKodi')

// no File/Edit/View/... menu bar - this isn't a document editor
Menu.setApplicationMenu(null)

// must be registered before the app is ready
registerMediaProtocolScheme()

// Chromium's sandbox needs a setuid helper that isn't available when running
// as root (e.g. inside the Docker dev container) — disable it there instead
// of requiring every container to be configured for it.
if (process.getuid?.() === 0) {
  app.commandLine.appendSwitch('no-sandbox')
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'EpiKodi',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../../renderer/dist/index.html'))
  }

  return win
}

void app.whenReady().then(() => {
  // fail fast on startup if the native module / schema is broken, rather
  // than surfacing it later during a scan (Issue 3.2)
  getDb()
  registerMediaProtocolHandler()
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDatabase()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
