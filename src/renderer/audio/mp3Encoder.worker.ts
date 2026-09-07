import { Mp3Encoder } from '@breezystack/lamejs'

interface EncodeRequest {
  samples: ArrayBuffer
  sampleRate: number
  bitrate: number
}

interface EncoderWorkerScope {
  onmessage: ((event: MessageEvent<EncodeRequest>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

const workerScope = self as unknown as EncoderWorkerScope
const BLOCK_SIZE = 1152

workerScope.onmessage = (event) => {
  try {
    const samples = new Float32Array(event.data.samples)
    const pcm = new Int16Array(samples.length)

    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]))
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    }

    const encoder = new Mp3Encoder(1, event.data.sampleRate, event.data.bitrate)
    const chunks: Uint8Array[] = []
    let byteLength = 0

    for (let offset = 0; offset < pcm.length; offset += BLOCK_SIZE) {
      const encoded = encoder.encodeBuffer(pcm.subarray(offset, offset + BLOCK_SIZE))
      if (encoded.length === 0) continue
      chunks.push(encoded)
      byteLength += encoded.length
    }

    const tail = encoder.flush()
    if (tail.length > 0) {
      chunks.push(tail)
      byteLength += tail.length
    }

    const result = new Uint8Array(byteLength)
    let writeOffset = 0
    for (const chunk of chunks) {
      result.set(chunk, writeOffset)
      writeOffset += chunk.length
    }

    workerScope.postMessage({ ok: true, data: result.buffer }, [result.buffer])
  } catch (error) {
    workerScope.postMessage(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      []
    )
  }
}
