import { createMCPClient } from '@ai-sdk/mcp'
import {
  type JSONObject,
  StreamableHTTPClientTransport as NegotiatingHTTPClientTransport,
  Client as NegotiatingMCPClient,
  SSEClientTransport as NegotiatingSSEClientTransport,
  type Transport as NegotiatingTransport,
  SdkHttpError,
} from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport as LegacyHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { type JSONValue as AIToolJSONValue, dynamicTool, jsonSchema, type ToolSet } from 'ai'
import Emittery from 'emittery'
import { isEqual } from 'lodash'
import { IPCStdioTransport } from './ipc-stdio-transport'
import type { MCPProtocolMode, MCPServerConfig, MCPServerStatus } from './types'

type TransportConfig = MCPServerConfig['transport']
type LegacyMCPClient = Awaited<ReturnType<typeof createMCPClient>>

interface MCPClient {
  tools(): Promise<ToolSet>
  close(): Promise<void>
}

function toModelOutput({ output }: { output: unknown }) {
  if (!output || typeof output !== 'object' || !('content' in output) || !Array.isArray(output.content)) {
    return { type: 'json' as const, value: output as AIToolJSONValue }
  }

  if (output.content.length === 0 && 'structuredContent' in output && output.structuredContent !== undefined) {
    return { type: 'json' as const, value: output.structuredContent as AIToolJSONValue }
  }

  return {
    type: 'content' as const,
    value: output.content.map((part: unknown) => {
      if (part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part) {
        return { type: 'text' as const, text: String(part.text) }
      }
      if (
        part &&
        typeof part === 'object' &&
        'type' in part &&
        part.type === 'image' &&
        'data' in part &&
        'mimeType' in part
      ) {
        return {
          type: 'image-data' as const,
          data: String(part.data),
          mediaType: String(part.mimeType),
        }
      }
      return { type: 'text' as const, text: JSON.stringify(part) ?? String(part) }
    }),
  }
}

function createNegotiatingClientAdapter(client: NegotiatingMCPClient): MCPClient {
  return {
    async tools() {
      const { tools: definitions } = await client.listTools()
      const tools: ToolSet = {}

      for (const definition of definitions) {
        const inputSchema = {
          ...definition.inputSchema,
          properties: definition.inputSchema.properties ?? {},
          additionalProperties: false,
        }
        tools[definition.name] = dynamicTool({
          description: definition.description,
          title: definition.title ?? definition.annotations?.title,
          inputSchema: jsonSchema(inputSchema as Parameters<typeof jsonSchema>[0]),
          execute: async (args, options) => {
            options.abortSignal?.throwIfAborted()
            const result = await client.callTool(
              {
                name: definition.name,
                arguments: args as JSONObject,
              },
              { signal: options.abortSignal }
            )
            return { ...result, isError: result.isError ?? false }
          },
          toModelOutput,
        })
      }

      return tools
    },
    close() {
      return client.close()
    },
  }
}

function createLegacyClientAdapter(client: LegacyMCPClient): MCPClient {
  return {
    async tools() {
      // @ai-sdk/mcp can resolve a newer @ai-sdk/provider-utils patch than `ai`.
      // The returned tools share the same runtime schema contract, but TypeScript
      // treats the two package instances' schema symbols as distinct.
      return (await client.tools()) as unknown as ToolSet
    },
    close() {
      return client.close()
    },
  }
}

async function connectNegotiatingClient(
  transport: NegotiatingTransport,
  name: string,
  protocolMode: MCPProtocolMode
): Promise<MCPClient> {
  const client = new NegotiatingMCPClient({ name, version: '1.0.0' }, { versionNegotiation: { mode: protocolMode } })
  try {
    await client.connect(transport)
    return createNegotiatingClientAdapter(client)
  } catch (error) {
    await client.close().catch(console.error)
    throw error
  }
}

