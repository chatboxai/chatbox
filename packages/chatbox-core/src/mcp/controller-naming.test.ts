import { jsonSchema, type ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { flattenMCPToolGroups } from './controller'
import type { MCPToolGroup } from './types'

function mcpTool(description: string) {
  return { description, inputSchema: jsonSchema({ type: 'object' }), execute: vi.fn() } satisfies ToolSet[string]
}

describe('flattenMCPToolGroups', () => {
  it('suffixes colliding names by server id, independent of server order', () => {
    const market: MCPToolGroup = { serverId: 'id-market', server: '行情', tools: { status: mcpTool('Report status.') } }
    const weather: MCPToolGroup = {
      serverId: 'id-weather',
      server: '天气',
      tools: { status: mcpTool('Report status.') },
    }
    const nameOf = (order: MCPToolGroup[], group: MCPToolGroup) =>
      Object.entries(flattenMCPToolGroups(order)).find(([, tool]) => tool.execute === group.tools.status.execute)?.[0]

    const marketName = nameOf([market, weather], market)
    expect(marketName).toMatch(/^mcp__status_[0-9a-z]{6}$/)
    expect(nameOf([market, weather], weather)).not.toBe(marketName)
    expect(nameOf([weather, market], market)).toBe(marketName)
    expect(flattenMCPToolGroups([market, weather])[marketName as string].description).toBe(
      '[MCP server: 行情] Report status.'
    )
    expect(Object.keys(flattenMCPToolGroups([market]))).toEqual(['mcp__status'])
  })
})
