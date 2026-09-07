const MIN_BPM = 40
const MAX_BPM = 240
const BEATS_PER_BAR = 4
const LOOKAHEAD_SECONDS = 0.12
const SCHEDULER_INTERVAL_MS = 25
const START_LEAD_SECONDS = 0.2

export const CYCLE_OPTIONS = [1, 2, 4, 8, 16] as const
export type CycleBars = (typeof CYCLE_OPTIONS)[number]

export interface DownbeatEvent {
  time: number
  bar: number
  cycle: number
  isCycleStart: boolean
}

export interface CycleEndEvent {
  time: number
  cycle: number
}

export interface ClockState {
  running: boolean
  clickEnabled: boolean
  bpm: number
  barsPerCycle: CycleBars
}

export interface ClockSnapshot extends ClockState {
  progress: number
  bar: number
  beat: number
}

interface ClockEvents {
  downbeat: DownbeatEvent
  'cycle-end': CycleEndEvent
  state: ClockState
}

type ClockListener<K extends keyof ClockEvents> = (event: ClockEvents[K]) => void

export class ClockEngine {
  private context: AudioContext | null = null
  private running = false
  private clickEnabled = false
  private bpm = 120
  private barsPerCycle: CycleBars = 4
  private beatOriginTime = 0
  private cycleAnchorTime = 0
  private nextBeatIndex = 0
  private schedulerId: number | null = null
  private scheduledClicks = new Set<OscillatorNode>()
  private listeners = new Map<keyof ClockEvents, Set<(event: unknown) => void>>()

  init(context: AudioContext): void {
    if (this.context === context) return
    this.stopScheduler()
    this.context = context
    this.running = false
    this.emitState()
  }

  on<K extends keyof ClockEvents>(event: K, listener: ClockListener<K>): () => void {
    let eventListeners = this.listeners.get(event)
    if (!eventListeners) {
      eventListeners = new Set()
      this.listeners.set(event, eventListeners)
    }
    eventListeners.add(listener as (event: unknown) => void)
    return () => eventListeners?.delete(listener as (event: unknown) => void)
  }

  async start(): Promise<void> {
    if (!this.context) throw new Error('Clock is not connected to an AudioContext.')
    if (this.running) return

    if (this.context.state === 'suspended') {
      await this.context.resume()
    }

    this.running = true
    this.resetGrid(this.context.currentTime + START_LEAD_SECONDS)
    this.runScheduler()
    this.schedulerId = window.setInterval(() => this.runScheduler(), SCHEDULER_INTERVAL_MS)
    this.emitState()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.stopScheduler()
    this.emitState()
  }

  async toggle(): Promise<void> {
    if (this.running) {
      this.stop()
    } else {
      await this.start()
    }
  }

