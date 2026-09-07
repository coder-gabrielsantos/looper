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
      <span className={styles.label}>PHASE</span>
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
      <span className={styles.position}>
        {snapshot.running ? `${snapshot.bar}/${snapshot.barsPerCycle}` : ''}
      </span>
    </section>
  )
}