async function createAutoClient(transportConfig: TransportConfig, name: string): Promise<MCPClient> {
  if (transportConfig.type === 'stdio') {
    const transport = await IPCStdioTransport.create(transportConfig)
    return connectNegotiatingClient(transport, name, 'auto')
  }

  const transport = new NegotiatingHTTPClientTransport(new URL(transportConfig.url), {
    requestInit: { headers: transportConfig.headers },
  })
  try {
    return await connectNegotiatingClient(transport, name, 'auto')
  } catch (error) {
    if (!(error instanceof SdkHttpError) || (error.status !== 404 && error.status !== 405)) {
      throw error
    }

    console.error('Streamable HTTP connection failed, trying legacy SSE', error)
    try {
      const fallbackTransport = new NegotiatingSSEClientTransport(new URL(transportConfig.url), {
        requestInit: { headers: transportConfig.headers },
      })
      return await connectNegotiatingClient(fallbackTransport, name, 'legacy')
    } catch (fallbackError) {
      const streamableMessage = error.message
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      throw new Error(
        `Streamable HTTP connection failed: ${streamableMessage}\nLegacy SSE fallback failed: ${fallbackMessage}`,
        { cause: error }
      )
    }
  }
}

async function createLegacyClient(transportConfig: TransportConfig, name: string): Promise<MCPClient> {
  if (transportConfig.type === 'stdio') {
    const transport = await IPCStdioTransport.create(transportConfig)
    let errorMessage = ''
    try {
      return createLegacyClientAdapter(
        await createMCPClient({
          name,
          transport,
          onUncaughtError(error: unknown) {
            console.error('mcp:client:onUncaughtError', error)
            errorMessage += (error as Error).message
          },
        })
      )
    } catch (err) {
      transport.close().catch(console.error)
      let message = (err as Error).message
      if (errorMessage && !message.includes(errorMessage)) {
        message += `\n${errorMessage}`
      }
      throw new Error(message, { cause: err })
    }
  }
  if (transportConfig.type === 'http') {
    try {
      const transport = new LegacyHTTPClientTransport(new URL(transportConfig.url), {
        requestInit: { headers: transportConfig.headers },
      })
      return createLegacyClientAdapter(
        await createMCPClient({
          name,
          transport,
          onUncaughtError(error: unknown) {
            console.error('mcp:client:onUncaughtError', error)
          },
        })
      )
    } catch (err) {
      console.error('Streamable HTTP connection failed', err)
      try {
        return createLegacyClientAdapter(
          await createMCPClient({
            name,
            transport: {
              type: 'sse',
              url: transportConfig.url,
              headers: transportConfig.headers,
            },
            onUncaughtError(error: unknown) {
              console.error('mcp:client:onUncaughtError', error)
            },
          })
        )
      } catch (fallbackError) {
        const streamableMessage = err instanceof Error ? err.message : String(err)
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        throw new Error(
          `Streamable HTTP connection failed: ${streamableMessage}\nLegacy SSE fallback failed: ${fallbackMessage}`,
          { cause: err }
        )
      }
    }
  }
  throw new Error('Unknown transport type')
}

function createClient(config: MCPServerConfig, name = 'chatbox-mcp-client'): Promise<MCPClient> {
  if (config.protocolMode === 'auto') {
    return createAutoClient(config.transport, name)
  }
  return createLegacyClient(config.transport, name)
}

export class MCPServer extends Emittery<{ status: MCPServerStatus }> {
  private _status: MCPServerStatus = { state: 'idle' }
  private client?: MCPClient
  private tools?: ToolSet

  constructor(private readonly config: MCPServerConfig) {
    super()
  }

  get status() {
    return this._status
  }

  set status(status: MCPServerStatus) {
    this._status = status
    this.emit('status', status)
  }

  async start() {
    if (this.status.state !== 'idle') {
      return
    }
    this.status = { state: 'starting' }
    try {
      this.client = await createClient(this.config)
      this.tools = await this.client.tools()
    } catch (err) {
      console.error('mcp:client:start', err)
      await this.client?.close().catch(console.error)
      this.client = undefined
      this.tools = undefined
      this.status = { state: 'idle', error: (err as Error).message }
      return
    }
    this.status = { state: 'running' }
  }

