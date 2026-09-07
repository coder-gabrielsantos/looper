import { join } from 'path'
import { existsSync } from 'fs'

// eslint-disable-next-line @typescript-eslint/no-var-requires
let vstHost: any = null

try {
  // Try to load the native addon - it will be built by node-gyp/electron-rebuild
  const addonPath = join(__dirname, '../../build/Release/vst-host.node')
  if (existsSync(addonPath)) {
    vstHost = require(addonPath)
  } else {
    // Fallback for development - try common build locations
    const devPaths = [
      join(__dirname, '../../../build/Release/vst-host.node'),
      join(process.cwd(), 'build/Release/vst-host.node')
    ]
    for (const p of devPaths) {
      if (existsSync(p)) {
        vstHost = require(p)
        break
      }
    }
  }
} catch (err) {
  console.warn('VST host addon not available:', err instanceof Error ? err.message : String(err))
}

export interface PluginInfo {
  name: string
  path: string
  format: 'VST2' | 'VST3'
  vendor: string
}

export interface LoadedPlugin {
  handle: number
  numInputs: number
  numOutputs: number
  numParams: number
  initialDelay: number
  hasEditor: boolean
  name: string
}

export interface PluginEditorResult {
  opened: boolean
  hasEditor: boolean
  width: number
  height: number
}

const DEFAULT_VST_PATHS = [
  'C:\\Program Files\\Common Files\\VST2',
  'C:\\Program Files\\Common Files\\VST3',
  'C:\\Program Files\\VstPlugins',
  'C:\\Program Files (x86)\\Common Files\\VST2',
  'C:\\Program Files (x86)\\VstPlugins',
  join(process.env.LOCALAPPDATA || '', 'Programs', 'VST'),
  join(process.env.APPDATA || '', 'VST')
]

class PluginManager {
  private scannedPlugins: PluginInfo[] = []
  private loadedPlugins = new Map<number, { info: PluginInfo; loaded: LoadedPlugin }>()

  isAvailable(): boolean {
    return vstHost !== null
  }

  async scanPlugins(customPaths?: string[]): Promise<PluginInfo[]> {
    if (!vstHost) {
      console.warn('VST host not available - returning empty plugin list')
      return []
    }

    const paths = customPaths ?? DEFAULT_VST_PATHS.filter((p) => p && existsSync(p))

    try {
      this.scannedPlugins = vstHost.scanPlugins(paths) as PluginInfo[]
      return this.scannedPlugins
    } catch (err) {
      console.error('Failed to scan plugins:', err)
      return []
    }
  }

  getScannedPlugins(): PluginInfo[] {
    return this.scannedPlugins
  }

  async loadPlugin(
    pluginPath: string,
    sampleRate: number,
    blockSize: number
  ): Promise<LoadedPlugin> {
    if (!vstHost) throw new Error('VST host not available')

    const result = vstHost.loadPlugin(pluginPath, sampleRate, blockSize) as LoadedPlugin
    const info = this.scannedPlugins.find((p) => p.path === pluginPath) ?? {
      name: pluginPath.split('\\').pop() ?? pluginPath,
      path: pluginPath,
      format: pluginPath.endsWith('.vst3') ? 'VST3' : 'VST2',
      vendor: ''
    }

    this.loadedPlugins.set(result.handle, { info, loaded: result })
    return result
  }

  unloadPlugin(handle: number): void {
    if (!vstHost) return

    try {
      vstHost.unloadPlugin(handle)
    } catch (err) {
      console.error(`Failed to unload plugin ${handle}:`, err)
    }

    this.loadedPlugins.delete(handle)
  }

  processAudio(handle: number, input: Float32Array, output: Float32Array): void {
    if (!vstHost) return

    try {
      vstHost.processAudio(handle, input, output)
    } catch (err) {
      console.error(`Plugin processing error (${handle}):`, err)
      // Copy input to output as fallback
      output.set(input.subarray(0, Math.min(input.length, output.length)))
    }
  }

  getParameterCount(handle: number): number {
    if (!vstHost) return 0
    return vstHost.getParameterCount(handle) as number
  }

  setParameter(handle: number, index: number, value: number): void {
    if (!vstHost) return
    vstHost.setParameter(handle, index, value)
  }

  getParameter(handle: number, index: number): number {
    if (!vstHost) return 0
    return vstHost.getParameter(handle, index) as number
  }

  setTempo(handle: number, bpm: number): void {
    if (!vstHost || !this.loadedPlugins.has(handle)) return
    vstHost.setTempo(handle, bpm)
  }

  openEditor(handle: number, ownerWindowHandle: Buffer): PluginEditorResult {
    if (!vstHost) throw new Error('VST host not available')
    if (!this.loadedPlugins.has(handle)) throw new Error('VST plugin is not loaded')
    return vstHost.openEditor(handle, ownerWindowHandle) as PluginEditorResult
  }

  closeEditor(handle: number): void {
    if (!vstHost || !this.loadedPlugins.has(handle)) return
    vstHost.closeEditor(handle)
  }

  dispose(): void {
    for (const handle of this.loadedPlugins.keys()) {
      this.unloadPlugin(handle)
    }
    this.loadedPlugins.clear()
  }
}

let instance: PluginManager | null = null

export function getPluginManager(): PluginManager {
  if (!instance) instance = new PluginManager()
  return instance
}
