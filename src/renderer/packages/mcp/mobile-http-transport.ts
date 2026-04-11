import { CapacitorHttp } from '@capacitor/core'
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'
import { createNativeReadableStream } from '@/native/stream-http'

/**
 * MCP Streamable-HTTP transport for Capacitor (Android/iOS).
 *
 * Bypasses CORS by routing all HTTP calls through the native layer:
 *  - POST / DELETE  → CapacitorHttp (buffered, no CORS restriction)
 *  - GET SSE        → createNativeReadableStream (streaming, no CORS restriction)
 *
 * Drop-in replacement for StreamableHTTPClientTransport on native platforms.
 */
export class MobileStreamableHTTPTransport implements Transport {
  private _sessionId: string | undefined
  private _getStreamAbortController: AbortController | null = null
  private _closed = false

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(
    private readonly url: string,
    private readonly extraHeaders: Record<string, string> = {}
  ) {}

  get sessionId(): string | undefined {
    return this._sessionId
  }

  /** No-op: HTTP transport uses per-request connections. */
  async start(): Promise<void> {}

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this._closed) {
      throw new Error('MobileStreamableHTTPTransport is closed')
    }

    const headers = this._buildHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    })

    let response: Awaited<ReturnType<typeof CapacitorHttp.request>>
    try {
      response = await CapacitorHttp.request({
        url: this.url,
        method: 'POST',
        headers,
        data: JSON.stringify(message),
        responseType: 'text',
      })
    } catch (err) {
      this.onerror?.(err as Error)
      throw err
    }

    const responseHeaders = response.headers ?? {}

    // Extract session ID from the first response that carries it
    const newSessionId =
      responseHeaders['mcp-session-id'] ??
      responseHeaders['Mcp-Session-Id'] ??
      responseHeaders['MCP-Session-Id']
    if (newSessionId && !this._sessionId) {
      this._sessionId = newSessionId
    }

    const status = response.status
    const body =
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data)

    if (status === 202) {
      // Server accepted a notification with no response body.
      // After the handshake completes, open the long-lived GET SSE channel.
      const msg = message as { method?: string }
      if (msg.method === 'notifications/initialized') {
        void this._startGetSse()
      }
      return
    }

    if (status < 200 || status >= 300) {
      const err = new Error(`MCP server returned HTTP ${status}: ${body}`)
      this.onerror?.(err)
      throw err
    }

    const contentType = (
      responseHeaders['content-type'] ??
      responseHeaders['Content-Type'] ??
      ''
    ).toLowerCase()

    if (contentType.includes('text/event-stream')) {
      // Finite SSE body carried in a POST response (e.g. initialize result)
      this._parseSseText(body)
    } else if (body) {
      this._parseJsonMessage(body)
    }
  }

  async close(): Promise<void> {
    if (this._closed) return
    this._closed = true

    this._getStreamAbortController?.abort()
    this._getStreamAbortController = null

    if (this._sessionId) {
      try {
        await CapacitorHttp.request({
          url: this.url,
          method: 'DELETE',
          headers: this._buildHeaders({}),
          responseType: 'text',
        })
      } catch {
        // Best-effort; 405 Method Not Allowed is acceptable per spec
      }
    }

    this.onclose?.()
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _buildHeaders(extra: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...this.extraHeaders, ...extra }
    if (this._sessionId) {
      headers['mcp-session-id'] = this._sessionId
    }
    return headers
  }

  /** Parse a complete, buffered SSE body returned inline from a POST response. */
  private _parseSseText(text: string): void {
    // Normalise line endings so we only need to look for \n\n
    const normalised = text.replace(/\r\n/g, '\n')
    for (const eventBlock of normalised.split('\n\n')) {
      const data = this._extractSseData(eventBlock)
      if (data) this._parseJsonMessage(data)
    }
  }

  /**
   * Collect all `data:` lines from one SSE event block and join them with '\n'.
   * Handles both `data: value` (with space) and `data:value` (without space),
   * matching the full SSE wire format (W3C EventSource spec §9.2.6).
   * Multiple data lines within one event block are joined with '\n' per spec.
   */
  private _extractSseData(eventBlock: string): string {
    const chunks: string[] = []
    for (const line of eventBlock.split('\n')) {
      if (line.startsWith('data:')) {
        const value = line.slice(5)
        chunks.push(value.startsWith(' ') ? value.slice(1) : value)
      } else if (line === 'data') {
        // bare "data" field with no value — counts as empty string per spec
        chunks.push('')
      }
    }
    return chunks.join('\n')
  }

  private _parseJsonMessage(text: string): void {
    try {
      const parsed = JSONRPCMessageSchema.parse(JSON.parse(text))
      this.onmessage?.(parsed)
    } catch (err) {
      this.onerror?.(
        new Error(`Failed to parse MCP message: ${(err as Error).message}\n${text}`)
      )
    }
  }

  /**
   * Open the long-lived GET SSE channel for server-initiated messages.
   * Called once after the MCP handshake completes (notifications/initialized → 202).
   */
  private async _startGetSse(): Promise<void> {
    if (this._closed) return

    const abortController = new AbortController()
    this._getStreamAbortController = abortController
    const signal = abortController.signal

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    try {
      const stream = createNativeReadableStream({
        url: this.url,
        method: 'GET',
        headers: this._buildHeaders({ Accept: 'text/event-stream' }),
      })

      reader = stream.getReader()
      const decoder = new TextDecoder()
      // Buffer for partial SSE events across chunk boundaries
      let buffer = ''

      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break

        // Normalise CRLF so buffer scanning only needs to look for \n\n
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const eventBlock = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = this._extractSseData(eventBlock)
          if (data) this._parseJsonMessage(data)
        }
      }
    } catch (err) {
      if (!signal.aborted && !this._closed) {
        this.onerror?.(err as Error)
      }
    } finally {
      try {
        reader?.releaseLock()
      } catch {
        // Ignore errors from releasing an already-released lock
      }
    }
  }
}
