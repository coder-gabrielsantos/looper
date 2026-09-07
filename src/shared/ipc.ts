export const IPC_CHANNELS = {
  DEVICE_LOST: 'device-lost',
  GET_APP_PATH: 'get-app-path',
  SAVE_MP3: 'save-mp3',
  VST_SCAN_PLUGINS: 'vst:scan-plugins',
  VST_LOAD_PLUGIN: 'vst:load-plugin',
  VST_UNLOAD_PLUGIN: 'vst:unload-plugin',
  VST_GET_PARAMETERS: 'vst:get-parameters',
  VST_SET_PARAMETER: 'vst:set-parameter',
  VST_SET_TEMPO: 'vst:set-tempo',
  VST_PROCESS_AUDIO: 'vst:process-audio',
  VST_OPEN_EDITOR: 'vst:open-editor',
  VST_CLOSE_EDITOR: 'vst:close-editor',
  VST_IS_AVAILABLE: 'vst:is-available'
} as const

export interface SaveMp3Result {
  saved: boolean
  filePath?: string
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
