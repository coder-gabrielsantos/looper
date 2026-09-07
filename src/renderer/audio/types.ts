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

declare global {
  interface Window {
    electronAPI: {
      getAppPath: () => Promise<string>
      saveMp3: (
        audioData: Uint8Array,
        suggestedName: string
      ) => Promise<{ saved: boolean; filePath?: string }>
      onDeviceLost: (callback: () => void) => () => void
    }
  }
}
