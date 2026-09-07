declare const currentFrame: number

declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: AudioWorkletNodeOptions)
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void
