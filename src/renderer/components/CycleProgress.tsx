import { useEffect, useState } from 'react'
import { ClockSnapshot, getClockEngine } from '../audio/ClockEngine'
import styles from './CycleProgress.module.css'

export default function CycleProgress() {
  const clock = getClockEngine()
  const [snapshot, setSnapshot] = useState<ClockSnapshot>(clock.getSnapshot())

  useEffect(() => {
    let frameId = 0
    const update = () => {
      setSnapshot(clock.getSnapshot())
      frameId = requestAnimationFrame(update)
    }
    frameId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frameId)
  }, [clock])

  return (
    <section className={styles.timeline} aria-label="Global cycle position">
      <div className={styles.readout}>
        <span>GLOBAL PHASE</span>
        <span className={styles.position}>
          {snapshot.running
            ? `BAR ${String(snapshot.bar).padStart(2, '0')} / ${String(snapshot.barsPerCycle).padStart(2, '0')} · BEAT ${snapshot.beat}`
            : 'CLOCK IDLE'}
        </span>
      </div>
      <div className={styles.rail}>
        <div
          className={`${styles.fill} ${snapshot.running ? styles.active : ''}`}
          style={{ transform: `scaleX(${snapshot.progress})` }}
        />
        <div className={styles.markers} aria-hidden="true">
          {Array.from({ length: snapshot.barsPerCycle }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
      </div>
    </section>
  )
}
