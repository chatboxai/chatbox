import {
  DESKTOP_DIRECT_REQUEST_CHANNELS,
  type DesktopDirectReadResult,
  type DesktopDirectRequestPayload,
  type DesktopDirectResponseMetadata,
} from '@shared/desktop-direct-request'
import type { ElectronIPC } from '@shared/electron-types'

async function serializeRequestBody(body: RequestInit['body']): Promise<string | ArrayBuffer | undefined> {
  if (body === null || body === undefined) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return await body.arrayBuffer()
  if (body instanceof ArrayBuffer) return body
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice().buffer
  }
  throw new Error(`Unsupported desktop direct request body: ${body.constructor.name}`)
}

function serializeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, name) => {
    result[name] = value
  })
  return result
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

export async function desktopDirectRequest(
  ipc: Pick<ElectronIPC, 'invoke'>,
  url: string,
  method: string,
  headers: Headers,
  body?: RequestInit['body'],
  signal?: AbortSignal
): Promise<Response> {
  if (signal?.aborted) throw createAbortError()

  const serializedBody = await serializeRequestBody(body)
  if (signal?.aborted) throw createAbortError()

  const requestId = crypto.randomUUID()
  const payload: DesktopDirectRequestPayload = {
    requestId,
    url,
    method,
    headers: serializeHeaders(headers),
    body: serializedBody,
  }

  let finished = false
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  const cancelMainRequest = () => {
    if (finished) return
    finished = true
    void ipc.invoke(DESKTOP_DIRECT_REQUEST_CHANNELS.cancel, requestId).catch(() => undefined)
  }
  const abort = () => {
    if (finished) return
    cancelMainRequest()
    streamController?.error(createAbortError())
  }
  signal?.addEventListener('abort', abort, { once: true })

  try {
    const metadata = (await ipc.invoke(DESKTOP_DIRECT_REQUEST_CHANNELS.start, payload)) as DesktopDirectResponseMetadata
    if (signal?.aborted) {
      cancelMainRequest()
      throw createAbortError()
    }

    if (!metadata.hasBody) {
      finished = true
      signal?.removeEventListener('abort', abort)
      return new Response(null, metadata)
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
      },
      async pull(controller) {
        try {
          const result = (await ipc.invoke(DESKTOP_DIRECT_REQUEST_CHANNELS.read, requestId)) as DesktopDirectReadResult
          if (result.done) {
            finished = true
            signal?.removeEventListener('abort', abort)
            controller.close()
          } else {
            controller.enqueue(result.chunk)
          }
        } catch (error) {
          cancelMainRequest()
          signal?.removeEventListener('abort', abort)
          controller.error(error)
        }
      },
      cancel: cancelMainRequest,
    })

    return new Response(stream, metadata)
  } catch (error) {
    cancelMainRequest()
    signal?.removeEventListener('abort', abort)
    if (signal?.aborted) throw createAbortError()
    throw error
  }
}

export function desktopDirectRequestFromWindow(
  url: string,
  method: string,
  headers: Headers,
  body?: RequestInit['body'],
  signal?: AbortSignal
): Promise<Response> {
  return desktopDirectRequest(window.electronAPI, url, method, headers, body, signal)
}
