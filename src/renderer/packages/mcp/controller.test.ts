import {
  DEFAULT_REQUEST_TIMEOUT_MSEC,
  type JSONRPCMessage,
  type Transport,
  type TransportSendOptions,
} from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MCPServer, mcpController } from './controller'
import { IPCStdioTransport } from './ipc-stdio-transport'

interface RecordedRequest {
  method: string
  body?: Record<string, unknown>
  headers: Headers
}

function recordRequest(input: RequestInfo | URL, init?: RequestInit): RecordedRequest {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
  return { method, body, headers }
}

function modernResponse(
  request: Record<string, unknown>,
  result: Record<string, unknown>,
  options: { cacheable?: boolean } = {}
) {
  return Response.json({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      resultType: 'complete',
      ...result,
      ...(options.cacheable ? { ttlMs: 0, cacheScope: 'private' } : {}),
      _meta: {
        'io.modelcontextprotocol/serverInfo': { name: 'modern-fixture', version: '1.0.0' },
      },
    },
  })
}

const CLOSE_TRANSPORT = Symbol('close-transport')

type ScriptedReply = JSONRPCMessage | typeof CLOSE_TRANSPORT | undefined

class ScriptedTransport implements Transport {
  readonly messages: JSONRPCMessage[] = []
  readonly stderr = null
  readonly pid = undefined
  closed = false
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']
  onmessage?: Transport['onmessage']

  constructor(private readonly reply: (message: JSONRPCMessage) => ScriptedReply) {}

  start() {
    return Promise.resolve()
  }

  send(message: JSONRPCMessage, _options?: TransportSendOptions) {
    this.messages.push(message)
    const reply = this.reply(message)
    if (reply === CLOSE_TRANSPORT) {
      queueMicrotask(() => this.onclose?.())
    } else if (reply) {
      queueMicrotask(() => this.onmessage?.(reply))
    }
    return Promise.resolve()
  }

  close() {
    if (this.closed) {
      return Promise.resolve()
    }
    this.closed = true
    this.onclose?.()
    return Promise.resolve()
  }
}

function getRequestMethod(message: JSONRPCMessage): string | undefined {
  return 'method' in message ? message.method : undefined
}

function getRequestId(message: JSONRPCMessage): string | number {
  if (!('id' in message) || message.id === undefined) {
    throw new Error('Expected a JSON-RPC request with an id')
  }
  return message.id
}

function jsonRpcResult(message: JSONRPCMessage, result: Record<string, unknown>): JSONRPCMessage {
  return {
    jsonrpc: '2.0',
    id: getRequestId(message),
    result,
  } as JSONRPCMessage
}

function jsonRpcError(message: JSONRPCMessage, code: number, errorMessage: string): JSONRPCMessage {
  return {
    jsonrpc: '2.0',
    id: getRequestId(message),
    error: { code, message: errorMessage },
  } as JSONRPCMessage
}

function createModernStdioFixture(): ScriptedTransport {
  return new ScriptedTransport((message) => {
    const method = getRequestMethod(message)
    if (method === 'server/discover') {
      return jsonRpcResult(message, {
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        ttlMs: 0,
        cacheScope: 'private',
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: 'modern-stdio', version: '1.0.0' },
        },
      })
    }
    if (method === 'tools/list') {
      return jsonRpcResult(message, {
        resultType: 'complete',
        tools: [],
        ttlMs: 0,
        cacheScope: 'private',
        _meta: {
          'io.modelcontextprotocol/serverInfo': { name: 'modern-stdio', version: '1.0.0' },
        },
      })
    }
    return undefined
  })
}

function createLegacyStdioFixture(): ScriptedTransport {
  return new ScriptedTransport((message) => {
    const method = getRequestMethod(message)
    if (method === 'server/discover') {
      return jsonRpcError(message, -32601, 'Method not found')
    }
    if (method === 'initialize') {
      return jsonRpcResult(message, {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'legacy-stdio', version: '1.0.0' },
      })
    }
    if (method === 'tools/list') {
      return jsonRpcResult(message, { tools: [] })
    }
    return undefined
  })
}

