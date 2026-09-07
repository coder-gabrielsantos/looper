const EDGE_FADE_SAMPLES = 32
const LEVEL_INTERVAL_FRAMES = 768

interface ScheduleMessage {
  command: 'schedule'
  startFrame: number
  endFrame: number
  latencyFrames: number
}

interface StopAtMessage {
  command: 'stop-at'
  frame: number
}

interface CancelMessage {
  command: 'cancel'
}

type RecorderMessage = ScheduleMessage | StopAtMessage | CancelMessage
type ProcessorMode = 'idle' | 'scheduled' | 'recording' | 'playing-tail' | 'playing' | 'stopped'

class RecorderProcessor extends AudioWorkletProcessor {
  private mode: ProcessorMode = 'idle'
  private startFrame = 0
  private endFrame = 0
  private captureEndFrame = 0
  private stopFrame: number | null = null
  private loopBuffer: Float32Array | null = null
  private loopLength = 0
  private latencyFrames = 0
  private playhead = 0
  private nextLevelFrame = 0

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<RecorderMessage>) => {
      if (event.data.command === 'schedule') {
        this.startFrame = event.data.startFrame
        this.endFrame = event.data.endFrame
        this.loopLength = event.data.endFrame - event.data.startFrame
        this.latencyFrames = Math.max(0, Math.min(event.data.latencyFrames, this.loopLength - 1))
        this.captureEndFrame = this.endFrame + this.latencyFrames
        this.stopFrame = null
        this.loopBuffer = new Float32Array(this.loopLength + this.latencyFrames)
        this.playhead = 0
        this.mode = 'scheduled'
      } else if (event.data.command === 'stop-at') {
        this.stopFrame = event.data.frame
      } else if (event.data.command === 'cancel') {
        this.mode = 'stopped'
        this.loopBuffer = null
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    const quantumLength = output?.length ?? input?.length ?? 128
    let levelSum = 0

    output?.fill(0)

    for (let i = 0; i < quantumLength; i++) {
      const absoluteFrame = currentFrame + i
      const inputSample = input?.[i] ?? 0

      if (this.stopFrame !== null && absoluteFrame >= this.stopFrame) {
        if (this.mode !== 'stopped') {
          this.mode = 'stopped'
          this.loopBuffer = null
          this.port.postMessage({ type: 'playback-stopped', frame: absoluteFrame })
        }
        continue
      }

      if (this.mode === 'scheduled' && absoluteFrame >= this.startFrame) {
        this.mode = 'recording'
        this.port.postMessage({ type: 'recording-started', frame: absoluteFrame })
      }

      if (this.mode === 'recording' && absoluteFrame >= this.endFrame) {
        this.mode = 'playing-tail'
        this.playhead = 0
        this.port.postMessage({ type: 'recording-complete', frame: absoluteFrame })
      }

      if ((this.mode === 'recording' || this.mode === 'playing-tail') && this.loopBuffer) {
        const captureIndex = absoluteFrame - this.startFrame
        const logicalPosition = captureIndex - this.latencyFrames
        if (logicalPosition >= 0 && logicalPosition < this.loopLength) {
          this.loopBuffer[captureIndex] = inputSample * this.getEdgeGain(logicalPosition)
        }
      }

      if (this.mode === 'playing-tail' && absoluteFrame >= this.captureEndFrame) {
        this.mode = 'playing'
        this.port.postMessage({ type: 'capture-complete', frame: absoluteFrame })
      }

      if (
        (this.mode === 'playing-tail' || this.mode === 'playing') &&
        this.loopBuffer &&
        this.loopLength > 0
      ) {
        const playbackSample = this.loopBuffer[this.latencyFrames + this.playhead]
        if (output) output[i] = playbackSample
        levelSum += playbackSample * playbackSample
        this.playhead = (this.playhead + 1) % this.loopLength
      } else if (this.mode === 'scheduled' || this.mode === 'recording') {
        levelSum += inputSample * inputSample
      }
    }

    if (currentFrame + quantumLength >= this.nextLevelFrame) {
      this.nextLevelFrame = currentFrame + LEVEL_INTERVAL_FRAMES
      this.port.postMessage({ type: 'level', value: Math.sqrt(levelSum / quantumLength) })
    }

    return true
  }

  private getEdgeGain(position: number): number {
    if (!this.loopBuffer) return 1
    if (position < EDGE_FADE_SAMPLES) {
      return Math.sin((position / EDGE_FADE_SAMPLES) * (Math.PI / 2))
    }
    if (position >= this.loopLength - EDGE_FADE_SAMPLES) {
      const remaining = this.loopLength - position - 1
      return Math.sin((remaining / EDGE_FADE_SAMPLES) * (Math.PI / 2))
    }
    return 1
  }
}

registerProcessor('recorder-processor', RecorderProcessor)
