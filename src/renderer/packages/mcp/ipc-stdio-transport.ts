// stdio transport 只能在桌面端后端层使用，这里通过 IPC 代理该 transport

import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

export class IPCStdioTransport implements Transport {
  static async create(serverParams: StdioServerParameters) {
    const ipcTransportId = await window.desktopAPI.invoke('mcp:stdio-transport:create', serverParams)
    return new IPCStdioTransport(ipcTransportId)
  }

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  private readonly unlistenCallbacks: Array<() => void> = []

  constructor(private readonly ipcTransportId: string) {
    this.unlistenCallbacks.push(
      window.desktopAPI.addMcpStdioTransportEventListener(this.ipcTransportId, 'onclose', (stderrMessage: string) => {
        if (stderrMessage) {
          this.onerror?.(new Error(stderrMessage))
        }
        this.cleanupListeners()
        this.onclose?.()
      })
    )
    this.unlistenCallbacks.push(
      window.desktopAPI.addMcpStdioTransportEventListener(this.ipcTransportId, 'onerror', (error: Error) => {
        this.onerror?.(error)
      })
    )
    this.unlistenCallbacks.push(
      window.desktopAPI.addMcpStdioTransportEventListener(
        this.ipcTransportId,
        'onmessage',
        (message: JSONRPCMessage) => {
          this.onmessage?.(message)
        }
      )
    )
  }

  private cleanupListeners() {
    while (this.unlistenCallbacks.length > 0) {
      const unlisten = this.unlistenCallbacks.pop()
      unlisten?.()
    }
  }

  async start(): Promise<void> {
    await window.desktopAPI.invoke('mcp:stdio-transport:start', this.ipcTransportId)
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await window.desktopAPI.invoke('mcp:stdio-transport:send', this.ipcTransportId, message)
  }

  async close(): Promise<void> {
    this.cleanupListeners()
    await window.desktopAPI.invoke('mcp:stdio-transport:close', this.ipcTransportId)
  }
}