describe('MCPServer HTTP transport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps configurations without protocolMode on the legacy initialize flow', async () => {
    const requests: RecordedRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const request = recordRequest(input, init)
        requests.push(request)

        if (request.method === 'GET') {
          return new Response(null, { status: 405, statusText: 'Method Not Allowed' })
        }

        const body = request.body
        if (body?.method === 'initialize') {
          return Response.json(
            {
              jsonrpc: '2.0',
              id: body.id,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'php-sdk', version: '0.7.0' },
              },
            },
            {
              headers: {
                'mcp-session-id': 'php-sdk-session',
              },
            }
          )
        }

        if (body?.method === 'notifications/initialized') {
          return new Response(null, { status: 202 })
        }

        if (body?.method === 'tools/list') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: [
                {
                  name: 'echo',
                  description: 'Echo the input text',
                  inputSchema: {
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text'],
                  },
                },
              ],
            },
          })
        }

        if (body?.method === 'tools/call') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{ type: 'text', text: 'hello' }],
            },
          })
        }

        return new Response(null, { status: 500 })
      })
    )

    const server = new MCPServer({
      id: 'legacy-builtin',
      name: 'Legacy Builtin',
      enabled: true,
      transport: {
        type: 'http',
        url: 'https://php-sdk.example.com/mcp',
      },
    })

    await server.start()

    expect(server.status).toEqual({ state: 'running' })
    expect(Object.keys(server.getAvailableTools())).toEqual(['echo'])
    const echoResult = await server
      .getAvailableTools()
      .echo.execute?.({ text: 'hello' }, { toolCallId: 'echo-call', messages: [] })
    expect(echoResult).toEqual({
      content: [{ type: 'text', text: 'hello' }],
      isError: false,
    })
    expect(requests[0].body).toMatchObject({
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' },
    })
    expect(requests.map((request) => request.body?.method ?? request.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'GET',
      'tools/list',
      'tools/call',
    ])
    expect(requests.some((request) => request.body?.method === 'server/discover')).toBe(false)
    expect(requests.slice(1).map((request) => request.headers.get('mcp-protocol-version'))).toEqual([
      '2025-11-25',
      '2025-11-25',
      '2025-11-25',
      '2025-11-25',
    ])

    await server.stop()
  })

  it('uses the 2026-07-28 stateless wire for an auto HTTP server', async () => {
    const requests: RecordedRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const request = recordRequest(input, init)
        requests.push(request)
        const body = request.body

        if (body?.method === 'server/discover') {
          return modernResponse(
            body,
            {
              supportedVersions: ['2026-07-28'],
              capabilities: { tools: {} },
            },
            { cacheable: true }
          )
        }

        if (body?.method === 'tools/list') {
          return modernResponse(
            body,
            {
              tools: [
                {
                  name: 'echo',
                  description: 'Echo the input text',
                  inputSchema: {
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text'],
                  },
                },
              ],
            },
            { cacheable: true }
          )
        }

        if (body?.method === 'tools/call') {
          return modernResponse(body, {
            content: [{ type: 'text', text: 'hello-modern' }],
            isError: false,
          })
        }

        return new Response(null, { status: 500 })
      })
    )

    const server = new MCPServer({
      id: 'modern-http',
      name: 'Modern HTTP',
      enabled: true,
      protocolMode: 'auto',
      transport: {
        type: 'http',
        url: 'https://modern.example.com/mcp',
      },
    })

    await server.start()

    expect(server.status).toEqual({ state: 'running' })
    expect(Object.keys(server.getAvailableTools())).toEqual(['echo'])
    const echoResult = await server
      .getAvailableTools()
      .echo.execute?.({ text: 'hello-modern' }, { toolCallId: 'echo-call', messages: [] })
    expect(echoResult).toEqual({
      _meta: {
        'io.modelcontextprotocol/serverInfo': { name: 'modern-fixture', version: '1.0.0' },
      },
      content: [{ type: 'text', text: 'hello-modern' }],
      isError: false,
    })
    const modelOutput = await server.getAvailableTools().echo.toModelOutput?.({
      toolCallId: 'echo-call',
      input: { text: 'hello-modern' },
      output: {
        content: [
          { type: 'text', text: 'hello-modern' },
          { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
          { type: 'resource_link', uri: 'file:///result.txt', name: 'result.txt' },
        ],
      },
    })
    expect(modelOutput).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'hello-modern' },
        { type: 'image-data', data: 'aW1hZ2U=', mediaType: 'image/png' },
        {
          type: 'text',
          text: JSON.stringify({ type: 'resource_link', uri: 'file:///result.txt', name: 'result.txt' }),
        },
      ],
    })
    const structuredModelOutput = await server.getAvailableTools().echo.toModelOutput?.({
      toolCallId: 'structured-call',
      input: { text: 'hello-modern' },
      output: {
        content: [],
        structuredContent: { answer: 42 },
      },
    })
    expect(structuredModelOutput).toEqual({
      type: 'json',
      value: { answer: 42 },
    })
    expect(requests.map((request) => request.body?.method ?? request.method)).toEqual([
      'server/discover',
      'tools/list',
      'tools/call',
    ])

    for (const request of requests) {
      expect(request.headers.get('mcp-protocol-version')).toBe('2026-07-28')
      expect(request.headers.get('mcp-method')).toBe(request.body?.method)
      expect(request.body?.params).toMatchObject({
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'chatbox-mcp-client',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      })
    }
    expect(requests[2].headers.get('mcp-name')).toBe('echo')
    expect(requests.some((request) => request.body?.method === 'initialize')).toBe(false)

    await server.stop()
  })

  it('falls back from discovery to the legacy Streamable HTTP handshake', async () => {
    const requests: RecordedRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const request = recordRequest(input, init)
        requests.push(request)

        if (request.method === 'GET') {
          return new Response(null, { status: 405, statusText: 'Method Not Allowed' })
        }

        const body = request.body
        if (body?.method === 'server/discover') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32601, message: 'Method not found' },
          })
        }

        if (body?.method === 'initialize') {
          return Response.json(
            {
              jsonrpc: '2.0',
              id: body.id,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'legacy-auto-fixture', version: '1.0.0' },
              },
            },
            { headers: { 'mcp-session-id': 'legacy-auto-session' } }
          )
        }

        if (body?.method === 'notifications/initialized') {
          return new Response(null, { status: 202 })
        }

        if (body?.method === 'tools/list') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: { tools: [] },
          })
        }

        return new Response(null, { status: 500 })
      })
    )

    const server = new MCPServer({
      id: 'legacy-auto-http',
      name: 'Legacy Auto HTTP',
      enabled: true,
      protocolMode: 'auto',
      transport: {
        type: 'http',
        url: 'https://legacy-auto.example.com/mcp',
      },
    })

    await server.start()

    expect(server.status).toEqual({ state: 'running' })
    expect(requests.map((request) => request.body?.method ?? request.method)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
      'GET',
      'tools/list',
    ])
    expect(requests[0].headers.get('mcp-protocol-version')).toBe('2026-07-28')
    expect(requests[0].headers.get('mcp-method')).toBe('server/discover')
    expect(requests[1].headers.get('mcp-protocol-version')).toBeNull()
    expect(requests.slice(2).map((request) => request.headers.get('mcp-protocol-version'))).toEqual([
      '2025-11-25',
      '2025-11-25',
      '2025-11-25',
    ])

    await server.stop()
  })

  it.each([
    { status: 401, statusText: 'Unauthorized' },
    { status: 500, statusText: 'Internal Server Error' },
  ])('does not treat HTTP $status as evidence for an SSE fallback', async ({ status, statusText }) => {
    const requests: RecordedRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(recordRequest(input, init))
        return new Response(null, { status, statusText })
      })
    )

    const server = new MCPServer({
      id: `http-error-${status}`,
      name: `HTTP Error ${status}`,
      enabled: true,
      protocolMode: 'auto',
      transport: {
        type: 'http',
        url: `https://http-${status}.example.com/mcp`,
      },
    })

    await server.start()

    expect(server.status.state).toBe('idle')
    expect(server.status.error).toContain(String(status))
    expect(requests).toHaveLength(1)
    expect(requests[0].body?.method).toBe('server/discover')
    expect(requests[0].method).toBe('POST')
  })

  it('preserves the Streamable HTTP error when the legacy SSE fallback also fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return new Response(null, { status: 405, statusText: 'Method Not Allowed' })
        }

        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2099-01-01',
            capabilities: {},
            serverInfo: { name: 'future-server', version: '1.0.0' },
          },
        })
      })
    )

    const server = new MCPServer({
      id: 'future-legacy-server',
      name: 'Future Legacy Server',
      enabled: true,
      transport: {
        type: 'http',
        url: 'https://future.example.com/mcp',
      },
    })

    await server.start()

    expect(server.status.state).toBe('idle')
    expect(server.status.error).toContain(
      "Streamable HTTP connection failed: Server's protocol version is not supported: 2099-01-01"
    )
    expect(server.status.error).toContain('Legacy SSE fallback failed: MCP SSE Transport Error: 405 Method Not Allowed')
  })
})

