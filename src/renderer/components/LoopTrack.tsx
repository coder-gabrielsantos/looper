import { useCallback, useEffect, useState } from 'react'
import { getAudioEngine } from '../audio/audioEngine'
import { TrackId, TrackState } from '../audio/types'
import styles from './LoopTrack.module.css'
import VolumeSlider from './VolumeSlider'
import VuMeter from './VuMeter'

interface LoopTrackProps {
  trackId: TrackId
  label: string
  disabled?: boolean
  onError?: (message: string) => void
  onTrackStateChange?: (trackId: TrackId, state: TrackState) => void
}

const STATE_LABELS: Record<TrackState, string> = {
  [TrackState.IDLE]: 'READY',
  [TrackState.STANDBY]: 'WAITING FOR GRID',
  [TrackState.RECORDING]: 'CAPTURING',
  [TrackState.PLAYING]: 'LOOPING'
}

const ACTION_LABELS: Record<TrackState, string> = {
  [TrackState.IDLE]: 'ARM',
  [TrackState.STANDBY]: 'QUEUED',
  [TrackState.RECORDING]: 'RECORDING',
  [TrackState.PLAYING]: 'REPLACE'
}

export default function LoopTrack({
  trackId,
  label,
  disabled = false,
  onError,
  onTrackStateChange
}: LoopTrackProps) {
  const [state, setState] = useState<TrackState>(TrackState.IDLE)
  const [level, setLevel] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const engine = getAudioEngine()
    const handleStateChange = (nextState: TrackState) => {
      setState(nextState)
      onTrackStateChange?.(trackId, nextState)
    }

    engine.setLevelCallback(trackId, setLevel)
    engine.setStateCallback(trackId, handleStateChange)

    return () => {
      engine.setLevelCallback(trackId, null)
      engine.setStateCallback(trackId, null)
    }
  }, [onTrackStateChange, trackId])

  const handleRecord = useCallback(async () => {
    if (state === TrackState.STANDBY || state === TrackState.RECORDING) return
    setBusy(true)
    try {
      await getAudioEngine().startRecording(trackId)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Audio operation failed')
    } finally {
      setBusy(false)
    }
  }, [onError, state, trackId])

  const handleClear = useCallback(() => {
    getAudioEngine().clearTrack(trackId)
  }, [trackId])

  const handleVolumeChange = useCallback(
    (value: number) => {
      setVolume(value)
      getAudioEngine().setVolume(trackId, value)
    },
    [trackId]
  )

  const recordDisabled =
    disabled || busy || state === TrackState.STANDBY || state === TrackState.RECORDING

  return (
    <article className={`${styles.track} ${styles[state]}`}>
      <header className={styles.header}>
        <div>
          <span className={styles.number}>0{trackId + 1}</span>
          <h2 className={styles.title}>{label}</h2>
        </div>
        <div className={styles.state}>
          <span className={styles.stateMark} />
          {STATE_LABELS[state]}
        </div>
      </header>

      <div className={styles.meterGroup}>
        <span className={styles.microLabel}>SIGNAL</span>
        <VuMeter level={level} />
      </div>

      <button
        className={styles.recordButton}
        onClick={handleRecord}
        disabled={recordDisabled}
        aria-label={`${ACTION_LABELS[state]} ${label}`}
      >
        <span className={styles.actionMark} />
        <span>{ACTION_LABELS[state]}</span>
      </button>

      <div className={styles.volumeGroup}>
        <span className={styles.microLabel}>LEVEL</span>
        <VolumeSlider value={volume} onChange={handleVolumeChange} />
      </div>

      <footer className={styles.footer}>
        <span>SYNC / MASTER</span>
        <button
          className={styles.clearButton}
          onClick={handleClear}
          disabled={disabled || busy || state === TrackState.IDLE}
        >
          CLEAR
        </button>
      </footer>
    </article>
  )
}
