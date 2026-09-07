import { useCallback, useEffect, useMemo, useState } from 'react'
import Select, { SingleValue } from 'react-select'
import { getAudioEngine } from '../audio/audioEngine'
import { VstPluginInfo } from '../audio/types'
import styles from './PluginSelector.module.css'

interface PluginSelectorProps {
  disabled?: boolean
  onError?: (message: string) => void
}

interface PluginOption {
  value: string
  label: string
}

function DropdownIndicator() {
  return <span className={styles.chevron} aria-hidden="true" />
}

export default function PluginSelector({ disabled = false, onError }: PluginSelectorProps) {
  const [plugins, setPlugins] = useState<VstPluginInfo[]>([])
  const [selected, setSelected] = useState('')
  const [hasEditor, setHasEditor] = useState(false)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [openingEditor, setOpeningEditor] = useState(false)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let active = true

    async function checkAvailability() {
      if (!window.electronAPI?.vst) return

      try {
        const isAvailable = await window.electronAPI.vst.isAvailable()
        if (!active) return
        setAvailable(isAvailable)
        if (isAvailable) {
          const scannedPlugins = await window.electronAPI.vst.scanPlugins()
          if (active) setPlugins(scannedPlugins)
        }
      } catch (error) {
        if (!active) return
        setAvailable(false)
        console.error('Failed to initialize VST2 support:', error)
      }
    }

    void checkAvailability()
    return () => {
      active = false
    }
  }, [])

  const options = useMemo<PluginOption[]>(
    () => [
      { value: '', label: 'NONE' },
      ...plugins.map((plugin) => ({
        value: plugin.path,
        label: plugin.name
      }))
    ],
    [plugins]
  )

  const selectedOption = options.find((option) => option.value === selected) ?? options[0]

  const openEditor = useCallback(async () => {
    setOpeningEditor(true)
    try {
      const result = await getAudioEngine().openMasterPluginEditor()
      if (!result.hasEditor) {
        setHasEditor(false)
        onError?.('This VST2 plugin does not provide a native interface.')
      } else if (!result.opened) {
        onError?.('The VST2 interface could not be opened.')
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Failed to open the VST2 interface.')
    } finally {
      setOpeningEditor(false)
    }
  }, [onError])

  const handleChange = useCallback(
    async (option: SingleValue<PluginOption>) => {
      if (!option || option.value === selected) return

      const previousSelected = selected
      setSwitching(true)
      try {
        const loaded = await getAudioEngine().setMasterPlugin(option.value || null)
        setSelected(option.value)
        setHasEditor(loaded?.hasEditor ?? false)
      } catch (error) {
        setSelected(previousSelected)
        onError?.(error instanceof Error ? error.message : 'Failed to load the VST2 plugin.')
      } finally {
        setSwitching(false)
      }
    },
    [onError, selected]
  )

  const handleRescan = useCallback(async () => {
    if (!window.electronAPI?.vst) return

    setLoading(true)
    try {
      setPlugins(await window.electronAPI.vst.scanPlugins())
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Failed to scan VST2 directories.')
    } finally {
      setLoading(false)
    }
  }, [onError])

  const controlsDisabled = disabled || switching || loading

  return (
    <section className={styles.panel} aria-label="Master VST2 effect">
      <div className={styles.heading}>
        <span className={styles.eyebrow}>FX</span>
      </div>

      {!available ? (
        <span className={styles.unavailable}>VST2 HOST NOT AVAILABLE</span>
      ) : (
        <>
          <Select<PluginOption, false>
            inputId="master-plugin-select"
            className={styles.selectRoot}
            classNamePrefix="pluginSelect"
            options={options}
            value={selectedOption}
            onChange={handleChange}
            isDisabled={controlsDisabled}
            isLoading={switching}
            isSearchable={false}
            components={{ DropdownIndicator, IndicatorSeparator: null }}
            placeholder="NO PLUGINS FOUND"
            noOptionsMessage={() => 'NO PLUGINS FOUND'}
            aria-label="Master VST2 plugin selector"
          />
          <button
            className={styles.editorButton}
            type="button"
            onClick={openEditor}
            disabled={controlsDisabled || !selected || !hasEditor || openingEditor}
            title={hasEditor ? 'Open the native plugin interface' : 'This plugin has no interface'}
          >
            {openingEditor ? 'OPENING...' : 'INTERFACE'}
          </button>
          <button
            className={styles.scanButton}
            type="button"
            onClick={handleRescan}
            disabled={controlsDisabled}
            title="Rescan VST2 directories"
            aria-label="Rescan VST2 directories"
          >
            {loading ? '...' : 'SCAN'}
          </button>
        </>
      )}
    </section>
  )
}
