type SendCallbacks = {
  onToken: (token: string) => void
  onToolCall: (data: { toolCallId: string; toolName: string; params: Record<string, unknown> }) => Promise<void> | void
  onDone: () => void
  onError: (msg: string) => void
}

type WsServerMessage =
  | { type: 'token'; data: string }
  | { type: 'tool_call'; toolCallId: string; toolName: string; params: Record<string, unknown> }
  | { type: 'done' }
  | { type: 'error'; message: string }

export class ChatBridgeWsClient {
  private ws: WebSocket | null = null
  private token: string
  private reconnectDelay = 1000
  private readonly maxReconnectDelay = 30_000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private currentCallbacks: SendCallbacks | null = null
  private connectPromise: Promise<void> | null = null

  constructor(token: string) {
    this.token = token
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

    if (this.connectPromise) {
      return this.connectPromise
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const wsBase = import.meta.env.VITE_CHATBRIDGE_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
      const url = `${wsBase}?token=${encodeURIComponent(this.token)}`

      const ws = new WebSocket(url)
      this.ws = ws

      ws.onopen = () => {
        console.log('[ChatBridge WS] connected')
        this.reconnectDelay = 1000
        this.connectPromise = null
        resolve()
      }

      ws.onmessage = (event) => {
        this.handleMessage(event)
      }

      ws.onerror = () => {
        this.connectPromise = null
        reject(new Error('WebSocket connection failed'))
      }

      ws.onclose = (event) => {
        console.log('[ChatBridge WS] closed', event.code, event.reason)
        this.connectPromise = null
        if (!event.wasClean) {
          this.scheduleReconnect()
        }
      }
    })

    return this.connectPromise
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    console.log(`[ChatBridge WS] reconnecting in ${this.reconnectDelay}ms`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch((err) => {
        console.error('[ChatBridge WS] reconnect failed', err)
      })
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }

  private handleMessage(event: MessageEvent): void {
    let msg: WsServerMessage
    try {
      msg = JSON.parse(event.data as string) as WsServerMessage
    } catch {
      console.error('[ChatBridge WS] invalid JSON from server')
      return
    }

    const cbs = this.currentCallbacks
    if (!cbs) return

    switch (msg.type) {
      case 'token':
        cbs.onToken(msg.data)
        break
      case 'tool_call':
        void cbs.onToolCall({
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
          params: msg.params,
        })
        break
      case 'done':
        this.currentCallbacks = null
        cbs.onDone()
        break
      case 'error':
        this.currentCallbacks = null
        cbs.onError(msg.message)
        break
    }
  }

  async sendUserMessage(
    payload: { conversationId: string; content: string; appContext: Record<string, unknown> },
    callbacks: SendCallbacks
  ): Promise<void> {
    await this.connect()
    this.currentCallbacks = callbacks
    this.ws!.send(JSON.stringify({ type: 'user_message', ...payload }))
  }

  sendToolResult(toolCallId: string, result: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ChatBridge WS] sendToolResult called but WS not open')
      return
    }
    this.ws.send(JSON.stringify({ type: 'tool_result', toolCallId, result }))
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close(1000, 'Client disconnect')
    this.ws = null
    this.currentCallbacks = null
  }
}
