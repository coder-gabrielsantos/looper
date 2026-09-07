import { useState, useEffect } from 'react'
import Select, { SingleValue } from 'react-select'
import { getAudioEngine, InputDevice } from '../audio/audioEngine'
import styles from './InputSelector.module.css'

interface InputSelectorProps {
  ready: boolean
}

interface InputOption {
  value: string
  label: string
}

function DropdownIndicator() {
  return <span className={styles.chevron} aria-hidden="true" />
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

  const options: InputOption[] = devices.map((device) => ({
    value: device.deviceId,
    label: device.label
  }))
  const selectedOption = options.find((option) => option.value === selected) ?? null

  const handleChange = async (option: SingleValue<InputOption>) => {
    if (!option) return

    const deviceId = option.value
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
      <Select<InputOption, false>
        inputId="input-select"
        className={styles.selectRoot}
        classNamePrefix="inputSelect"
        options={options}
        value={selectedOption}
        onChange={handleChange}
        isDisabled={!ready || switching || devices.length === 0}
        isLoading={switching}
        isSearchable={false}
        components={{ DropdownIndicator, IndicatorSeparator: null }}
        placeholder={ready ? 'NO INPUT DEVICES' : 'INITIALIZING AUDIO'}
        noOptionsMessage={() => 'NO INPUT DEVICES'}
        aria-label="Audio input device"
      />
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}
