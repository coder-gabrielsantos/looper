interface EncoderResponse {
  ok: boolean
  data?: ArrayBuffer
  error?: string
}

export function encodeMp3(samples: Float32Array, sampleRate: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3Encoder.worker.ts', import.meta.url), {
      type: 'module'
    })

    const finish = () => worker.terminate()

    worker.onmessage = (event: MessageEvent<EncoderResponse>) => {
      finish()
      if (!event.data.ok || !event.data.data) {
        reject(new Error(event.data.error || 'MP3 encoding failed.'))
        return
      }
      resolve(new Uint8Array(event.data.data))
    }

    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'MP3 encoder worker failed.'))
    }

    worker.postMessage(
      { samples: samples.buffer, sampleRate, bitrate: 192 },
      [samples.buffer]
    )
  })
}
