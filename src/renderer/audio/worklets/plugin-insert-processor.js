const DEFAULT_CHUNK_SIZE = 2048
const MAX_PENDING_CHUNKS = 4

class PluginInsertProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.chunkSize = Math.max(128, options?.processorOptions?.chunkSize ?? DEFAULT_CHUNK_SIZE)
    this.captureBuffer = new Float32Array(this.chunkSize)
    this.captureOffset = 0
    this.currentOutput = null
    this.outputOffset = 0
    this.nextRequestId = 1
    this.nextOutputId = 1
    this.pendingCount = 0
    this.completed = new Map()
    this.bypassed = true
    this.outputStarted = false

    this.port.onmessage = (event) => {
      const message = event.data
      if (message.type === 'set-active') {
        this.bypassed = !message.active
        this.resetPipeline()
        return
      }

      if (message.type === 'audio-response') {
        this.pendingCount = Math.max(0, this.pendingCount - 1)
        const samples = message.output
        if (samples instanceof Float32Array && samples.length === this.chunkSize) {
          this.completed.set(message.requestId, samples)
        }
      }
    }
  }

  resetPipeline() {
    this.captureBuffer = new Float32Array(this.chunkSize)
    this.captureOffset = 0
    this.currentOutput = null
    this.outputOffset = 0
    this.nextRequestId = 1
    this.nextOutputId = 1
    this.pendingCount = 0
    this.completed.clear()
    this.outputStarted = false
  }

  capture(input) {
    let inputOffset = 0
    while (inputOffset < input.length) {
      const frameCount = Math.min(input.length - inputOffset, this.chunkSize - this.captureOffset)
      this.captureBuffer.set(input.subarray(inputOffset, inputOffset + frameCount), this.captureOffset)
      inputOffset += frameCount
      this.captureOffset += frameCount

      if (this.captureOffset !== this.chunkSize) continue

      const requestId = this.nextRequestId++
      const chunk = this.captureBuffer
      this.captureBuffer = new Float32Array(this.chunkSize)
      this.captureOffset = 0

      if (this.pendingCount >= MAX_PENDING_CHUNKS) {
        this.completed.set(requestId, chunk)
        continue
      }

      this.pendingCount += 1
      this.port.postMessage(
        { type: 'process-audio', requestId, input: chunk },
        [chunk.buffer]
      )
    }
  }

  render(output, dryInput) {
    output.fill(0)
    let destinationOffset = 0

    while (destinationOffset < output.length) {
      if (!this.currentOutput) {
        const next = this.completed.get(this.nextOutputId)
        if (!next) {
          if (!this.outputStarted) output.set(dryInput.subarray(destinationOffset), destinationOffset)
          return
        }
        this.completed.delete(this.nextOutputId)
        this.nextOutputId += 1
        this.currentOutput = next
        this.outputOffset = 0
        this.outputStarted = true
      }

      const frameCount = Math.min(
        output.length - destinationOffset,
        this.currentOutput.length - this.outputOffset
      )
      output.set(
        this.currentOutput.subarray(this.outputOffset, this.outputOffset + frameCount),
        destinationOffset
      )
      destinationOffset += frameCount
      this.outputOffset += frameCount

      if (this.outputOffset === this.currentOutput.length) {
        this.currentOutput = null
        this.outputOffset = 0
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    if (!output) return true

    if (!input) {
      output.fill(0)
      return true
    }

    if (this.bypassed) {
      output.set(input)
      return true
    }

    this.capture(input)
    this.render(output, input)
    return true
  }
}

registerProcessor('plugin-insert-processor', PluginInsertProcessor)
