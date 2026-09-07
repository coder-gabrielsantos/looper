import { useCallback, useEffect, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
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
  onRemove: (trackId: TrackId) => void
}

export default function LoopTrack({
  trackId,
  label,
  disabled = false,
  onError,
  onTrackStateChange,
  onRemove
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
    if (state !== TrackState.IDLE) return
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

  const handleTogglePlayback = useCallback(() => {
    getAudioEngine().toggleTrackPlayback(trackId)
  }, [trackId])

  const handleRemove = useCallback(() => {
    onRemove(trackId)
  }, [onRemove, trackId])

  const handleVolumeChange = useCallback(
    (value: number) => {
      setVolume(value)
      getAudioEngine().setVolume(trackId, value)
    },
    [trackId]
  )

  const hasRecordedLoop = state === TrackState.PLAYING || state === TrackState.PAUSED
  const recordLabel =
    state === TrackState.PLAYING
      ? 'PAUSE'
      : state === TrackState.PAUSED
        ? 'RESUME'
        : state === TrackState.IDLE
          ? 'ARM'
          : state === TrackState.STANDBY
            ? 'QUEUED'
            : 'RECORDING'
  const recordDisabled =
    disabled || busy || state === TrackState.STANDBY || state === TrackState.RECORDING

  return (
    <article className={`${styles.track} ${styles[state]}`}>
      <header className={styles.header}>
        <div>
          <span className={styles.number}>{String(trackId + 1).padStart(2, '0')}</span>
          <h2 className={styles.title}>{label}</h2>
        </div>
        <button
          className={styles.removeTrackButton}
          type="button"
          onClick={handleRemove}
          disabled={disabled || busy}
          aria-label={`Remove ${label}`}
        >
          <X aria-hidden="true" />
        </button>
      </header>

      <div className={styles.meterGroup}>
        <span className={styles.microLabel}>SIGNAL</span>
        <VuMeter level={level} />
      </div>

      <button
        className={styles.recordButton}
        onClick={hasRecordedLoop ? handleTogglePlayback : handleRecord}
        disabled={recordDisabled}
        aria-label={`${recordLabel} ${label}`}
      >
        {state === TrackState.PLAYING ? (
          <Pause className={styles.playIcon} aria-hidden="true" />
        ) : state === TrackState.PAUSED ? (
          <Play className={styles.playIcon} aria-hidden="true" />
        ) : (
          <span className={styles.actionMark} />
        )}
        <span>{recordLabel}</span>
      </button>

      <div className={styles.volumeGroup}>
        <span className={styles.microLabel}>LEVEL</span>
        <VolumeSlider value={volume} onChange={handleVolumeChange} />
      </div>

      <footer className={styles.footer}>
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
