import { useEffect, useState } from 'react'
import {
  CYCLE_OPTIONS,
  ClockState,
  CycleBars,
  getClockEngine
} from '../audio/ClockEngine'
import styles from './ClockControls.module.css'

interface ClockControlsProps {
  locked: boolean
  onError: (message: string | null) => void
}

export default function ClockControls({ locked, onError }: ClockControlsProps) {
  const clock = getClockEngine()
  const [state, setState] = useState<ClockState>(clock.getState())
  const [bpmInput, setBpmInput] = useState(String(clock.getState().bpm))

  useEffect(
    () =>
      clock.on('state', (nextState) => {
        setState(nextState)
        setBpmInput(String(nextState.bpm))
      }),
    [clock]
  )

  const setBpm = (value: number) => {
    if (locked || Number.isNaN(value)) return
    clock.setBpm(value)
    onError(null)
  }

  const setCycle = (bars: CycleBars) => {
    if (locked) return
    clock.setBarsPerCycle(bars)
    onError(null)
  }

  const updateBpmInput = (value: string) => {
    setBpmInput(value)
    const parsed = Number(value)
    if (value !== '' && parsed >= 40 && parsed <= 240) setBpm(parsed)
  }

  const commitBpmInput = () => {
    const parsed = Number(bpmInput)
    if (!Number.isFinite(parsed)) {
      setBpmInput(String(state.bpm))
      return
    }
    const nextBpm = Math.round(Math.min(240, Math.max(40, parsed)))
    setBpmInput(String(nextBpm))
    setBpm(nextBpm)
  }

  const toggleClock = async () => {
    if (locked && state.running) {
      onError('Clear all tracks before stopping or changing the master clock.')
      return
    }
    try {
      await clock.toggle()
      onError(null)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not start the master clock.')
    }
  }

  return (
    <section className={styles.panel} aria-label="Master clock controls">
      <div className={styles.transport}>
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow}>MASTER CLOCK</span>
          <span className={`${styles.clockState} ${state.running ? styles.active : ''}`}>
            {state.running ? 'RUNNING' : 'STOPPED'}
          </span>
        </div>
        <button
          className={`${styles.transportButton} ${state.running ? styles.active : ''}`}
          onClick={toggleClock}
          disabled={locked && state.running}
        >
          <span className={styles.transportMark} />
          {state.running ? 'STOP' : 'START'}
        </button>
        <button
          className={`${styles.clickButton} ${state.clickEnabled ? styles.active : ''}`}
          onClick={() => clock.setClickEnabled(!state.clickEnabled)}
          aria-pressed={state.clickEnabled}
        >
          CLICK {state.clickEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className={styles.tempo}>
        <div className={styles.sectionHeading}>
          <label className={styles.eyebrow} htmlFor="bpm-input">TEMPO</label>
          {locked && <span className={styles.locked}>GRID LOCKED</span>}
        </div>
        <div className={styles.bpmControl}>
          <button
            className={styles.bpmStep}
            type="button"
            onClick={() => setBpm(state.bpm - 1)}
            disabled={locked || state.bpm <= 40}
            aria-label="Decrease BPM"
          >
            <span className={styles.decreaseMark} aria-hidden="true" />
          </button>
          <div className={styles.bpmReadout}>
            <input
              id="bpm-input"
              type="number"
              min="40"
              max="240"
              value={bpmInput}
              onChange={(event) => updateBpmInput(event.target.value)}
              onBlur={commitBpmInput}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              disabled={locked}
            />
            <span>BPM</span>
          </div>
          <button
            className={styles.bpmStep}
            type="button"
            onClick={() => setBpm(state.bpm + 1)}
            disabled={locked || state.bpm >= 240}
            aria-label="Increase BPM"
          >
            <span className={styles.increaseMark} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.tempoRange}>
          <span>40</span>
          <input
            className={styles.tempoSlider}
            type="range"
            min="40"
            max="240"
            step="1"
            value={state.bpm}
            onChange={(event) => setBpm(Number(event.target.value))}
            disabled={locked}
            aria-label="Tempo in BPM"
          />
          <span>240</span>
        </div>
      </div>

      <div className={styles.cycle}>
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow}>CYCLE LENGTH</span>
          <span className={styles.unit}>BARS</span>
        </div>
        <div className={styles.cycleOptions}>
          {CYCLE_OPTIONS.map((bars) => (
            <button
              key={bars}
              className={state.barsPerCycle === bars ? styles.selected : ''}
              onClick={() => setCycle(bars)}
              disabled={locked}
              aria-pressed={state.barsPerCycle === bars}
            >
              {bars}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
