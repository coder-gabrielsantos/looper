export const IPC_CHANNELS = {
  DEVICE_LOST: 'device-lost',
  GET_APP_PATH: 'get-app-path',
  SAVE_MP3: 'save-mp3'
} as const

export interface SaveMp3Result {
  saved: boolean
  filePath?: string
}