  setBpm(value: number): void {
    const nextBpm = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, value)))
    if (nextBpm === this.bpm) return
    this.bpm = nextBpm
    if (this.running && this.context) {
      this.stopScheduler()
      this.resetGrid(this.context.currentTime + START_LEAD_SECONDS)
      this.runScheduler()
      this.schedulerId = window.setInterval(() => this.runScheduler(), SCHEDULER_INTERVAL_MS)
    }
    this.emitState()
  }

  setBarsPerCycle(value: CycleBars): void {
    if (value === this.barsPerCycle) return
    this.barsPerCycle = value
    this.cycleAnchorTime = this.beatOriginTime
    this.emitState()
  }

  setClickEnabled(enabled: boolean): void {
    if (enabled === this.clickEnabled) return
    this.clickEnabled = enabled
    this.emitState()
  }

  getNextDownbeatTime(minLeadSeconds = LOOKAHEAD_SECONDS + 0.04): number {
    return this.getNextGridTime(this.beatOriginTime, this.getBarDuration(), minLeadSeconds)
  }

  getNextCycleTime(minLeadSeconds = LOOKAHEAD_SECONDS + 0.04): number {
    if (!this.context || !this.running) throw new Error('Start the clock before scheduling audio.')
    const cycleDuration = this.getCycleDuration()
    const earliest = this.context.currentTime + minLeadSeconds
    const firstCycleEnd = this.cycleAnchorTime + cycleDuration
    if (earliest <= firstCycleEnd) return firstCycleEnd
    const completedCycles = Math.ceil((earliest - this.cycleAnchorTime) / cycleDuration - 1e-9)
    return this.cycleAnchorTime + completedCycles * cycleDuration
  }

  getCycleDuration(): number {
    return this.getBarDuration() * this.barsPerCycle
  }

  getState(): ClockState {
    return {
      running: this.running,
      clickEnabled: this.clickEnabled,
      bpm: this.bpm,
      barsPerCycle: this.barsPerCycle
    }
  }

  getSnapshot(): ClockSnapshot {
    const state = this.getState()
    if (!this.context || !this.running || this.context.currentTime < this.cycleAnchorTime) {
      return { ...state, progress: 0, bar: 1, beat: 1 }
    }

    const cycleDuration = this.getCycleDuration()
    const elapsed = this.context.currentTime - this.cycleAnchorTime
    const position = ((elapsed % cycleDuration) + cycleDuration) % cycleDuration
    const progress = position / cycleDuration
    const beatPosition = position / this.getBeatDuration()

    return {
      ...state,
      progress,
      bar: Math.min(this.barsPerCycle, Math.floor(beatPosition / BEATS_PER_BAR) + 1),
      beat: Math.floor(beatPosition % BEATS_PER_BAR) + 1
    }
  }

  dispose(): void {
    this.running = false
    this.stopScheduler()
    this.context = null
    this.emitState()
  }

  private resetGrid(startTime: number): void {
    this.beatOriginTime = startTime
    this.cycleAnchorTime = startTime
    this.nextBeatIndex = 0
  }

  private runScheduler(): void {
    if (!this.context || !this.running) return

    const horizon = this.context.currentTime + LOOKAHEAD_SECONDS
    const beatDuration = this.getBeatDuration()

    while (this.beatOriginTime + this.nextBeatIndex * beatDuration <= horizon) {
      const beatTime = this.beatOriginTime + this.nextBeatIndex * beatDuration
      if (beatTime >= this.context.currentTime) {
        this.scheduleClick(beatTime, this.nextBeatIndex)
        this.emitGridEvents(beatTime, this.nextBeatIndex)
      }
      this.nextBeatIndex += 1
    }
  }

  private emitGridEvents(time: number, beatIndex: number): void {
    if (beatIndex % BEATS_PER_BAR !== 0) return

    const barIndex = Math.floor(beatIndex / BEATS_PER_BAR)
    const cycleDuration = this.getCycleDuration()
    const cyclePosition = (time - this.cycleAnchorTime) / cycleDuration
    const nearestCycle = Math.round(cyclePosition)
    const isCycleStart = Math.abs(cyclePosition - nearestCycle) < 0.0001
    const cycle = Math.max(0, nearestCycle)

    if (isCycleStart) {
      this.emit('cycle-end', { time, cycle })
    }
    this.emit('downbeat', {
      time,
      bar: barIndex,
      cycle,
      isCycleStart
    })
  }

  private scheduleClick(time: number, beatIndex: number): void {
    if (!this.context || !this.clickEnabled) return

    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    const beatInBar = beatIndex % BEATS_PER_BAR
    oscillator.frequency.value = beatInBar === 0 ? 1320 : 880
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(beatInBar === 0 ? 0.16 : 0.08, time + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.035)
    oscillator.connect(gain)
    gain.connect(this.context.destination)
    oscillator.start(time)
    oscillator.stop(time + 0.04)
    this.scheduledClicks.add(oscillator)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
      this.scheduledClicks.delete(oscillator)
    }
  }

  private getNextGridTime(origin: number, interval: number, minLeadSeconds: number): number {
    if (!this.context || !this.running) throw new Error('Start the clock before scheduling audio.')
    const earliest = this.context.currentTime + minLeadSeconds
    if (earliest <= origin) return origin
    const intervals = Math.ceil((earliest - origin) / interval - 1e-9)
    return origin + intervals * interval
  }

  private getBeatDuration(): number {
    return 60 / this.bpm
  }

  private getBarDuration(): number {
    return this.getBeatDuration() * BEATS_PER_BAR
  }

  private stopScheduler(): void {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId)
      this.schedulerId = null
    }
    for (const oscillator of this.scheduledClicks) {
      try {
        oscillator.stop()
      } catch {}
    }
    this.scheduledClicks.clear()
  }

  private emit<K extends keyof ClockEvents>(event: K, payload: ClockEvents[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload))
  }

  private emitState(): void {
    this.emit('state', this.getState())
  }
}

let instance: ClockEngine | null = null

export function getClockEngine(): ClockEngine {
  if (!instance) instance = new ClockEngine()
  return instance
}
