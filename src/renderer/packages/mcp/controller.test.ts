import {
  DEFAULT_REQUEST_TIMEOUT_MSEC,
  type JSONRPCMessage,
  type Transport,
  type TransportSendOptions,
} from '@modelcontextprotocol/client'
import { asSchema, jsonSchema } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '@/stores/settingsStore'
import { MCPServer, mcpController } from './controller'
import { IPCStdioTransport } from './ipc-stdio-transport'

interface RecordedRequest {
  url: string
  method: string
  body?: Record<string, unknown>
  headers: Headers
}

function recordRequest(input: RequestInfo | URL, init?: RequestInit): RecordedRequest {
  const url = input instanceof Request ? input.url : String(input)
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
  return { url, method, body, headers }
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
                    $schema: 'http://json-schema.org/draft-06/schema#',
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text'],
                  },
                },
                {
                  name: 'unsupported',
                  inputSchema: { type: 'object', $schema: 'https://example.com/unsupported-dialect' },
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
    expect(Object.keys(server.getAvailableTools())).toEqual(['echo', 'unsupported'])
    const unsupported = asSchema(server.getAvailableTools().unsupported.inputSchema)
    expect((await unsupported.validate?.({}))?.success).toBe(true)
    const echoSchema = asSchema(server.getAvailableTools().echo.inputSchema)
    expect(echoSchema.jsonSchema).not.toHaveProperty('additionalProperties')
    expect((await echoSchema.validate?.({ text: 'hello', dynamic: true }))?.success).toBe(true)
    expect((await echoSchema.validate?.({ text: 42 }))?.success).toBe(false)
    expect((await echoSchema.validate?.({ typo: 'hello' }))?.success).toBe(false)
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
                    $schema: 'http://json-schema.org/draft-06/schema#',
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text'],
                  },
                },
                {
                  name: 'unsupported',
                  inputSchema: { type: 'object', $schema: 'https://example.com/unsupported-dialect' },
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
    expect(Object.keys(server.getAvailableTools())).toEqual(['echo', 'unsupported'])
    const unsupported = asSchema(server.getAvailableTools().unsupported.inputSchema)
    expect((await unsupported.validate?.({}))?.success).toBe(true)
    const echoSchema = asSchema(server.getAvailableTools().echo.inputSchema)
    expect(echoSchema.jsonSchema).not.toHaveProperty('additionalProperties')
    expect((await echoSchema.validate?.({ text: 'hello', dynamic: true }))?.success).toBe(true)
    expect((await echoSchema.validate?.({ text: 42 }))?.success).toBe(false)
    expect((await echoSchema.validate?.({ typo: 'hello' }))?.success).toBe(false)
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

  it('cancels only the requested tool on a modern mobile HTTP connection', async () => {
    const pending = new Map<string, { signal: AbortSignal; finish: () => void }>()
    const requests: RecordedRequest[] = []
    const fetchImpl: typeof fetch = (input, init) => {
      const request = recordRequest(input, init)
      requests.push(request)
      const body = request.body
      if (!body) return Promise.resolve(new Response(null, { status: 405 }))
      if (body.method === 'server/discover') {
        return Promise.resolve(
          modernResponse(body, { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }, { cacheable: true })
        )
      }
      if (body.method === 'tools/list') {
        return Promise.resolve(
          modernResponse(
            body,
            { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] },
            { cacheable: true }
          )
        )
      }
      if (body.method === 'tools/call') {
        const params = body.params as { arguments: { text: string } }
        const text = params.arguments.text
        const signal = init?.signal
        if (!signal) throw new Error('Expected request cancellation signal')
        return new Promise<Response>((resolve, reject) => {
          const abort = () => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          pending.set(text, {
            signal,
            finish: () => {
              signal.removeEventListener('abort', abort)
              resolve(modernResponse(body, { content: [{ type: 'text', text }] }))
            },
          })
        })
      }
      return Promise.resolve(new Response(null, { status: 500 }))
    }
    const server = new MCPServer(
      {
        id: 'modern-mobile-cancel',
        name: 'Modern mobile cancellation',
        enabled: true,
        protocolMode: 'auto',
        transport: { type: 'http', url: 'https://modern.example.com/mcp' },
      },
      { mobile: true, fetch: fetchImpl }
    )
    try {
      await server.start()
      expect(server.status).toEqual({ state: 'running' })
      const execute = server.getAvailableTools().echo.execute
      if (!execute) throw new Error('Missing executable tool')
      const controller = new AbortController()
      const cancelled = expect(
        execute({ text: 'cancel' }, { toolCallId: 'cancel', messages: [], abortSignal: controller.signal })
      ).rejects.toThrow()
      const retained = Promise.resolve(execute({ text: 'keep' }, { toolCallId: 'keep', messages: [] }))
      const retainedResult = expect(retained).resolves.toMatchObject({ content: [{ type: 'text', text: 'keep' }] })
      await expect.poll(() => pending.size).toBe(2)
      controller.abort()
      await cancelled
      expect(pending.get('cancel')?.signal.aborted).toBe(true)
      expect(pending.get('keep')?.signal.aborted).toBe(false)
      expect(server.status).toEqual({ state: 'running' })
      pending.get('keep')?.finish()
      await retainedResult
      expect(requests.filter((request) => request.body?.method === 'tools/call')).toHaveLength(2)
      expect(requests.some((request) => request.body?.method === 'notifications/cancelled')).toBe(false)
    } finally {
      await server.stop()
    }
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
    // A 401 additionally triggers OAuth discovery (.well-known lookups and a registration attempt);
    // the MCP endpoint itself must only see the discover probe, never an SSE fallback.
    const endpointRequests = requests.filter((request) => request.url === `https://http-${status}.example.com/mcp`)
    expect(endpointRequests).toHaveLength(1)
    expect(endpointRequests[0].body?.method).toBe('server/discover')
    expect(endpointRequests[0].method).toBe('POST')
  })

  it('falls back to the initialize handshake when the probe is rejected with 401 despite a valid token', async () => {
    const origin = 'https://probe-401.example.com'
    const serverId = 'probe-401-http'
    settingsStore.getState().setSettings((draft) => {
      draft.mcp.oauth = {
        [serverId]: {
          clientInformation: { client_id: 'chatbox-client' },
          tokens: { access_token: 'stale-token', refresh_token: 'refresh-1', token_type: 'bearer' },
        },
      }
    })

    const requests: RecordedRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const request = recordRequest(input, init)
        requests.push(request)
        const url = new URL(request.url)

        if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
          return Response.json({ resource: `${origin}/mcp`, authorization_servers: [origin] })
        }
        if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
          return Response.json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
          })
        }
        if (url.pathname === '/token') {
          return Response.json({ access_token: 'fresh-token', refresh_token: 'refresh-2', token_type: 'bearer' })
        }
        if (request.method === 'GET') {
          return new Response(null, { status: 405, statusText: 'Method Not Allowed' })
        }

        const body = request.body
        // Mirrors gateways that route by JSON-RPC method and never see the bearer on the probe
        if (body?.method === 'server/discover') {
          return Response.json({ error: 'Authorization header is missing' }, { status: 401 })
        }
        if (request.headers.get('authorization') !== 'Bearer fresh-token') {
          return Response.json({ error: 'Access token validation failed' }, { status: 401 })
        }
        if (body?.method === 'initialize') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'probe-401-fixture', version: '1.0.0' },
            },
          })
        }
        if (body?.method === 'notifications/initialized') {
          return new Response(null, { status: 202 })
        }
        if (body?.method === 'tools/list') {
          return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [] } })
        }
        return new Response(null, { status: 500 })
      })
    )

    const server = new MCPServer({
      id: serverId,
      name: 'Probe 401 HTTP',
      enabled: true,
      protocolMode: 'auto',
      transport: { type: 'http', url: `${origin}/mcp` },
    })

    try {
      await server.start()

      expect(server.status).toEqual({ state: 'running' })
      const rpcMethods = requests.filter((request) => request.body?.method).map((request) => request.body?.method)
      expect(rpcMethods).toEqual([
        'server/discover',
        'server/discover',
        'initialize',
        'notifications/initialized',
        'tools/list',
      ])
      expect(requests.some((request) => request.url === `${origin}/token`)).toBe(true)
      expect(settingsStore.getState().mcp.oauth?.[serverId]?.tokens?.access_token).toBe('fresh-token')
      await server.stop()
    } finally {
      settingsStore.getState().setSettings((draft) => {
        draft.mcp.oauth = undefined
      })
    }
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
    expect(server.status.error).toContain('Legacy SSE fallback failed: SSE error: Non-200 status code (405)')
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

