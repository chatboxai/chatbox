import { expect, it } from 'vitest'
import { MCPServer } from './controller'

it.each(['auto', 'legacy'] as const)(
  'redacts credentials from %s tool refresh errors and retains the previous tools',
  async (protocolMode) => {
    let lists = 0
    const server = new MCPServer(
      {
        id: 'fixture',
        name: 'Fixture',
        enabled: true,
        protocolMode,
        transport: {
          type: 'http',
          url: 'https://example.test/mcp?token=synthetic-query',
          headers: { Authorization: 'Bearer synthetic-header' },
        },
      },
      {
        mobile: true,
        fetch: async (_input, init) => {
          if (init?.method !== 'POST') return new Response(null, { status: 405 })
          const message = JSON.parse(String(init.body)) as { id?: number; method: string }
          if (message.id === undefined) return new Response(null, { status: 202 })
          if (message.method === 'tools/list' && ++lists > 1) {
            return Response.json({
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: 'Rejected Bearer synthetic-header at ?token=synthetic-query',
              },
            })
          }
          const result =
            message.method === 'server/discover'
              ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
              : message.method === 'initialize'
                ? {
                    protocolVersion: '2025-11-25',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'Fixture', version: '1.0.0' },
                  }
                : { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] }
          return Response.json({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              ...result,
              ...(protocolMode === 'auto' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
            },
          })
        },
      }
    )
    try {
      await server.start()
      expect(server.status.state).toBe('running')
      expect(Object.keys(server.getAvailableTools())).toEqual(['echo'])
      await expect(server.refreshTools()).rejects.toThrow('Rejected [redacted] at ?token=[redacted]')
      expect(Object.keys(server.getAvailableTools())).toEqual(['echo'])
      expect(server.status.state).toBe('running')
    } finally {
      await server.stop()
    }
  }
)
