import { useState, useEffect } from 'react'
import { getAudioEngine, InputDevice } from '../audio/audioEngine'
import styles from './InputSelector.module.css'

interface InputSelectorProps {
  ready: boolean
}

export default function InputSelector({ ready }: InputSelectorProps) {
  const [devices, setDevices] = useState<InputDevice[]>([])
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    if (!ready) return

    async function loadDevices() {
      try {
        const engine = getAudioEngine()
        const list = await engine.getInputDevices()
        setDevices(list)
        const current = engine.getCurrentDeviceId()
        if (current) {
          setSelected(current)
        } else if (list.length > 0) {
          setSelected(list[0].deviceId)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to list devices')
      }
    }
    loadDevices()

    const handler = () => loadDevices()
    navigator.mediaDevices.addEventListener('devicechange', handler)
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler)
  }, [ready])

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = e.target.value
    const previousDeviceId = selected
    setSelected(deviceId)
    setError(null)
    setSwitching(true)
    try {
      await getAudioEngine().setInputDevice(deviceId)
    } catch (err) {
      setSelected(previousDeviceId)
      setError(err instanceof Error ? err.message : 'Failed to switch device')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className={styles.container}>
      <label className={styles.label} htmlFor="input-select">INPUT</label>
      <select
        id="input-select"
        className={styles.select}
        value={selected}
        onChange={handleChange}
        disabled={!ready || switching || devices.length === 0}
      >
        {devices.length === 0 && <option>No input devices</option>}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        ))}
      </select>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}