  async stop() {
    if (this.status.state !== 'running') {
      return
    }
    this.status = { state: 'stopping' }
    try {
      await this.client?.close()
    } finally {
      this.client = undefined
      this.tools = undefined
      this.status = { state: 'idle' }
    }
  }

  getAvailableTools(): ToolSet {
    if (!this.client || this.status.state !== 'running') {
      return {}
    }
    return this.tools || {}
  }
}

// 根据用户配置管理MCP服务器的实际运行
export const mcpController = {
  servers: new Map<string, { instance: MCPServer; config: MCPServerConfig }>(),
  _statusSubscribers: new Map<string, Set<(status: MCPServerStatus) => void>>(),

  bootstrap(serverConfigs: MCPServerConfig[]) {
    for (const serverConfig of serverConfigs) {
      if (serverConfig.enabled) {
        void this.startServer(serverConfig)
      }
    }
  },

  async startServer(serverConfig: MCPServerConfig) {
    if (!serverConfig.enabled) {
      return
    }
    const server = new MCPServer(serverConfig)
    this.servers.set(serverConfig.id, { instance: server, config: serverConfig })

    // 如果有订阅者，重新连接他们
    const subscribers = this._statusSubscribers.get(serverConfig.id)
    if (subscribers) {
      subscribers.forEach((subscriber) => {
        server.on('status', subscriber)
      })
    }

    await server.start()
  },

  async stopServer(id: string) {
    const server = this.servers.get(id)
    this.servers.delete(id)
    await server?.instance.stop()
    server?.instance.clearListeners()
  },

  async updateServer(serverConfig: MCPServerConfig) {
    if (!serverConfig.enabled) {
      await this.stopServer(serverConfig.id)
      return
    }
    const server = this.servers.get(serverConfig.id)
    if (!server) {
      await this.startServer(serverConfig)
      return
    }
    if (
      isEqual(server.config.transport, serverConfig.transport) &&
      server.config.protocolMode === serverConfig.protocolMode
    ) {
      server.config = serverConfig
    } else {
      await this.stopServer(serverConfig.id)
      await this.startServer(serverConfig)
    }
  },

  getServer(id: string): MCPServer | undefined {
    const server = this.servers.get(id)
    return server?.instance
  },

  subscribeToServerStatus(id: string, callback: (status: MCPServerStatus) => void) {
    let subscribers = this._statusSubscribers.get(id)
    if (!subscribers) {
      subscribers = new Set()
      this._statusSubscribers.set(id, subscribers)
    }
    subscribers.add(callback)

    const server = this.getServer(id)
    if (server) {
      server.on('status', callback)
      callback(server.status)
    }

    return () => {
      server?.off('status', callback)
      subscribers.delete(callback)
    }
  },

  getAvailableTools(): ToolSet {
    const toolSet: ToolSet = {}
    for (const { instance, config } of this.servers.values()) {
      const mcpTools = instance.getAvailableTools()
      for (const [toolName, tool] of Object.entries(mcpTools)) {
        const rawExecute = tool.execute?.bind(tool)
        toolSet[normalizeToolName(config.name, toolName)] = {
          ...tool,
          execute: async (args, options) => {
            try {
              return await rawExecute?.(args, options)
            } catch (err) {
              // 返回而非抛出，否则会导致流程中断。
              // 必须返回可 JSON 序列化的结构：直接返回原始 Error/MCPClientError 会把脏数据写进对话历史，
              // 下次组装 ModelMessage[] 时 AI SDK 本地校验会抛 AI_InvalidPromptError，导致请求发不出去。
              return {
                isError: true,
                content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
              }
            }
          },
        }
      }
    }
    return toolSet
  },
}

const SERVER_NAME_REGEX = /^[A-Za-z0-9_-]+$/

function normalizeToolName(serverName: string, toolName: string) {
  serverName = serverName.replace(/\s+/g, '_')
  if (SERVER_NAME_REGEX.test(serverName)) {
    return `mcp__${serverName.toLowerCase()}__${toolName}`
  }
  return `mcp__${toolName}`
}
