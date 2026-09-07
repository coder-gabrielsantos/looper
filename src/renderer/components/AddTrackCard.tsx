import styles from './AddTrackCard.module.css'

interface AddTrackCardProps {
  nextTrackId: number
  disabled?: boolean
  onAdd: () => void
}

export default function AddTrackCard({ nextTrackId, disabled = false, onAdd }: AddTrackCardProps) {
  return (
    <button
      className={styles.addTrack}
      type="button"
      onClick={onAdd}
      disabled={disabled}
      aria-label={`Add track ${nextTrackId + 1}`}
    >
      <span className={styles.number}>{String(nextTrackId + 1).padStart(2, '0')}</span>
      <span className={styles.plus} aria-hidden="true" />
      <span className={styles.label}>ADD TRACK</span>
      <span className={styles.hint}>EXPAND TRACK BANK</span>
    </button>
  )
}