describe('MCPServer stdio transport', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('negotiates the modern protocol over the IPC stdio transport', async () => {
    const transport = createModernStdioFixture()
    const createTransport = vi
      .spyOn(IPCStdioTransport, 'create')
      .mockResolvedValue(transport as unknown as IPCStdioTransport)
    const server = new MCPServer({
      id: 'modern-stdio',
      name: 'Modern stdio',
      enabled: true,
      protocolMode: 'auto',
      transport: { type: 'stdio', command: 'modern-mcp', args: [] },
    })

    await server.start()

    expect(server.status).toEqual({ state: 'running' })
    expect(createTransport).toHaveBeenCalledTimes(1)
    expect(transport.messages.map(getRequestMethod)).toEqual(['server/discover', 'tools/list'])
    const discover = transport.messages[0]
    expect('params' in discover ? discover.params : undefined).toMatchObject({
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': {
          name: 'chatbox-mcp-client',
          version: '1.0.0',
        },
      },
    })

    await server.stop()
  })

  it('falls back to initialize on the same stdio process after Method not found', async () => {
    const transport = createLegacyStdioFixture()
    const createTransport = vi
      .spyOn(IPCStdioTransport, 'create')
      .mockResolvedValue(transport as unknown as IPCStdioTransport)
    const server = new MCPServer({
      id: 'legacy-auto-stdio',
      name: 'Legacy auto stdio',
      enabled: true,
      protocolMode: 'auto',
      transport: { type: 'stdio', command: 'legacy-mcp', args: [] },
    })

    await server.start()

    expect(server.status).toEqual({ state: 'running' })
    expect(createTransport).toHaveBeenCalledTimes(1)
    expect(transport.messages.map(getRequestMethod)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])

    await server.stop()
  })

  it('falls back to initialize when a stdio discovery probe times out', async () => {
    vi.useFakeTimers()
    const transport = new ScriptedTransport((message) => {
      const method = getRequestMethod(message)
      if (method === 'initialize') {
        return jsonRpcResult(message, {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'silent-legacy-stdio', version: '1.0.0' },
        })
      }
      if (method === 'tools/list') {
        return jsonRpcResult(message, { tools: [] })
      }
      return undefined
    })
    vi.spyOn(IPCStdioTransport, 'create').mockResolvedValue(transport as unknown as IPCStdioTransport)
    const server = new MCPServer({
      id: 'silent-legacy-stdio',
      name: 'Silent legacy stdio',
      enabled: true,
      protocolMode: 'auto',
      transport: { type: 'stdio', command: 'silent-legacy-mcp', args: [] },
    })

    const startPromise = server.start()
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MSEC)
    await startPromise

    expect(server.status).toEqual({ state: 'running' })
    expect(transport.messages.map(getRequestMethod)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])

    await server.stop()
    vi.useRealTimers()
  })

  it('closes the transport when listing tools fails after connection', async () => {
    const transport = new ScriptedTransport((message) => {
      const method = getRequestMethod(message)
      if (method === 'server/discover') {
        return jsonRpcResult(message, {
          resultType: 'complete',
          supportedVersions: ['2026-07-28'],
          capabilities: { tools: {} },
          ttlMs: 0,
          cacheScope: 'private',
        })
      }
      if (method === 'tools/list') {
        return jsonRpcError(message, -32603, 'Failed to list tools')
      }
      return undefined
    })
    vi.spyOn(IPCStdioTransport, 'create').mockResolvedValue(transport as unknown as IPCStdioTransport)
    const server = new MCPServer({
      id: 'tool-list-error',
      name: 'Tool list error',
      enabled: true,
      protocolMode: 'auto',
      transport: { type: 'stdio', command: 'broken-mcp', args: [] },
    })

    await server.start()

    expect(server.status.state).toBe('idle')
    expect(server.status.error).toContain('Failed to list tools')
    expect(transport.closed).toBe(true)
  })

  it('surfaces probe-close failure and succeeds when retried explicitly as legacy', async () => {
    const probeTransport = new ScriptedTransport((message) =>
      getRequestMethod(message) === 'server/discover' ? CLOSE_TRANSPORT : undefined
    )
    const legacyTransport = createLegacyStdioFixture()
    const createTransport = vi
      .spyOn(IPCStdioTransport, 'create')
      .mockResolvedValueOnce(probeTransport as unknown as IPCStdioTransport)
      .mockResolvedValueOnce(legacyTransport as unknown as IPCStdioTransport)
    const baseConfig = {
      id: 'probe-close-stdio',
      name: 'Probe-close stdio',
      enabled: true,
      transport: { type: 'stdio' as const, command: 'probe-close-mcp', args: [] },
    }

    const autoServer = new MCPServer({ ...baseConfig, protocolMode: 'auto' })
    await autoServer.start()

    expect(autoServer.status.state).toBe('idle')
    expect(autoServer.status.error?.toLowerCase()).toContain('closed')
    expect(probeTransport.messages.map(getRequestMethod)).toEqual(['server/discover'])

    const legacyServer = new MCPServer({ ...baseConfig, protocolMode: 'legacy' })
    await legacyServer.start()

    expect(legacyServer.status).toEqual({ state: 'running' })
    expect(createTransport).toHaveBeenCalledTimes(2)
    expect(legacyTransport.messages.map(getRequestMethod)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])

    await legacyServer.stop()
  })

  it('restarts a running server when only protocolMode changes', async () => {
    const id = 'protocol-mode-update'
    const autoTransport = createModernStdioFixture()
    const legacyTransport = createLegacyStdioFixture()
    const createTransport = vi
      .spyOn(IPCStdioTransport, 'create')
      .mockResolvedValueOnce(autoTransport as unknown as IPCStdioTransport)
      .mockResolvedValueOnce(legacyTransport as unknown as IPCStdioTransport)
    const transportConfig = { type: 'stdio' as const, command: 'mode-update-mcp', args: [] }

    try {
      await mcpController.startServer({
        id,
        name: 'Mode update',
        enabled: true,
        protocolMode: 'auto',
        transport: transportConfig,
      })
      await mcpController.updateServer({
        id,
        name: 'Mode update',
        enabled: true,
        protocolMode: 'legacy',
        transport: transportConfig,
      })

      expect(createTransport).toHaveBeenCalledTimes(2)
      expect(autoTransport.closed).toBe(true)
      expect(legacyTransport.messages.map(getRequestMethod)).toEqual([
        'initialize',
        'notifications/initialized',
        'tools/list',
      ])
      expect(mcpController.getServer(id)?.status).toEqual({ state: 'running' })
    } finally {
      await mcpController.stopServer(id)
    }
  })
})
