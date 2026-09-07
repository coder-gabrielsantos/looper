import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'

contextBridge.exposeInMainWorld('electronAPI', {
  getAppPath: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_PATH),
  saveMp3: (audioData: Uint8Array, suggestedName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_MP3, audioData, suggestedName),
  onDeviceLost: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.DEVICE_LOST, callback)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DEVICE_LOST, callback)
    }
  }
})
