import { CapacitorHttp } from '@capacitor/core'
import { backgroundStreamFetch, isBackgroundStreamRequest } from '@shared/utils/background-stream'
import {
  backgroundStreamBridge,
  backgroundStreamPrototypeEnabled,
  subscribeBackgroundStreamResume,
} from '@/native/background-stream'
import { createNativeResponse } from '@/native/stream-http'
import { ApiError } from '../../shared/models/errors'

export function handleMobileRequest(
  url: string,
  method: string,
  headers: Headers,
  body?: RequestInit['body'],
  signal?: AbortSignal
): Promise<Response> {
  if (backgroundStreamPrototypeEnabled && isBackgroundStreamRequest(url, body, headers)) {
    return backgroundStreamFetch(
      backgroundStreamBridge,
      url,
      { method, headers, body, signal },
      subscribeBackgroundStreamResume,
      () => handleDefaultMobileRequest(url, method, headers, body, signal)
    )
  }
  return handleDefaultMobileRequest(url, method, headers, body, signal)
}

async function handleDefaultMobileRequest(
  url: string,
  method: string,
  headers: Headers,
  body?: RequestInit['body'],
  signal?: AbortSignal
): Promise<Response> {
  // Fix: Convert Headers to plain object without using .entries()
  const headerObj: Record<string, string> = {}
  headers.forEach((value, key) => {
    headerObj[key] = value
  })
  const isStreaming = body && typeof body === 'string' && JSON.parse(body).stream === true

  if (isStreaming) {
    const response = await createNativeResponse(
      { url, method, headers: { ...headerObj, Accept: 'text/event-stream' }, body: body as string },
      { signal }
    )
    if (!response.ok) {
      const errorBody = await readErrorBody(response)
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      throw new ApiError(
        `Status Code ${response.status}`,
        errorBody,
        response.status,
        undefined,
        response.headers.get('retry-after') ?? undefined
      )
    }
    return response
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
    throw new ApiError(
      `Status Code ${response.status}`,
      rawData,
      response.status,
      undefined,
      new Headers(response.headers).get('retry-after') ?? undefined
    )
  }
  const responseData = rawData

  return new Response([204, 205, 304].includes(response.status) ? null : responseData, {
    status: response.status,
    headers: response.headers,
  })
}

async function readErrorBody(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let remaining = 64 * 1024
  let text = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), 5_000)
  })
  try {
    while (remaining > 0) {
      const result = await Promise.race([reader.read(), timeout])
      if (!result || result.done) break
      const chunk = result.value.subarray(0, remaining)
      text += decoder.decode(chunk, { stream: true })
      remaining -= chunk.byteLength
    }
  } catch {
    // The HTTP status remains useful when the error response body is interrupted.
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => undefined)
  }
  return text + decoder.decode()
}
