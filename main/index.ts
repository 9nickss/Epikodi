import { app, BrowserWindow } from 'electron'
import path from 'node:path'

const isDev = !app.isPackaged
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    void win.loadURL(devServerUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(__dirname, '../../renderer/dist/index.html'))
  }
}

void app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
