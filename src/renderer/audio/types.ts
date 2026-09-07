export type TrackId = 0 | 1 | 2

export enum TrackState {
  IDLE = 'idle',
  STANDBY = 'standby',
  RECORDING = 'recording',
  PLAYING = 'playing'
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
      onDeviceLost: (callback: () => void) => () => void
    }
  }
}
