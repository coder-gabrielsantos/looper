import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { setupMediaPermissions } from './mediaPermission'
import { IPC_CHANNELS } from '../shared/ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  setupMediaPermissions()

  ipcMain.handle(IPC_CHANNELS.GET_APP_PATH, () => {
    return app.getAppPath()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
