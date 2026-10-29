import type { ToolSet } from 'ai'

export interface MCPToolSummary {
  name: string
  description?: string
}

/** Lists MCP tools by name with their static descriptions for connection results. */
export function summarizeMCPTools(tools: ToolSet): MCPToolSummary[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: typeof tool.description === 'string' ? tool.description : undefined,
  }))
}
