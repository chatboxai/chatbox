import { type StartStreamOptions, StreamHttp } from 'capacitor-stream-http'

export type { StartStreamOptions } from 'capacitor-stream-http'
export { StreamHttp }

export function createNativeReadableStream(options: StartStreamOptions): ReadableStream<Uint8Array> {
  let streamId: string | null = null
  let removeChunk: (() => void) | null = null
  let removeEnd: (() => void) | null = null
  let removeError: (() => void) | null = null
  // Create single TextEncoder instance to reuse
  const textEncoder = new TextEncoder()

  const cleanup = () => {
    removeChunk?.()
    removeEnd?.()
    removeError?.()
    removeChunk = null
    removeEnd = null
    removeError = null
  }

  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      try {
        // Register listeners first
        removeChunk = (
          await StreamHttp.addListener('chunk', (data) => {
            if (!streamId || data.id !== streamId) return
            const text = data.chunk || ''
            controller.enqueue(textEncoder.encode(text))
          })
        ).remove

        removeEnd = (
          await StreamHttp.addListener('end', (data) => {
            if (!streamId || data.id !== streamId) return
            cleanup()
            controller.close()
          })
        ).remove

        removeError = (
          await StreamHttp.addListener('error', (data) => {
            if (!streamId || data.id !== streamId) return
            cleanup()
            controller.error(new Error(data.error || 'Native stream error'))
          })
        ).remove

        // Start the stream after listeners are registered
        const res = await StreamHttp.startStream(options)
        streamId = res.id
      } catch (error) {
        // Clean up listeners if startStream fails
        cleanup()
        // Propagate error to the stream controller
        controller.error(error instanceof Error ? error : new Error('Failed to start native stream'))
      }
    },
    cancel: async () => {
      try {
        if (streamId) {
          await StreamHttp.cancelStream({ id: streamId })
        }
      } finally {
        cleanup()
      }
    },
  })
}
