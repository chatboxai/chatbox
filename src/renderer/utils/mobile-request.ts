import { CapacitorHttp } from '@capacitor/core'
import { createNativeReadableStream } from '@/native/stream-http'
import { ApiError } from '../../shared/models/errors'

export async function handleMobileRequest(
  url: string,
  method: string,
  headers: Headers,
  body?: RequestInit['body'],
  signal?: AbortSignal
): Promise<Response> {
  const headerObj = Object.fromEntries(headers.entries())
  const isStreaming = body && typeof body === 'string' && JSON.parse(body).stream === true

  if (isStreaming) {
    try {
      // Add SSE Accept header for proper content negotiation
      const streamHeaders = {
        ...headerObj,
        Accept: 'text/event-stream',
      }

      const stream = createNativeReadableStream({
        url,
        method,
        headers: streamHeaders,
        body: body as string,
      })

      // Handle abort signal for stream cancellation
      if (signal) {
        const onAbort = () => {
          try {
            void stream.cancel('aborted')
          } catch {}
        }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }

      // TODO: Once native plugin supports returning status/headers,
      // use them instead of hardcoded values
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (err) {
      console.warn('Native streaming unavailable, falling back', err)
    }
  }

  const response = await CapacitorHttp.request({
    url,
    method,
    headers: headerObj,
    data: body,
    responseType: 'text',
  })

  const rawData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
  // Treat status 0 or < 200 as errors, in addition to >= 400
  if (response.status === 0 || response.status < 200 || response.status >= 400) {
    throw new ApiError(`Status Code ${response.status}`, rawData)
  }
  const responseData = rawData

  if (isStreaming) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(responseData))
        controller.close()
      },
    })
    return new Response(stream, {
      status: response.status,
      headers: { ...response.headers, 'Content-Type': 'text/event-stream' },
    })
  }

  return new Response(responseData, {
    status: response.status,
    headers: response.headers,
  })
}
