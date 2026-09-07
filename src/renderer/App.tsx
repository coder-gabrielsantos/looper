import { useCallback, useEffect, useState } from 'react'
import { getAudioEngine } from './audio/audioEngine'
import { TrackId, TrackState } from './audio/types'
import styles from './App.module.css'
import ClockControls from './components/ClockControls'
import CycleProgress from './components/CycleProgress'
import InputSelector from './components/InputSelector'
import LoopTrack from './components/LoopTrack'

const INITIAL_TRACK_STATES: Record<TrackId, TrackState> = {
  0: TrackState.IDLE,
  1: TrackState.IDLE,
  2: TrackState.IDLE
}

export default function App() {
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [trackStates, setTrackStates] = useState(INITIAL_TRACK_STATES)

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

  const gridLocked = Object.values(trackStates).some((state) => state !== TrackState.IDLE)

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <div>
            <h1>LOOP / GRID</h1>
            <span>QUANTIZED PERFORMANCE SYSTEM</span>
          </div>
        </div>
        <div className={styles.headerTools}>
          <InputSelector ready={ready} />
          <span className={`${styles.systemState} ${ready ? styles.ready : ''}`}>
            {ready ? 'AUDIO READY' : error ? 'AUDIO ERROR' : 'INITIALIZING'}
          </span>
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
            <span>3 × MONO / 48 KHZ</span>
          </div>
          <div className={styles.tracks}>
            <LoopTrack
              trackId={0}
              label="Track A"
              disabled={!ready}
              onError={setError}
              onTrackStateChange={handleTrackStateChange}
            />
            <LoopTrack
              trackId={1}
              label="Track B"
              disabled={!ready}
              onError={setError}
              onTrackStateChange={handleTrackStateChange}
            />
            <LoopTrack
              trackId={2}
              label="Track C"
              disabled={!ready}
              onError={setError}
              onTrackStateChange={handleTrackStateChange}
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
