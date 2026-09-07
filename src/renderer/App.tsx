import { useCallback, useEffect, useState } from 'react'
import { getAudioEngine } from './audio/audioEngine'
import { TrackId, TrackState } from './audio/types'
import logoUrl from './assets/logo.svg'
import styles from './App.module.css'
import AddTrackCard from './components/AddTrackCard'
import ClockControls from './components/ClockControls'
import CycleProgress from './components/CycleProgress'
import InputSelector from './components/InputSelector'
import LoopTrack from './components/LoopTrack'

const INITIAL_TRACK_STATES: Record<TrackId, TrackState> = {
  0: TrackState.IDLE,
  1: TrackState.IDLE
}

const INITIAL_TRACK_IDS: TrackId[] = [0, 1]
type ExportState = 'idle' | 'exporting' | 'complete'

function getTrackLabel(trackId: TrackId): string {
  if (trackId < 26) return `Track ${String.fromCharCode(65 + trackId)}`
  return `Track ${trackId + 1}`
}

function getExportFileName(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `looper-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.mp3`
}

export default function App() {
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [trackStates, setTrackStates] = useState(INITIAL_TRACK_STATES)
  const [trackIds, setTrackIds] = useState<TrackId[]>(INITIAL_TRACK_IDS)
  const [exportState, setExportState] = useState<ExportState>('idle')

  useEffect(() => {
    let active = true
    let cleanup: (() => void) | undefined

    async function init() {
      try {
        await getAudioEngine().init()
        if (active) {
          setError(null)
          setReady(true)
        }
      } catch (err) {
        if (active) {
          setReady(false)
          setError(err instanceof Error ? err.message : 'Failed to initialize audio engine')
        }
      }
    }

    void init()

    if (window.electronAPI) {
      cleanup = window.electronAPI.onDeviceLost(() => {
        setError('Microphone disconnected. Reconnect it before arming a track.')
      })
    }

    return () => {
      active = false
      cleanup?.()
      getAudioEngine().dispose()
    }
  }, [])

  const handleTrackStateChange = useCallback((trackId: TrackId, state: TrackState) => {
    setTrackStates((current) => ({ ...current, [trackId]: state }))
  }, [])

  const handleAddTrack = useCallback(() => {
    setTrackIds((current) => [...current, (current.at(-1) ?? -1) + 1])
  }, [])

  const handleRemoveTrack = useCallback((trackId: TrackId) => {
    getAudioEngine().removeTrack(trackId)
    setTrackIds((current) => current.filter((id) => id !== trackId))
    setTrackStates((current) => {
      const next = { ...current }
      delete next[trackId]
      return next
    })
  }, [])

  const handleExport = useCallback(async () => {
    setExportState('exporting')
    setError(null)

    try {
      const mp3 = await getAudioEngine().exportMp3()
      const result = await window.electronAPI.saveMp3(mp3, getExportFileName())
      if (!result.saved) {
        setExportState('idle')
        return
      }

      setExportState('complete')
      window.setTimeout(() => setExportState('idle'), 1800)
    } catch (err) {
      setExportState('idle')
      setError(err instanceof Error ? err.message : 'Could not export the MP3 file.')
    }
  }, [])

  const gridLocked = trackIds.some(
    (trackId) => (trackStates[trackId] ?? TrackState.IDLE) !== TrackState.IDLE
  )
  const nextTrackId = (trackIds.at(-1) ?? -1) + 1
  const canExport = trackIds.some(
    (trackId) =>
      trackStates[trackId] === TrackState.PLAYING ||
      trackStates[trackId] === TrackState.PAUSED
  )
  const exportBlocked = trackIds.some(
    (trackId) =>
      trackStates[trackId] === TrackState.STANDBY ||
      trackStates[trackId] === TrackState.RECORDING
  )

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <img className={styles.brandLogo} src={logoUrl} alt="Looper" />
        </div>
        <div className={styles.headerTools}>
          <InputSelector ready={ready} />
          <button
            className={`${styles.exportButton} ${exportState === 'exporting' ? styles.exporting : ''} ${exportState === 'complete' ? styles.complete : ''}`}
            type="button"
            onClick={handleExport}
            disabled={!ready || !canExport || exportBlocked || exportState === 'exporting'}
            title={canExport ? 'Export recorded tracks as MP3' : 'Record a complete track to export'}
          >
            {exportState === 'exporting'
              ? 'ENCODING…'
              : exportState === 'complete'
                ? 'EXPORTED'
                : 'EXPORT MP3'}
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.masterSection}>
          <ClockControls locked={gridLocked} onError={setError} />
          <CycleProgress />
        </section>

        {error && (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)}>DISMISS</button>
          </div>
        )}

        <section className={styles.trackSection}>
          <div className={styles.sectionTitle}>
            <span>TRACK BANK</span>
            <span>{trackIds.length} × MONO / 48 KHZ</span>
          </div>
          <div className={styles.tracks}>
            {trackIds.map((trackId) => (
              <LoopTrack
                key={trackId}
                trackId={trackId}
                label={getTrackLabel(trackId)}
                disabled={!ready}
                onError={setError}
                onTrackStateChange={handleTrackStateChange}
                onRemove={handleRemoveTrack}
              />
            ))}
            <AddTrackCard
              nextTrackId={nextTrackId}
              disabled={!ready}
              onAdd={handleAddTrack}
            />
          </div>
        </section>
      </main>

      <footer className={styles.appFooter}>
        <span>ENGINE / WEB AUDIO</span>
        <span>4/4 · FRAME-ACCURATE SCHEDULING</span>
      </footer>
    </div>
  )
}
