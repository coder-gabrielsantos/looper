export type TrackId = number

export enum TrackState {
  IDLE = 'idle',
  STANDBY = 'standby',
  RECORDING = 'recording',
  PLAYING = 'playing',
  PAUSED = 'paused'
}

export interface TrackInfo {
  id: TrackId
  state: TrackState
  volume: number
  level: number
}

export interface VstPluginInfo {
  name: string
  path: string
  format: 'VST2' | 'VST3'
  vendor: string
}

export interface VstLoadedPlugin {
  handle: number
  numInputs: number
  numOutputs: number
  numParams: number
  initialDelay: number
  hasEditor: boolean
  name: string
}

export interface VstEditorResult {
  opened: boolean
  hasEditor: boolean
  width: number
  height: number
}

declare global {
  interface Window {
    electronAPI: {
      getAppPath: () => Promise<string>
      saveMp3: (
        audioData: Uint8Array,
        suggestedName: string
      ) => Promise<{ saved: boolean; filePath?: string }>
      onDeviceLost: (callback: () => void) => () => void
      vst: {
        isAvailable: () => Promise<boolean>
        scanPlugins: (paths?: string[]) => Promise<VstPluginInfo[]>
        loadPlugin: (
          pluginPath: string,
          sampleRate: number,
          blockSize: number
        ) => Promise<VstLoadedPlugin>
        unloadPlugin: (handle: number) => Promise<void>
        processAudio: (handle: number, input: Float32Array) => Promise<Float32Array>
        setParameter: (handle: number, index: number, value: number) => Promise<void>
        setTempo: (handle: number, bpm: number) => Promise<void>
        getParameters: (handle: number) => Promise<{ index: number; value: number }[]>
        openEditor: (handle: number) => Promise<VstEditorResult>
        closeEditor: (handle: number) => Promise<void>
      }
    }
  }
}
