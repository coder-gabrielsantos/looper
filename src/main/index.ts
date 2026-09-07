import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { setupMediaPermissions } from './mediaPermission'
import { IPC_CHANNELS } from '../shared/ipc'
import { getPluginManager } from './vst/pluginManager'

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

  // VST Plugin IPC handlers
  const pluginManager = getPluginManager()

  ipcMain.handle(IPC_CHANNELS.VST_IS_AVAILABLE, () => {
    return pluginManager.isAvailable()
  })

  ipcMain.handle(IPC_CHANNELS.VST_SCAN_PLUGINS, async (_event, paths?: string[]) => {
    return pluginManager.scanPlugins(paths)
  })

  ipcMain.handle(
    IPC_CHANNELS.VST_LOAD_PLUGIN,
    async (_event, pluginPath: string, sampleRate: number, blockSize: number) => {
      return pluginManager.loadPlugin(pluginPath, sampleRate, blockSize)
    }
  )

  ipcMain.handle(IPC_CHANNELS.VST_UNLOAD_PLUGIN, (_event, handle: number) => {
    pluginManager.unloadPlugin(handle)
  })

  ipcMain.handle(
    IPC_CHANNELS.VST_PROCESS_AUDIO,
    async (_event, handle: number, input: Float32Array) => {
      const output = new Float32Array(input.length)
      pluginManager.processAudio(handle, input, output)
      return output
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.VST_SET_PARAMETER,
    (_event, handle: number, index: number, value: number) => {
      pluginManager.setParameter(handle, index, value)
    }
  )

  ipcMain.handle(IPC_CHANNELS.VST_SET_TEMPO, (_event, handle: number, bpm: number) => {
    pluginManager.setTempo(handle, bpm)
  })

  ipcMain.handle(IPC_CHANNELS.VST_GET_PARAMETERS, (_event, handle: number) => {
    const count = pluginManager.getParameterCount(handle)
    const params: { index: number; value: number }[] = []
    for (let i = 0; i < count; i++) {
      params.push({ index: i, value: pluginManager.getParameter(handle, i) })
    }
    return params
  })

  ipcMain.handle(IPC_CHANNELS.VST_OPEN_EDITOR, (_event, handle: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('The main window is not available')
    }
    return pluginManager.openEditor(handle, mainWindow.getNativeWindowHandle())
  })

  ipcMain.handle(IPC_CHANNELS.VST_CLOSE_EDITOR, (_event, handle: number) => {
    pluginManager.closeEditor(handle)
  })

  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  getPluginManager().dispose()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