describe('mobile MCP lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects colliding tool names instead of replacing an enabled server tool', async () => {
    const configs = ['collision-a', 'collision-b'].map((id) => ({
      id,
      name: 'Same Name',
      enabled: true,
      transport: { type: 'http' as const, url: 'https://native.example/mcp' },
    }))
    for (const config of configs) {
      const instance = new MCPServer(config, { mobile: true })
      vi.spyOn(instance, 'getAvailableTools').mockReturnValue({ echo: { inputSchema: jsonSchema({ type: 'object' }) } })
      mcpController.servers.set(config.id, { config, instance })
    }
    try {
      expect(() => mcpController.getAvailableTools(new Set(configs.map(({ id }) => id)))).toThrow(
        'MCP tool name collision: mcp__same_name__echo'
      )
      expect(Object.keys(mcpController.getAvailableTools(new Set(['collision-a'])))).toEqual(['mcp__same_name__echo'])
    } finally {
      await Promise.all(configs.map(({ id }) => mcpController.stopServer(id)))
    }
  })

  it('rejects stdio before opening desktop IPC', async () => {
    const create = vi.spyOn(IPCStdioTransport, 'create')
    const server = new MCPServer(
      { id: 'mobile-stdio', name: 'Local', enabled: true, transport: { type: 'stdio', command: 'npx', args: [] } },
      { mobile: true }
    )
    await server.start()
    expect(server.status.error).toContain('only available on desktop')
    expect(create).not.toHaveBeenCalled()
  })

  it.each(['auto', 'legacy'] as const)(
    'uses injected native fetch and does not start OAuth for %s',
    async (protocolMode) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 401 }))
      const browser = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('browser fetch must not run'))
      const server = new MCPServer(
        {
          id: 'mobile-http',
          name: 'Remote',
          enabled: true,
          protocolMode,
          transport: { type: 'http', url: 'https://native.example/mcp', headers: { authorization: 'Bearer static' } },
        },
        { mobile: true, fetch }
      )
      await server.start()
      expect(server.status.state).toBe('idle')
      expect(fetch).toHaveBeenCalled()
      expect(browser).not.toHaveBeenCalled()
      expect(fetch.mock.calls.every(([input]) => String(input).startsWith('https://native.example/'))).toBe(true)
    }
  )

  it('shares concurrent starts and settles when stopped before initialization finishes', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          })
        })
    )
    const server = new MCPServer(
      {
        id: 'starting',
        name: 'Starting',
        enabled: true,
        protocolMode: 'legacy',
        transport: { type: 'http', url: 'https://native.example/mcp' },
      },
      { mobile: true, fetch }
    )
    const first = server.start()
    expect(server.start()).toBe(first)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    await server.stop()
    await first
    expect(server.status).toEqual({ state: 'idle' })
    expect(server.getAvailableTools()).toEqual({})
  })

  it('keeps a shared initialization for a caller without a signal when another caller aborts', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => undefined))
    const server = new MCPServer(
      { id: 'joined', name: 'Joined', enabled: true, transport: { type: 'http', url: 'https://native.example/mcp' } },
      { mobile: true, fetch }
    )
    const first = server.start()
    const controller = new AbortController()
    const second = server.start({ signal: controller.signal })
    controller.abort()
    await second
    expect(server.status.state).toBe('starting')
    await server.stop()
    await first
    expect(server.status.state).toBe('idle')
    expect(server.getAvailableTools()).toEqual({})
  })

  it('bounds initialization even when a transport ignores cancellation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => undefined))
    const server = new MCPServer(
      { id: 'timeout', name: 'Timeout', enabled: true, transport: { type: 'http', url: 'https://native.example/mcp' } },
      { mobile: true, fetch }
    )
    await server.start({ timeoutMs: 20 })
    expect(server.status.state).toBe('idle')
    expect(server.status.error).toContain('timed out')
  })
})
