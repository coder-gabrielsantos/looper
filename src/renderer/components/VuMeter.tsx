import { useEffect, useRef } from 'react'
import styles from './VuMeter.module.css'

interface VuMeterProps {
  level: number
}

export default function VuMeter({ level }: VuMeterProps) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (barRef.current) {
      const clamped = Math.min(1, Math.max(0, level * 3))
      barRef.current.style.width = `${clamped * 100}%`
    }
  }, [level])

  return (
    <div className={styles.container}>
      <div ref={barRef} className={styles.bar} />
    </div>
  )
}