import { ClockEngine, CycleEndEvent, getClockEngine } from './ClockEngine'
import { encodeMp3 } from './mp3Encoder'
import { TrackId, TrackState, VstEditorResult, VstLoadedPlugin } from './types'

const MASTER_PLUGIN_BLOCK_SIZE = 2048

interface TrackEngine {
  state: TrackState
  paused: boolean
  volume: number
  level: number
  gainNode: GainNode
  loopNode: AudioWorkletNode | null
  retiringLoopNode: AudioWorkletNode | null
  pendingStartTime: number | null
  recordingEndTime: number | null
  capturingTail: boolean
  onLevelChange: ((level: number) => void) | null
  onStateChange: ((state: TrackState) => void) | null
}

interface PendingExport {
  trackId: TrackId
  resolve: (samples: Float32Array) => void
  reject: (error: Error) => void
  timeoutId: number
}

export interface InputDevice {
  deviceId: string
  label: string
}

export class AudioEngine {
  private context: AudioContext | null = null
  private micStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private currentDeviceId: string | null = null
  private masterInputNode: GainNode | null = null
  private masterPluginNode: AudioWorkletNode | null = null
  private masterPluginHandle: number | null = null
  private masterPluginPath: string | null = null
  private tracks: Map<TrackId, TrackEngine> = new Map()
  private levelCallbacks: Map<TrackId, (level: number) => void> = new Map()
  private stateCallbacks: Map<TrackId, (state: TrackState) => void> = new Map()
  private initialized = false
  private initializationPromise: Promise<void> | null = null
  private lifecycleId = 0
  private clock: ClockEngine = getClockEngine()
  private clockUnsubscribe: (() => void) | null = null
  private clockStateUnsubscribe: (() => void) | null = null
  private nextExportRequestId = 1
  private pendingExports = new Map<number, PendingExport>()
  private exportPromise: Promise<Uint8Array> | null = null

  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initializationPromise) return this.initializationPromise

    const lifecycleId = this.lifecycleId
    const initializationPromise = this.initialize(lifecycleId)
    this.initializationPromise = initializationPromise
    try {
      await initializationPromise
    } finally {
      if (this.initializationPromise === initializationPromise) {
        this.initializationPromise = null
      }
    }
  }

  async setMasterPlugin(pluginPath: string | null): Promise<VstLoadedPlugin | null> {
    if (!this.context || !this.masterInputNode || !this.initialized) {
      throw new Error('Audio engine is not ready.')
    }
    const vst = window.electronAPI?.vst
    if (!vst) throw new Error('VST2 support is not available.')

    if (pluginPath === null) {
      await this.removeMasterPlugin()
      return null
    }

    const loaded = await vst.loadPlugin(
      pluginPath,
      this.context.sampleRate,
      MASTER_PLUGIN_BLOCK_SIZE
    )
    await vst.setTempo(loaded.handle, this.clock.getState().bpm).catch(() => undefined)

    const pluginNode = new AudioWorkletNode(this.context, 'plugin-insert-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { chunkSize: MASTER_PLUGIN_BLOCK_SIZE }
    })

    pluginNode.port.onmessage = async (event: MessageEvent) => {
      if (event.data.type !== 'process-audio') return

      const input = event.data.input as Float32Array
      let output: Float32Array
      try {
        output = await vst.processAudio(loaded.handle, input)
      } catch {
        output = input
      }

      if (this.masterPluginNode !== pluginNode) return
      pluginNode.port.postMessage(
        { type: 'audio-response', requestId: event.data.requestId, output },
        [output.buffer]
      )
    }

    pluginNode.port.postMessage({ type: 'set-active', active: true })

    // Every track reaches this node after its individual gain, so the VST is a master insert.
    const previousNode = this.masterPluginNode
    const previousHandle = this.masterPluginHandle
    const previousPath = this.masterPluginPath

    try {
      this.masterInputNode.disconnect()
      this.masterInputNode.connect(pluginNode)
      pluginNode.connect(this.context.destination)

      this.masterPluginNode = pluginNode
      this.masterPluginHandle = loaded.handle
      this.masterPluginPath = pluginPath

      if (previousNode) {
        previousNode.port.onmessage = null
        previousNode.disconnect()
      }
      if (previousHandle !== null) {
        await vst.unloadPlugin(previousHandle).catch(() => undefined)
      }
      return loaded
    } catch (error) {
      this.masterPluginNode = previousNode
      this.masterPluginHandle = previousHandle
      this.masterPluginPath = previousPath
      pluginNode.port.postMessage({ type: 'set-active', active: false })
      pluginNode.disconnect()
      this.masterInputNode.disconnect()
      this.masterInputNode.connect(previousNode ?? this.context.destination)
      await vst.unloadPlugin(loaded.handle).catch(() => undefined)
      throw error
    }
  }

  async openMasterPluginEditor(): Promise<VstEditorResult> {
    if (this.masterPluginHandle === null || !window.electronAPI?.vst) {
      return { opened: false, hasEditor: false, width: 0, height: 0 }
    }
    return window.electronAPI.vst.openEditor(this.masterPluginHandle)
  }

  private async removeMasterPlugin(): Promise<void> {
    const vst = window.electronAPI?.vst
    const previousNode = this.masterPluginNode
    const previousHandle = this.masterPluginHandle

    this.masterPluginNode = null
    this.masterPluginHandle = null
    this.masterPluginPath = null

    if (previousNode) {
      previousNode.port.postMessage({ type: 'set-active', active: false })
      previousNode.port.onmessage = null
      previousNode.disconnect()
    }
    if (this.masterInputNode && this.context) {
      this.masterInputNode.disconnect()
      this.masterInputNode.connect(this.context.destination)
    }
    if (previousHandle !== null && vst) await vst.unloadPlugin(previousHandle)
  }

  private async initialize(lifecycleId: number): Promise<void> {
    const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    let micStream: MediaStream | null = null

    try {
      const recorderUrl = new URL('./worklets/recorder-processor.js', import.meta.url).href
      const pluginUrl = new URL('./worklets/plugin-insert-processor.js', import.meta.url).href
      await Promise.all([
        context.audioWorklet.addModule(recorderUrl),
        context.audioWorklet.addModule(pluginUrl)
      ])
      this.ensureCurrentLifecycle(lifecycleId)

      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      this.ensureCurrentLifecycle(lifecycleId)

      const micSource = context.createMediaStreamSource(micStream)
      const masterInputNode = context.createGain()
      masterInputNode.gain.value = 1
      masterInputNode.connect(context.destination)
      const tracks = new Map<TrackId, TrackEngine>()
      const initialTrackIds = new Set<TrackId>([
        0,
        1,
        ...this.levelCallbacks.keys(),
        ...this.stateCallbacks.keys()
      ])

      for (const id of initialTrackIds) {
        tracks.set(id, this.createTrack(context, id, masterInputNode))
      }

      this.context = context
      this.micStream = micStream
      this.micSource = micSource
      this.masterInputNode = masterInputNode
      this.currentDeviceId = micStream.getAudioTracks()[0]?.getSettings().deviceId ?? null
      this.tracks = tracks
      this.clock.init(context)
      this.clockUnsubscribe?.()
      this.clockUnsubscribe = this.clock.on('cycle-end', (event) => this.handleCycleEnd(event))
      this.clockStateUnsubscribe?.()
      this.clockStateUnsubscribe = this.clock.on('state', ({ bpm }) => {
        if (this.masterPluginHandle !== null && window.electronAPI?.vst) {
          void window.electronAPI.vst.setTempo(this.masterPluginHandle, bpm).catch(() => undefined)
        }
      })
      this.initialized = true
    } catch (err) {
      micStream?.getTracks().forEach((track) => track.stop())
      void context.close().catch(() => undefined)

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }

      console.error('Failed to initialize audio engine:', err)
      throw new Error('Audio initialization failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  private ensureCurrentLifecycle(lifecycleId: number): void {
    if (lifecycleId !== this.lifecycleId) {
      throw new DOMException('Audio initialization was cancelled.', 'AbortError')
    }
  }

  private createTrack(
    context: AudioContext,
    trackId: TrackId,
    masterInputNode: AudioNode
  ): TrackEngine {
    const gainNode = context.createGain()
    gainNode.gain.value = 0.8
    gainNode.connect(masterInputNode)

    return {
      state: TrackState.IDLE,
      paused: false,
      volume: 0.8,
      level: 0,
      gainNode,
      loopNode: null,
      retiringLoopNode: null,
      pendingStartTime: null,
      recordingEndTime: null,
      capturingTail: false,
      onLevelChange: this.levelCallbacks.get(trackId) ?? null,
      onStateChange: this.stateCallbacks.get(trackId) ?? null
    }
  }

  private ensureTrack(trackId: TrackId): TrackEngine | null {
    const current = this.tracks.get(trackId)
    if (current) return current
    if (!this.context || !this.initialized) return null

    if (!this.masterInputNode) return null
    const track = this.createTrack(this.context, trackId, this.masterInputNode)
    this.tracks.set(trackId, track)
    return track
  }

  private handleCycleEnd(event: CycleEndEvent): void {
    const tolerance = 1 / (this.context?.sampleRate ?? 48000)
    for (const [trackId, track] of this.tracks) {
      if (
        track.state === TrackState.STANDBY &&
        track.pendingStartTime !== null &&
        Math.abs(track.pendingStartTime - event.time) <= tolerance
      ) {
        this.scheduleRecording(trackId, event.time)
      }
    }
  }

  setLevelCallback(trackId: TrackId, callback: ((level: number) => void) | null): void {
    if (callback) {
      this.levelCallbacks.set(trackId, callback)
    } else {
      this.levelCallbacks.delete(trackId)
    }
    const track = callback ? this.ensureTrack(trackId) : this.tracks.get(trackId)
    if (track) track.onLevelChange = callback
  }

  setStateCallback(trackId: TrackId, callback: ((state: TrackState) => void) | null): void {
    if (callback) {
      this.stateCallbacks.set(trackId, callback)
    } else {
      this.stateCallbacks.delete(trackId)
    }
    const track = callback ? this.ensureTrack(trackId) : this.tracks.get(trackId)
    if (track) {
      track.onStateChange = callback
      callback?.(track.state)
    }
  }

  async startRecording(trackId: TrackId): Promise<void> {
    const track = this.tracks.get(trackId)
    if (!track || !this.context || !this.micSource || !this.initialized) {
      throw new Error('Audio engine is not ready.')
    }
    if (track.state === TrackState.STANDBY || track.state === TrackState.RECORDING) return

    if (!this.clock.getState().running) {
      await this.clock.start()
    } else if (this.context.state === 'suspended') {
      await this.context.resume()
    }

    track.pendingStartTime = this.clock.getNextCycleTime()
    this.setTrackState(track, TrackState.STANDBY)
  }

  scheduleRecording(trackId: TrackId, nextDownbeatTime: number): void {
    const track = this.tracks.get(trackId)
    if (!track || !this.context || !this.micSource || track.state !== TrackState.STANDBY) return

    const sampleRate = this.context.sampleRate
    const startFrame = Math.ceil(nextDownbeatTime * sampleRate)
    const frameCount = Math.max(1, Math.round(this.clock.getCycleDuration() * sampleRate))
    const endFrame = startFrame + frameCount
    const endTime = endFrame / sampleRate
    const latencyFrames = this.getLatencyCompensationFrames(frameCount)
    const nextLoopNode = new AudioWorkletNode(this.context, 'recorder-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    })
    const previousLoopNode = track.loopNode

    nextLoopNode.port.onmessage = (event) => {
      if (event.data.type === 'export-buffer' || event.data.type === 'export-error') {
        const pending = this.pendingExports.get(event.data.requestId)
        if (!pending) return
        window.clearTimeout(pending.timeoutId)
        this.pendingExports.delete(event.data.requestId)

        if (event.data.type === 'export-error') {
          pending.reject(new Error('The track buffer is not ready for export.'))
        } else {
          pending.resolve(event.data.samples as Float32Array)
        }
        return
      }

      if (event.data.type === 'playback-stopped') {
        if (track.retiringLoopNode === nextLoopNode) {
          this.disconnectLoopNode(nextLoopNode)
          track.retiringLoopNode = null
        }
        return
      }
      if (track.loopNode !== nextLoopNode) return

      if (event.data.type === 'level') {
        track.level = event.data.value
        track.onLevelChange?.(event.data.value)
      } else if (event.data.type === 'recording-started') {
        this.setTrackState(track, TrackState.RECORDING)
      } else if (event.data.type === 'recording-complete') {
        track.recordingEndTime = null
        if (track.retiringLoopNode) {
          this.disconnectLoopNode(track.retiringLoopNode)
          track.retiringLoopNode = null
        }
        this.setTrackState(track, TrackState.PLAYING)
      } else if (event.data.type === 'capture-complete') {
        try {
          this.micSource?.disconnect(nextLoopNode)
        } catch {}
        track.capturingTail = false
      }
    }

    if (previousLoopNode) {
      track.retiringLoopNode = previousLoopNode
      previousLoopNode.port.postMessage({ command: 'stop-at', frame: endFrame })
    }

    this.micSource.connect(nextLoopNode)
    nextLoopNode.connect(track.gainNode)
    track.loopNode = nextLoopNode
    track.pendingStartTime = null
    track.recordingEndTime = endTime
    track.capturingTail = true
    if (track.paused) {
      track.gainNode.gain.cancelScheduledValues(this.context.currentTime)
      track.gainNode.gain.setValueAtTime(0, this.context.currentTime)
      track.gainNode.gain.setValueAtTime(track.volume, endTime)
      track.paused = false
    } else {
      track.gainNode.gain.setTargetAtTime(track.volume, this.context.currentTime, 0.01)
    }
    nextLoopNode.port.postMessage({ command: 'schedule', startFrame, endFrame, latencyFrames })
  }

  setVolume(trackId: TrackId, value: number): void {
    const track = this.tracks.get(trackId)
    if (!track || !this.context) return
    track.volume = Math.max(0, Math.min(1, value))
    track.gainNode.gain.setTargetAtTime(
      track.paused ? 0 : track.volume,
      this.context.currentTime,
      0.01
    )
  }

  toggleTrackPlayback(trackId: TrackId): void {
    const track = this.tracks.get(trackId)
    if (!track || !this.context) return

    if (track.state === TrackState.PLAYING) {
      track.paused = true
      track.gainNode.gain.setTargetAtTime(0, this.context.currentTime, 0.008)
      this.setTrackState(track, TrackState.PAUSED)
    } else if (track.state === TrackState.PAUSED) {
      track.paused = false
      track.gainNode.gain.setTargetAtTime(track.volume, this.context.currentTime, 0.008)
      this.setTrackState(track, TrackState.PLAYING)
    }
  }

  clearTrack(trackId: TrackId): void {
    const track = this.tracks.get(trackId)
    if (!track) return

    track.pendingStartTime = null
    track.recordingEndTime = null
    track.capturingTail = false
    track.paused = false
    this.stopTrackNodes(track)
    if (this.context) {
      track.gainNode.gain.setTargetAtTime(track.volume, this.context.currentTime, 0.008)
    }
    track.level = 0
    this.setTrackState(track, TrackState.IDLE)
    track.onLevelChange?.(0)
  }

  removeTrack(trackId: TrackId): void {
    const track = this.tracks.get(trackId)
    if (!track) return

    this.stopTrackNodes(track)
    track.gainNode.disconnect()
    this.tracks.delete(trackId)
    this.levelCallbacks.delete(trackId)
    this.stateCallbacks.delete(trackId)
    this.cancelPendingExports(trackId, 'The track was removed during export.')
  }

  async exportMp3(): Promise<Uint8Array> {
    if (this.exportPromise) return this.exportPromise

    const exportPromise = this.performExportMp3()
    this.exportPromise = exportPromise
    try {
      return await exportPromise
    } finally {
      if (this.exportPromise === exportPromise) this.exportPromise = null
    }
  }

  private async performExportMp3(): Promise<Uint8Array> {
    if (!this.context || !this.initialized) throw new Error('Audio engine is not ready.')

    if (
      [...this.tracks.values()].some(
        (track) =>
          track.state === TrackState.STANDBY ||
          track.state === TrackState.RECORDING ||
          track.capturingTail
      )
    ) {
      throw new Error('Wait for all recordings to finish before exporting.')
    }

    const exportableTracks = [...this.tracks.entries()].filter(
      ([, track]) =>
        (track.state === TrackState.PLAYING || track.state === TrackState.PAUSED) &&
        track.loopNode !== null
    )
    if (exportableTracks.length === 0) {
      throw new Error('Record at least one complete track before exporting.')
    }

    // Read and mix one track at a time so long sessions do not keep every
    // full-sized recording duplicated in the renderer during export.
    let mix: Float32Array | null = null
    for (const [trackId, track] of exportableTracks) {
      const samples = await this.requestTrackSamples(trackId, track)
      if (samples.length === 0) continue

      if (!mix) {
        mix = new Float32Array(samples.length)
      } else if (samples.length > mix.length) {
        const expandedMix = new Float32Array(samples.length)
        expandedMix.set(mix)
        mix = expandedMix
      }

      for (let frame = 0; frame < mix.length; frame += 1) {
        mix[frame] += samples[frame % samples.length] * track.volume
      }
    }

    if (!mix || mix.length === 0) throw new Error('The recorded tracks are empty.')

    const processedMix = await this.renderMasterPluginForExport(mix)

    let peak = 0
    for (const sample of processedMix) peak = Math.max(peak, Math.abs(sample))
    if (peak > 0.98) {
      const gain = 0.98 / peak
      for (let frame = 0; frame < processedMix.length; frame += 1) {
        processedMix[frame] *= gain
      }
    }

    return encodeMp3(processedMix, this.context.sampleRate)
  }

  private async renderMasterPluginForExport(input: Float32Array): Promise<Float32Array> {
    const vst = window.electronAPI?.vst
    const pluginPath = this.masterPluginPath
    const liveHandle = this.masterPluginHandle
    if (!vst || !pluginPath || liveHandle === null || input.length === 0 || !this.context) {
      return input
    }

    const renderPlugin = await vst.loadPlugin(
      pluginPath,
      this.context.sampleRate,
      MASTER_PLUGIN_BLOCK_SIZE
    )

    try {
      await vst.setTempo(renderPlugin.handle, this.clock.getState().bpm)
      const parameters = await vst.getParameters(liveHandle)
      await Promise.all(
        parameters.map(({ index, value }) => vst.setParameter(renderPlugin.handle, index, value))
      )

      // Warm time-based effects in the first pass, then retain only the second
      // pass. Processing in chunks avoids two extra full-cycle buffers.
      const output = new Float32Array(input.length)
      for (let pass = 0; pass < 2; pass += 1) {
        for (let offset = 0; offset < input.length; offset += MASTER_PLUGIN_BLOCK_SIZE) {
          const remaining = input.length - offset
          const frameCount = Math.min(MASTER_PLUGIN_BLOCK_SIZE, remaining)
          const chunk = new Float32Array(MASTER_PLUGIN_BLOCK_SIZE)
          chunk.set(input.subarray(offset, offset + frameCount))
          const processed = await vst.processAudio(renderPlugin.handle, chunk)

          if (pass === 1) {
            output.set(processed.subarray(0, Math.min(processed.length, frameCount)), offset)
          }
        }
      }

      return output
    } finally {
      await vst.unloadPlugin(renderPlugin.handle).catch(() => undefined)
    }
  }

  getTrackState(trackId: TrackId): TrackState {
    return this.tracks.get(trackId)?.state ?? TrackState.IDLE
  }

  hasActiveTracks(): boolean {
    return [...this.tracks.values()].some((track) => track.state !== TrackState.IDLE)
  }

  getLatencyCompensationMs(): number {
    return Math.round(this.getLatencyCompensationSeconds() * 1000)
  }

  private getLatencyCompensationFrames(maxFrames: number): number {
    if (!this.context) return 0
    return Math.min(maxFrames - 1, Math.round(this.getLatencyCompensationSeconds() * this.context.sampleRate))
  }

  private getLatencyCompensationSeconds(): number {
    if (!this.context) return 0
    const inputSettings = this.micStream?.getAudioTracks()[0]?.getSettings() as
      | (MediaTrackSettings & { latency?: number })
      | undefined
    const inputLatency = this.toPositiveLatency(
      inputSettings?.latency
    )
    const processingLatency = this.toPositiveLatency(this.context.baseLatency)
    const outputLatency = this.toPositiveLatency(this.context.outputLatency)
    return Math.min(0.2, inputLatency + processingLatency + outputLatency)
  }

  private toPositiveLatency(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
  }

  private stopTrackNodes(track: TrackEngine): void {
    for (const node of [track.loopNode, track.retiringLoopNode]) {
      if (!node) continue
      node.port.postMessage({ command: 'cancel' })
      try {
        this.micSource?.disconnect(node)
      } catch {}
      this.disconnectLoopNode(node)
    }
    track.loopNode = null
    track.retiringLoopNode = null
  }

  private disconnectLoopNode(node: AudioWorkletNode): void {
    node.port.onmessage = null
    node.disconnect()
  }

  private requestTrackSamples(trackId: TrackId, track: TrackEngine): Promise<Float32Array> {
    const node = track.loopNode
    if (!node) return Promise.reject(new Error('The track has no recorded loop.'))

    const requestId = this.nextExportRequestId
    this.nextExportRequestId += 1

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingExports.delete(requestId)
        reject(new Error('Timed out while reading a recorded track.'))
      }, 5000)

      this.pendingExports.set(requestId, { trackId, resolve, reject, timeoutId })
      node.port.postMessage({ command: 'export-buffer', requestId })
    })
  }

  private cancelPendingExports(trackId: TrackId, message: string): void {
    for (const [requestId, pending] of this.pendingExports) {
      if (pending.trackId !== trackId) continue
      window.clearTimeout(pending.timeoutId)
      pending.reject(new Error(message))
      this.pendingExports.delete(requestId)
    }
  }

  private setTrackState(track: TrackEngine, state: TrackState): void {
    track.state = state
    track.onStateChange?.(state)
  }

  async getInputDevices(): Promise<InputDevice[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`
      }))
  }

  async setInputDevice(deviceId: string): Promise<void> {
    if (!this.context || !this.initialized) {
      throw new Error('Audio engine is not ready.')
    }
    if (
      [...this.tracks.values()].some(
        (track) =>
          track.state === TrackState.STANDBY ||
          track.state === TrackState.RECORDING ||
          track.capturingTail
      )
    ) {
      throw new Error('Wait for recording to finish before changing the input device.')
    }

    const previousStream = this.micStream
    const previousSource = this.micSource
    let nextStream: MediaStream | null = null

    try {
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      const nextSource = this.context.createMediaStreamSource(nextStream)

      previousSource?.disconnect()
      previousStream?.getTracks().forEach((track) => track.stop())
      this.micStream = nextStream
      this.micSource = nextSource
      this.currentDeviceId = deviceId
    } catch (err) {
      nextStream?.getTracks().forEach((track) => track.stop())
      console.error('Failed to set input device:', err)
      throw new Error('Could not connect to selected microphone.')
    }
  }

  getCurrentDeviceId(): string | null {
    return this.currentDeviceId
  }

  dispose(): void {
    this.lifecycleId += 1
    this.initializationPromise = null
    this.clockUnsubscribe?.()
    this.clockUnsubscribe = null
    this.clockStateUnsubscribe?.()
    this.clockStateUnsubscribe = null

    for (const pending of this.pendingExports.values()) {
      window.clearTimeout(pending.timeoutId)
      pending.reject(new Error('Audio engine was disposed during export.'))
    }
    this.pendingExports.clear()

    for (const [, track] of this.tracks) {
      this.stopTrackNodes(track)
      track.gainNode.disconnect()
    }
    this.masterPluginNode?.port.postMessage({ type: 'set-active', active: false })
    if (this.masterPluginNode) this.masterPluginNode.port.onmessage = null
    this.masterPluginNode?.disconnect()
    this.masterInputNode?.disconnect()
    if (this.masterPluginHandle !== null && window.electronAPI?.vst) {
      void window.electronAPI.vst.unloadPlugin(this.masterPluginHandle).catch(() => undefined)
    }
    this.clock.dispose()
    this.micStream?.getTracks().forEach((track) => track.stop())
    void this.context?.close().catch(() => undefined)
    this.tracks.clear()
    this.context = null
    this.micStream = null
    this.micSource = null
    this.currentDeviceId = null
    this.masterInputNode = null
    this.masterPluginNode = null
    this.masterPluginHandle = null
    this.masterPluginPath = null
    this.initialized = false
  }
}

let instance: AudioEngine | null = null

export function getAudioEngine(): AudioEngine {
  if (!instance) instance = new AudioEngine()
  return instance
}
