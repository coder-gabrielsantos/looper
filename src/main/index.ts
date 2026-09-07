import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { setupMediaPermissions } from './mediaPermission'
import { IPC_CHANNELS } from '../shared/ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    resizable: false,
    maximizable: false,
    minimizable: true,
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

  ipcMain.handle(
    IPC_CHANNELS.SAVE_MP3,
    async (_event, audioData: Uint8Array, suggestedName: string) => {
      const options = {
        title: 'Export loop mixdown',
        defaultPath: suggestedName,
        filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'] as const
      }
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)

      if (result.canceled || !result.filePath) return { saved: false }

      const filePath = result.filePath.toLowerCase().endsWith('.mp3')
        ? result.filePath
        : `${result.filePath}.mp3`
      await writeFile(filePath, Buffer.from(audioData))
      return { saved: true, filePath }
    }
  )

  Menu.setApplicationMenu(null)
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
