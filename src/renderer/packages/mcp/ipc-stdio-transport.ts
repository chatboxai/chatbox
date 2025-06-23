// 由于stdio transport只能在main进程使用，这里实现一个代理transport，通过ipc控制main进程中的stdio transport

import { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

export class IPCStdioTransport implements Transport {
  static async create(serverParams: StdioServerParameters) {
    const ipcTransportId = await window.electronAPI.invoke('mcp:stdio-transport:create', serverParams)
    return new IPCStdioTransport(ipcTransportId)
  }

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(private readonly ipcTransportId: string) {
    window.electronAPI.addMcpStdioTransportEventListener(this.ipcTransportId, 'onclose', (stderrMessage: string) => {
      if (stderrMessage) {
        this.onerror?.(new Error(stderrMessage))
      }
      this.onclose?.()
    })
    window.electronAPI.addMcpStdioTransportEventListener(this.ipcTransportId, 'onerror', (error: Error) => {
      this.onerror?.(error)
    })
    window.electronAPI.addMcpStdioTransportEventListener(
      this.ipcTransportId,
      'onmessage',
      (message: JSONRPCMessage) => {
        this.onmessage?.(message)
      }
    )
  }

  async start(): Promise<void> {
    await window.electronAPI.invoke('mcp:stdio-transport:start', this.ipcTransportId)
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await window.electronAPI.invoke('mcp:stdio-transport:send', this.ipcTransportId, message)
  }

  async close(): Promise<void> {
    await window.electronAPI.invoke('mcp:stdio-transport:close', this.ipcTransportId)
  }
}
