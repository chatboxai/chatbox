import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
import { describe, expect, test } from 'vitest'
import { MCPServer } from './controller'

describe('remote HTTP MCP interoperability', () => {
  test.each(['legacy', 'auto', 'sse', 'auto-sse', 'auto-401'] as const)(
    'initializes, discovers and calls a tool over %s without CORS headers',
    async (mode) => {
      const useSse = mode === 'sse' || mode === 'auto-sse'
      let events: ServerResponse | undefined
      const pendingResponses = new Set<ServerResponse>()
      const methods: string[] = []
      const server = createServer(async (request, response) => {
        if (request.method === 'GET') {
          if (!useSse) {
            response.writeHead(405).end()
            return
          }
          events = response
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          response.write('event: endpoint\ndata: /messages\n\n')
          return
        }
        if (request.method === 'DELETE') {
          response.writeHead(204).end()
          return
        }
        if (useSse && request.url === '/mcp') {
          response.writeHead(404).end()
          return
        }
        request.setEncoding('utf8')
        let body = ''
        for await (const chunk of request) body += chunk
        const message = JSON.parse(body) as { id?: number; method: string; params?: { arguments?: { value: string } } }
        methods.push(message.method)
        expect(request.headers.authorization).toBe('Bearer fixture')
        if (message.id === undefined) {
          response.writeHead(202).end()
          return
        }
        if (message.method === 'server/discover' && mode === 'auto-401') {
          response.writeHead(401).end()
          return
        }
        if (message.method === 'tools/call' && message.params?.arguments?.value === 'wait') {
          pendingResponses.add(response)
          response.once('close', () => pendingResponses.delete(response))
          return
        }
        const result =
          message.method === 'initialize'
            ? {
                protocolVersion: '2025-03-26',
                capabilities: { tools: {} },
                serverInfo: { name: 'fixture', version: '1.0.0' },
              }
            : message.method === 'tools/list'
              ? {
                  tools: [
                    {
                      name: 'echo',
                      description: 'Echo input',
                      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
                    },
                  ],
                }
              : { content: [{ type: 'text', text: message.params?.arguments?.value ?? '' }] }
        const reply = JSON.stringify(
          message.method === 'server/discover'
            ? { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }
            : { jsonrpc: '2.0', id: message.id, result }
        )
        if (useSse) {
          events?.write(`event: message\ndata: ${reply}\n\n`)
          response.writeHead(202).end()
        } else response.writeHead(200, { 'content-type': 'application/json' }).end(reply)
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Fixture missing port')
      const client = new MCPServer(
        {
          id: mode,
          name: mode,
          enabled: true,
          protocolMode: mode.startsWith('auto') ? 'auto' : 'legacy',
          transport: {
            type: 'http',
            url: `http://127.0.0.1:${address.port}/mcp`,
            headers: { Authorization: 'Bearer fixture' },
          },
        },
        { mobile: true, fetch }
      )
      try {
        await client.start({ timeoutMs: 3_000 })
        expect(client.status).toEqual({ state: 'running' })
        const tool = client.getAvailableTools().echo
        if (!tool.execute) throw new Error('Missing executable tool')
        const completed = new AbortController()
        const result = await tool.execute(
          { value: '中文😀' },
          { toolCallId: 'echo-1', messages: [], context: undefined, abortSignal: completed.signal }
        )
        expect(result).toMatchObject({ content: [{ type: 'text', text: '中文😀' }] })
        expect(methods.filter((method) => method === 'tools/call')).toHaveLength(1)
        completed.abort()
        expect(client.status.state).toBe('running')
        await expect(
          tool.execute(
            { value: 'cancelled' },
            { toolCallId: 'cancelled', messages: [], context: undefined, abortSignal: completed.signal }
          )
        ).rejects.toThrow()
        expect(client.status.state).toBe('running')
        expect(methods.filter((method) => method === 'tools/call')).toHaveLength(1)
        const abort = new AbortController()
        const pending = Promise.resolve(
          tool.execute(
            { value: 'wait' },
            { toolCallId: 'pending', messages: [], context: undefined, abortSignal: abort.signal }
          )
        )
        const failed = expect(pending).rejects.toThrow()
        const concurrent = Promise.resolve(
          tool.execute({ value: 'wait' }, { toolCallId: 'concurrent', messages: [], context: undefined })
        ).then(
          () => 'completed',
          () => 'interrupted'
        )
        await expect.poll(() => pendingResponses.size, { timeout: 1_000 }).toBe(2)
        abort.abort()
        await failed
        expect(client.status).toMatchObject({ state: 'idle', error: expect.stringContaining('unknown') })
        expect(client.getAvailableTools()).toEqual({})
        await expect.poll(() => pendingResponses.size, { timeout: 1_000 }).toBe(0)
        expect(await concurrent).toBe('interrupted')
        expect(methods.filter((method) => method === 'tools/call')).toHaveLength(3)

        await client.start({ timeoutMs: 3_000 })
        expect(client.status).toEqual({ state: 'running' })
        expect(methods.filter((method) => method === 'tools/call')).toHaveLength(3)
        const reconnectedTool = client.getAvailableTools().echo
        const reconnected = await reconnectedTool.execute?.(
          { value: 'reconnected' },
          { toolCallId: 'reconnected', messages: [], context: undefined }
        )
        expect(reconnected).toMatchObject({ content: [{ type: 'text', text: 'reconnected' }] })
        expect(methods.filter((method) => method === 'tools/call')).toHaveLength(4)
      } finally {
        await client.stop()
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  )
})
