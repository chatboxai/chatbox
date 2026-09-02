// 由于stdio transport只能在main进程使用，这里实现一个代理transport，通过ipc控制main进程中的stdio transport

import type { JSONRPCMessage, Transport, TransportSendOptions } from '@modelcontextprotocol/client'
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'

export class IPCStdioTransport implements Transport {
  static async create(serverParams: StdioServerParameters) {
    const ipcTransportId = await window.electronAPI.invoke('mcp:stdio-transport:create', serverParams)
    return new IPCStdioTransport(ipcTransportId)
  }

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  // The MCP client classifies custom transports structurally so discovery timeouts
  // can fall back to the legacy handshake on a local stdio pipe.
  readonly stderr = null
  readonly pid = undefined

  private readonly removeEventListeners: Array<() => void> = []
  private closedNotified = false

  constructor(private readonly ipcTransportId: string) {
    this.removeEventListeners.push(
      window.electronAPI.addMcpStdioTransportEventListener(this.ipcTransportId, 'onclose', (stderrMessage: string) => {
        try {
          if (stderrMessage) {
            this.onerror?.(new Error(stderrMessage))
          }
        } finally {
          this.notifyClosed()
        }
      }),
      window.electronAPI.addMcpStdioTransportEventListener(this.ipcTransportId, 'onerror', (error: Error) => {
        this.onerror?.(error)
      }),
      window.electronAPI.addMcpStdioTransportEventListener(
        this.ipcTransportId,
        'onmessage',
        (message: JSONRPCMessage) => {
          this.onmessage?.(message)
        }
      )
    )
  }

  private disposeEventListeners() {
    for (const removeListener of this.removeEventListeners.splice(0)) {
      removeListener()
    }
  }

  private notifyClosed() {
    if (this.closedNotified) {
      this.disposeEventListeners()
      return
    }
    this.closedNotified = true
    try {
      this.onclose?.()
    } finally {
      this.disposeEventListeners()
    }
  }

  async start(): Promise<void> {
    await window.electronAPI.invoke('mcp:stdio-transport:start', this.ipcTransportId)
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    await window.electronAPI.invoke('mcp:stdio-transport:send', this.ipcTransportId, message)
  }

  async close(): Promise<void> {
    try {
      await window.electronAPI.invoke('mcp:stdio-transport:close', this.ipcTransportId)
    } finally {
      this.notifyClosed()
    }
  }
}
