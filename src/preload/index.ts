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
  },
  vst: {
    isAvailable: () => ipcRenderer.invoke(IPC_CHANNELS.VST_IS_AVAILABLE),
    scanPlugins: (paths?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.VST_SCAN_PLUGINS, paths),
    loadPlugin: (pluginPath: string, sampleRate: number, blockSize: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.VST_LOAD_PLUGIN, pluginPath, sampleRate, blockSize),
    unloadPlugin: (handle: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.VST_UNLOAD_PLUGIN, handle),
    processAudio: (handle: number, input: Float32Array) =>
      ipcRenderer.invoke(IPC_CHANNELS.VST_PROCESS_AUDIO, handle, input),
    setParameter: (handle: number, index: number, value: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.VST_SET_PARAMETER, handle, index, value),
    setTempo: (handle: number, bpm: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.VST_SET_TEMPO, handle, bpm),
    getParameters: (handle: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.VST_GET_PARAMETERS, handle),
    openEditor: (handle: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.VST_OPEN_EDITOR, handle),
    closeEditor: (handle: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.VST_CLOSE_EDITOR, handle)
  }
})
