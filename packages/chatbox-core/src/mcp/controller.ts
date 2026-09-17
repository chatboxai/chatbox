import { createMCPClient } from '@ai-sdk/mcp'
import {
  type JSONObject,
  StreamableHTTPClientTransport as NegotiatingHTTPClientTransport,
  Client as NegotiatingMCPClient,
  SSEClientTransport as NegotiatingSSEClientTransport,
  type Transport as NegotiatingTransport,
  SdkHttpError,
  type StreamableHTTPClientTransportOptions,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import { SSEClientTransport as LegacySSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport as LegacyHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { formatMCPError } from './error'
import { mcpToolSchema } from './mcp-tool-schema'
import { type JSONValue as AIToolJSONValue, dynamicTool, type ToolSet } from 'ai'
import Emittery from 'emittery'
import { isEqual } from 'lodash'
import { createMCPFetch, type MCPAuthorizationProvider, type MCPPlatformDependencies } from './platform'
import type { MCPProtocolMode, MCPServerConfig, MCPServerStatus } from './types'

type TransportConfig = MCPServerConfig['transport']
type ManagedTransport = { close(): Promise<void>; onclose?: () => void; onerror?: (error: Error) => void }
type RegisterTransport = (transport: ManagedTransport) => void
type LegacyMCPClient = Awaited<ReturnType<typeof createMCPClient>>

interface MCPClient {
  tools(): Promise<ToolSet>
  close(): Promise<void>
}

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const reason = 'reason' in signal ? signal.reason : undefined
    throw reason ?? createAbortError('Aborted')
  }
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

function closeClientOnAbort(client: Pick<MCPClient, 'close'>, signal?: AbortSignal): () => void {
  // Legacy cancellation is connection-scoped; close it to release native I/O.
  const cancel = () => {
    void client.close().catch(() => undefined)
  }
  signal?.addEventListener('abort', cancel, { once: true })
  return () => signal?.removeEventListener('abort', cancel)
}

function createNegotiatingClientAdapter(
  client: NegotiatingMCPClient,
  closeOnAbort = false,
  report: (message: string) => void = () => undefined
): MCPClient {
  return {
    async tools() {
      const { tools: definitions } = await client.listTools()
      const tools: ToolSet = {}

      for (const definition of definitions) {
        const inputSchema = {
          ...definition.inputSchema,
          properties: definition.inputSchema.properties ?? {},
        }
        tools[definition.name] = dynamicTool({
          description: definition.description,
          title: definition.title ?? definition.annotations?.title,
          inputSchema: mcpToolSchema(inputSchema as Parameters<typeof mcpToolSchema>[0], (message) =>
            report(`${definition.name}: ${message}`)
          ),
          execute: async (args, options) => {
            throwIfAborted(options.abortSignal)
            const removeAbortListener = closeOnAbort ? closeClientOnAbort(client, options.abortSignal) : undefined
            try {
              const result = await client.callTool(
                {
                  name: definition.name,
                  arguments: args as JSONObject,
                },
                { signal: options.abortSignal }
              )
              return { ...result, isError: result.isError ?? false }
            } finally {
              removeAbortListener?.()
            }
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

function createLegacyClientAdapter(
  client: LegacyMCPClient,
  closeOnAbort = false,
  report: (message: string) => void = () => undefined
): MCPClient {
  return {
    async tools() {
      const definitions = await client.listTools()
      const tools = client.toolsFromDefinitions(definitions) as unknown as ToolSet
      for (const definition of definitions.tools) {
        const execute = tools[definition.name].execute
        if (closeOnAbort && execute) {
          tools[definition.name].execute = async (args, options) => {
            throwIfAborted(options.abortSignal)
            const removeAbortListener = closeClientOnAbort(client, options.abortSignal)
            try {
              return await execute(args, options)
            } finally {
              removeAbortListener()
            }
          }
        }
        tools[definition.name].inputSchema = mcpToolSchema(
          {
            ...definition.inputSchema,
            properties: definition.inputSchema.properties ?? {},
          } as Parameters<typeof mcpToolSchema>[0],
          (message) => report(`${definition.name}: ${message}`)
        )
      }
      return tools
    },
    close() {
      return client.close()
    },
  }
}

async function connectNegotiatingClient(
  transport: NegotiatingTransport,
  name: string,
  protocolMode: MCPProtocolMode,
  closeLegacyOnAbort = false,
  report?: (message: string) => void
): Promise<MCPClient> {
  const client = new NegotiatingMCPClient({ name, version: '1.0.0' }, { versionNegotiation: { mode: protocolMode } })
  try {
    await client.connect(transport)
    return createNegotiatingClientAdapter(client, closeLegacyOnAbort && client.getProtocolEra() === 'legacy', report)
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}

type HttpTransportOptions = StreamableHTTPClientTransportOptions & { authProvider?: MCPAuthorizationProvider }

async function connectStreamableHttpClient(
  url: URL,
  options: HttpTransportOptions,
  name: string,
  protocolMode: MCPProtocolMode = 'auto',
  register: RegisterTransport = () => undefined,
  closeLegacyOnAbort = false,
  report?: (message: string) => void
): Promise<MCPClient> {
  const transport = new NegotiatingHTTPClientTransport(url, options)
  register(transport)
  try {
    return await connectNegotiatingClient(transport, name, protocolMode, closeLegacyOnAbort, report)
  } catch (error) {
    if (error instanceof SdkHttpError && error.status === 401 && protocolMode === 'auto') {
      // Some gateways reject the `server/discover` negotiation probe with 401 even though the bearer
      // token is valid. Skip the probe and open the session with the `initialize` handshake instead.
      return connectStreamableHttpClient(url, options, name, 'legacy', register, closeLegacyOnAbort, report)
    }
    if (!(error instanceof UnauthorizedError)) {
      throw error
    }
    // The SDK has already discovered the authorization server, registered this client and
    // opened the browser. Wait for the redirect, exchange the code, then connect with the token.
    const pendingCallback = options.authProvider?.waitForAuthorizationCallback()
    if (!pendingCallback) {
      throw error
    }
    const { code, iss } = await pendingCallback
    await transport.finishAuth(code, iss)
    return connectStreamableHttpClient(url, options, name, protocolMode, register, closeLegacyOnAbort, report)
  }
}

async function createAutoClient(
  config: MCPServerConfig,
  name: string,
  interactive: boolean,
  dependencies: MCPPlatformDependencies,
  register: RegisterTransport
): Promise<MCPClient> {
  const transportConfig = config.transport
  if (transportConfig.type === 'stdio') {
    const transport = await dependencies.createStdioTransport?.(transportConfig)
    if (!transport) throw new Error('Local MCP transport is not available')
    register(transport)
    return connectNegotiatingClient(transport, name, 'auto', false, dependencies.reportSchemaWarning)
  }

  const url = new URL(transportConfig.url)
  const transportOptions: HttpTransportOptions = {
    requestInit: { headers: transportConfig.headers },
    authProvider: dependencies.createOAuthProvider?.(config, interactive),
    fetch: dependencies.fetch && createMCPFetch(transportConfig.url, dependencies.fetch),
    // Vendors commonly publish an `issuer` that differs from the advertised authorization server
    // URL (for example the bare origin of a path-scoped server), which the RFC 8414 §3.3 echo
    // check rejects. Compatibility with those servers matters more than this check here.
    skipIssuerMetadataValidation: true,
  }
  try {
    return await connectStreamableHttpClient(
      url,
      transportOptions,
      name,
      'auto',
      register,
      dependencies.mobile,
      dependencies.reportSchemaWarning
    )
  } catch (error) {
    if (!(error instanceof SdkHttpError) || (error.status !== 404 && error.status !== 405)) {
      throw error
    }

    console.error('Streamable HTTP connection failed, trying legacy SSE', formatMCPError(error, transportConfig))
    try {
      const fallbackTransport = new NegotiatingSSEClientTransport(url, transportOptions)
      register(fallbackTransport)
      return await connectNegotiatingClient(
        fallbackTransport,
        name,
        'legacy',
        dependencies.mobile,
        dependencies.reportSchemaWarning
      )
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

async function createLegacyClient(
  transportConfig: TransportConfig,
  name: string,
  dependencies: MCPPlatformDependencies,
  register: RegisterTransport
): Promise<MCPClient> {
  if (transportConfig.type === 'stdio') {
    const transport = await dependencies.createStdioTransport?.(transportConfig)
    if (!transport) throw new Error('Local MCP transport is not available')
    register(transport)
    let errorMessage = ''
    try {
      return createLegacyClientAdapter(
        await createMCPClient({
          name,
          transport,
          onUncaughtError(error: unknown) {
            console.error('mcp:client:onUncaughtError', formatMCPError(error, transportConfig))
            errorMessage += formatMCPError(error, transportConfig)
          },
        }),
        false,
        dependencies.reportSchemaWarning
      )
    } catch (err) {
      transport
        .close()
        .catch((error: unknown) => console.error('MCP close failed', formatMCPError(error, transportConfig)))
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
        fetch: dependencies.fetch && createMCPFetch(transportConfig.url, dependencies.fetch),
      })
      register(transport)
      return createLegacyClientAdapter(
        await createMCPClient({
          name,
          transport,
          onUncaughtError(error: unknown) {
            console.error('mcp:client:onUncaughtError', formatMCPError(error, transportConfig))
          },
        }),
        dependencies.mobile,
        dependencies.reportSchemaWarning
      )
    } catch (err) {
      const status = err && typeof err === 'object' && 'code' in err ? err.code : undefined
      if (dependencies.mobile && status !== 404 && status !== 405) throw err
      console.error('Streamable HTTP connection failed', formatMCPError(err, transportConfig))
      try {
        const fallbackTransport = new LegacySSEClientTransport(new URL(transportConfig.url), {
          requestInit: { headers: transportConfig.headers },
          fetch: dependencies.fetch && createMCPFetch(transportConfig.url, dependencies.fetch),
        })
        register(fallbackTransport)
        return createLegacyClientAdapter(
          await createMCPClient({
            name,
            transport: fallbackTransport,
            onUncaughtError(error: unknown) {
              console.error('mcp:client:onUncaughtError', formatMCPError(error, transportConfig))
            },
          }),
          dependencies.mobile,
          dependencies.reportSchemaWarning
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

function createClient(
  config: MCPServerConfig,
  interactive: boolean,
  dependencies: MCPPlatformDependencies,
  register: RegisterTransport,
  name = 'chatbox-mcp-client'
): Promise<MCPClient> {
  if (dependencies.mobile && config.transport.type === 'stdio') {
    return Promise.reject(new Error('Local MCP servers are only available on desktop'))
  }
  if (config.protocolMode === 'auto') return createAutoClient(config, name, interactive, dependencies, register)
  return createLegacyClient(config.transport, name, dependencies, register)
}

export interface MCPServerStartOptions {
  /** Allow an OAuth browser round trip. Defaults to true; app bootstrap passes false. */
  interactive?: boolean
  signal?: AbortSignal
  timeoutMs?: number
}

type MCPStartup = { promise: Promise<void>; waiters: Set<symbol> }

export class MCPServer extends Emittery<{ status: MCPServerStatus }> {
  private _status: MCPServerStatus = { state: 'idle' }
  private client?: MCPClient
  private tools?: ToolSet
  private starting?: MCPStartup
  private generation = 0
  private cancelStart?: () => void

  constructor(
    private readonly config: MCPServerConfig,
    private readonly dependencies: MCPPlatformDependencies
  ) {
    super()
  }

  get status() {
    return this._status
  }
  set status(status: MCPServerStatus) {
    this._status = status
    void this.emit('status', status)
  }

  private waitForStart(starting: MCPStartup, signal?: AbortSignal): Promise<void> {
    const waiter = Symbol()
    starting.waiters.add(waiter)
    if (!signal) {
      const release = () => {
        starting.waiters.delete(waiter)
      }
      void starting.promise.then(release, release)
      return starting.promise
    }
    return new Promise<void>((resolve, reject) => {
      const release = () => {
        starting.waiters.delete(waiter)
        signal.removeEventListener('abort', cancel)
      }
      const cancel = () => {
        release()
        if (starting.waiters.size === 0 && this.starting === starting) void this.stop()
        resolve()
      }
      signal.addEventListener('abort', cancel, { once: true })
      void starting.promise.then(
        () => {
          release()
          resolve()
        },
        (error: unknown) => {
          release()
          reject(error)
        }
      )
      if (signal.aborted) cancel()
    })
  }

  start(options: MCPServerStartOptions = {}): Promise<void> {
    if (options.signal?.aborted) return Promise.resolve()
    if (this.starting) return this.waitForStart(this.starting, options.signal)
    if (this.status.state !== 'idle') return Promise.resolve()
    const generation = ++this.generation
    const transports = new Set<ManagedTransport>()
    const cancelled = new AbortController()
    const register: RegisterTransport = (transport) => {
      if (cancelled.signal.aborted) void transport.close().catch(() => undefined)
      else transports.add(transport)
    }
    const cancel = () => {
      cancelled.abort()
      for (const transport of transports) void transport.close().catch(() => undefined)
      transports.clear()
    }
    this.cancelStart = cancel
    const timer = setTimeout(cancel, options.timeoutMs ?? (this.dependencies.mobile ? 20_000 : 300_000))
    this.status = { state: 'starting' }
    const task = async () => {
      let created: MCPClient | undefined
      try {
        const aborted = new Promise<never>((_, reject) => {
          if (cancelled.signal.aborted) reject(createAbortError('MCP connection cancelled or timed out'))
          else
            cancelled.signal.addEventListener(
              'abort',
              () => reject(createAbortError('MCP connection cancelled or timed out')),
              { once: true }
            )
        })
        const connecting = (async () => {
          if (cancelled.signal.aborted) throw createAbortError('Aborted')
          created = await createClient(this.config, options.interactive ?? true, this.dependencies, register)
          if (cancelled.signal.aborted || generation !== this.generation) {
            await created.close()
            throw createAbortError('Aborted')
          }
          const tools = await created.tools()
          if (cancelled.signal.aborted || generation !== this.generation) {
            await created.close()
            throw createAbortError('Aborted')
          }
          this.client = created
          this.tools = tools
          const disconnected = () => {
            if (generation !== this.generation || this.status.state !== 'running') return
            void this.stop()
            this.status = { state: 'idle', error: 'MCP connection interrupted. Pending tool results may be unknown.' }
          }
          for (const transport of transports) {
            const onclose = transport.onclose
            const onerror = transport.onerror
            transport.onclose = () => {
              onclose?.()
              disconnected()
            }
            transport.onerror = (error) => {
              onerror?.(error)
              disconnected()
            }
          }
        })()
        await Promise.race([connecting, aborted])
        if (generation === this.generation) this.status = { state: 'running' }
      } catch (error) {
        cancel()
        void created?.close().catch(() => undefined)
        if (generation === this.generation) {
          this.client = undefined
          this.tools = undefined
          this.status = { state: 'idle', error: formatMCPError(error, this.config.transport) }
        }
      } finally {
        clearTimeout(timer)
        if (generation === this.generation) {
          this.starting = undefined
          this.cancelStart = undefined
        }
      }
    }
    this.starting = { promise: task(), waiters: new Set() }
    return this.waitForStart(this.starting, options.signal)
  }

  async stop() {
    ++this.generation
    this.cancelStart?.()
    this.cancelStart = undefined
    this.starting = undefined
    const client = this.client
    this.client = undefined
    this.tools = undefined
    this.status = { state: 'idle' }
    await client?.close().catch(() => undefined)
  }

  getAvailableTools(): ToolSet {
    if (!this.client || this.status.state !== 'running') {
      return {}
    }
    return this.tools || {}
  }

  /** Re-lists tools from the connected server so a changed tool set is picked up without reconnecting. */
  async refreshTools(): Promise<ToolSet> {
    if (!this.client || this.status.state !== 'running') {
      throw new Error('MCP server is not running')
    }
    const client = this.client
    const tools = await client.tools().catch((error: unknown) => {
      throw new Error(formatMCPError(error, this.config.transport))
    })
    if (this.client !== client || this.status.state !== 'running') throw new Error('MCP connection changed')
    this.tools = tools
    return tools
  }
}

// 根据用户配置管理MCP服务器的实际运行
export function createMCPController(dependencies: MCPPlatformDependencies) {
  return {
    servers: new Map<string, { instance: MCPServer; config: MCPServerConfig }>(),
    _statusSubscribers: new Map<string, Set<(status: MCPServerStatus) => void>>(),

    bootstrap(serverConfigs: MCPServerConfig[]) {
      if (dependencies.mobile) return
      for (const serverConfig of serverConfigs) {
        if (serverConfig.enabled) {
          void this.startServer(serverConfig, { interactive: false })
        }
      }
    },

    async startServer(serverConfig: MCPServerConfig, options?: MCPServerStartOptions) {
      if (!serverConfig.enabled) {
        return
      }
      const existing = this.servers.get(serverConfig.id)
      if (existing && isEqual(existing.config, serverConfig)) return existing.instance.start(options)
      if (existing) {
        existing.instance.clearListeners()
        void existing.instance.stop()
      }
      const server = new MCPServer(serverConfig, dependencies)
      this.servers.set(serverConfig.id, { instance: server, config: serverConfig })

      // 如果有订阅者，重新连接他们
      const subscribers = this._statusSubscribers.get(serverConfig.id)
      if (subscribers) {
        subscribers.forEach((subscriber) => {
          server.on('status', subscriber)
        })
      }

      await server.start(options)
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
        void this.stopServer(serverConfig.id)
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
        this.getServer(id)?.off('status', callback)
        subscribers.delete(callback)
      }
    },

    getAvailableTools(serverIds?: ReadonlySet<string>): ToolSet {
      const toolSet: ToolSet = {}
      for (const { instance, config } of this.servers.values()) {
        if (serverIds && !serverIds.has(config.id)) continue
        const mcpTools = instance.getAvailableTools()
        for (const [toolName, tool] of Object.entries(mcpTools)) {
          const rawExecute = tool.execute?.bind(tool)
          const name = normalizeToolName(config.name, toolName)
          if (name in toolSet) throw new Error(`MCP tool name collision: ${name}`)
          toolSet[name] = {
            ...tool,
            execute: async (args, options) => {
              try {
                throwIfAborted(options.abortSignal)
                if (instance.status.state !== 'running')
                  throw new Error('MCP connection is unavailable; execution result may be unknown')
                return await rawExecute?.(args, options)
              } catch (err) {
                // 返回而非抛出，否则会导致流程中断。
                // 必须返回可 JSON 序列化的结构：直接返回原始 Error/MCPClientError 会把脏数据写进对话历史，
                // 下次组装 ModelMessage[] 时 AI SDK 本地校验会抛 AI_InvalidPromptError，导致请求发不出去。
                return {
                  isError: true,
                  content: [{ type: 'text', text: formatMCPError(err, config.transport) }],
                }
              }
            },
          }
        }
      }
      return toolSet
    },
  }
}

export type MCPController = ReturnType<typeof createMCPController>

const SERVER_NAME_REGEX = /^[A-Za-z0-9_-]+$/

function normalizeToolName(serverName: string, toolName: string) {
  serverName = serverName.replace(/\s+/g, '_')
  if (SERVER_NAME_REGEX.test(serverName)) {
    return `mcp__${serverName.toLowerCase()}__${toolName}`
  }
  return `mcp__${toolName}`
}
