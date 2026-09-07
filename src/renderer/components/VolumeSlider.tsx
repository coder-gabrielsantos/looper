import styles from './VolumeSlider.module.css'

interface VolumeSliderProps {
  value: number
  onChange: (value: number) => void
}

export default function VolumeSlider({ value, onChange }: VolumeSliderProps) {
  return (
    <div className={styles.container}>
      <span className={styles.label}>{Math.round(value * 100)}%</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={styles.slider}
      />
    </div>
  )
}