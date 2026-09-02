import { createFetchWithProxy } from '@shared/models/utils/fetch-proxy'
import type { ModelDependencies } from '@shared/types/adapters'
import type { OAuthCredentialManager } from './credential-manager'
import { headersToRecord } from './fetch-utils'

const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'

function shouldRewriteUrl(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input))
    return url.pathname.includes('/v1/responses') || url.pathname.includes('/chat/completions')
  } catch {
    return false
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined

  try {
    const payload = parts[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '==='.slice((base64.length + 3) % 4)
    const json = atob(padded)
    const parsed: unknown = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return undefined
  }

  return undefined
}

function extractAccountIdFromToken(token: string): string | undefined {
  const claims = decodeJwtPayload(token)
  if (!claims) return undefined

  const authClaim = claims['https://api.openai.com/auth']
  if (authClaim && typeof authClaim === 'object' && !Array.isArray(authClaim)) {
    const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id
    if (typeof accountId === 'string' && accountId.length > 0) {
      return accountId
    }
  }

  return undefined
}

async function bufferCodexStream(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  const lines = text.split('\n')
  let lastResponseData: Record<string, unknown> | undefined

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const jsonStr = line.slice(6)
    if (jsonStr === '[DONE]') break

    try {
      const event: unknown = JSON.parse(jsonStr)
      if (event && typeof event === 'object' && !Array.isArray(event)) {
        const payload = event as Record<string, unknown>
        if (payload.type === 'response.completed' || payload.type === 'response.done') {
          const responseData = payload.response
          if (responseData && typeof responseData === 'object' && !Array.isArray(responseData)) {
            lastResponseData = responseData as Record<string, unknown>
          }
        }
      }
    } catch {
      // Ignore malformed SSE lines from intermediate chunks.
    }
  }

  return lastResponseData ?? { error: { message: 'Failed to parse streaming response from Codex endpoint' } }
}

async function readRequestBody(request?: Request): Promise<RequestInit['body'] | undefined> {
  if (!request || request.method === 'GET' || request.method === 'HEAD') {
    return undefined
  }

  const buffer = await request.clone().arrayBuffer()
  return buffer.byteLength > 0 ? buffer : undefined
}

async function bodyToString(body: RequestInit['body'] | undefined): Promise<string | undefined> {
  if (!body) {
    return undefined
  }
  if (typeof body === 'string') {
    return body
  }
  if (body instanceof URLSearchParams) {
    return body.toString()
  }
  if (body instanceof Blob) {
    return await body.text()
  }
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body)
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body)
  }
  return undefined
}

export function createOpenAIOAuthFetch(
  dependencies: ModelDependencies,
  credentialManager: OAuthCredentialManager,
  options?: { useProxy?: boolean; accountId?: string }
): typeof globalThis.fetch {
  const baseFetch = createFetchWithProxy(options?.useProxy, dependencies)

  return async (input, init) => {
    const credential = await credentialManager.getCredential()
    const originalRequest = input instanceof Request ? input : undefined
    const requestBody = init?.body ?? (await readRequestBody(originalRequest))
    const headers = new Headers(originalRequest?.headers)
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value)
      })
    }
    headers.delete('Authorization')
    headers.delete('x-api-key')
    headers.set('Authorization', `Bearer ${credential.accessToken}`)

    const accountId =
      (typeof credential.extra?.accountId === 'string' ? credential.extra.accountId : undefined) ??
      options?.accountId ??
      extractAccountIdFromToken(credential.accessToken)
    if (accountId) {
      headers.set('ChatGPT-Account-Id', accountId)
    }

    const isCodexRewrite = shouldRewriteUrl(input)
    // React Native's Request type omits several standard passthrough fields.
    // Read them structurally so browser hosts retain the original request data.
    const extendedRequest = originalRequest as unknown as
      | {
          cache?: unknown
          credentials?: unknown
          integrity?: unknown
          keepalive?: unknown
          mode?: unknown
          redirect?: unknown
          referrer?: unknown
          referrerPolicy?: unknown
        }
      | undefined
    let requestInput = input
    let patchedInit: RequestInit = {
      method: originalRequest?.method,
      signal: originalRequest?.signal,
      cache: extendedRequest?.cache,
      credentials: extendedRequest?.credentials,
      integrity: extendedRequest?.integrity,
      keepalive: extendedRequest?.keepalive,
      mode: extendedRequest?.mode,
      redirect: extendedRequest?.redirect,
      referrer: extendedRequest?.referrer,
      referrerPolicy: extendedRequest?.referrerPolicy,
      ...init,
      body: requestBody,
      headers: headersToRecord(headers),
    } as unknown as RequestInit
    let needsBuffer = false

    if (isCodexRewrite) {
      requestInput = CODEX_ENDPOINT

      const bodyString = await bodyToString(requestBody)
      if (bodyString) {
        try {
          const parsed: unknown = JSON.parse(bodyString)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const body = parsed as Record<string, unknown>
            if (body.store !== false) body.store = false
            if (typeof body.instructions !== 'string' || body.instructions.length === 0) {
              body.instructions = 'You are a helpful assistant.'
            }
            if (body.stream !== true) {
              body.stream = true
              needsBuffer = true
            }
            patchedInit = { ...patchedInit, body: JSON.stringify(body) }
          }
        } catch {
          // Leave the request body unchanged if it isn't JSON.
        }
      }
    }

    const response = await baseFetch(requestInput, patchedInit)

    // React Native's Response declaration omits the optional streaming body.
    const responseBody = (response as unknown as { body?: unknown }).body
    if (needsBuffer && response.ok && responseBody) {
      const buffered = await bufferCodexStream(response)
      return new Response(JSON.stringify(buffered), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return response
  }
}
