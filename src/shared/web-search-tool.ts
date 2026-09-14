import { validatedToolSchema } from './validated-tool-schema'
import type { ToolSet } from 'ai'

// The web_search tool definition shared between the renderer
// (packages/model-calls/toolsets/web-search.ts) and the native app. Only the
// executor differs per platform; description, schema, and result shape must
// stay identical so the model behaves the same everywhere.

export const WEB_SEARCH_TOOLSET_INSTRUCTION = `
Use web_search to search the web when doing so would genuinely improve your answer.

## web_search
Search the web when the question benefits from fresh, real-time, or source-specific information — e.g. current events, recent releases, live data, or facts you aren't confident about. For questions you can already answer well from your own knowledge, answer directly. Use short, concise queries (English preferred).
`

export interface WebSearchToolResult {
  searchResults: Array<{ title: string; snippet: string; link: string }>
}

function formatWebSearchOutput(output: unknown): string {
  if (!output || typeof output !== 'object' || !('searchResults' in output)) {
    return JSON.stringify(output) ?? String(output)
  }
  const searchResults = (output as WebSearchToolResult).searchResults
  if (!Array.isArray(searchResults) || searchResults.length === 0) return 'No search results found.'
  return searchResults
    .map((result, index) => {
      const parts = [`Result ${index + 1}`, `Title: ${result.title}`]
      if (result.link) parts.push(`URL: ${result.link}`)
      if (result.snippet) parts.push(`Snippet:\n${result.snippet}`)
      return parts.join('\n')
    })
    .join('\n\n')
}

function toWebSearchModelOutput({ output }: { output: unknown }): { type: 'text'; value: string } {
  return {
    type: 'text',
    value: formatWebSearchOutput(output),
  }
}

export function createWebSearchTool(
  executor: (query: string, abortSignal?: AbortSignal) => Promise<WebSearchToolResult>
): ToolSet[string] {
  return {
    description:
      'Search the web for information. Use it when fresh, real-time, or source-specific data would improve the answer (current events, recent releases, live data, facts you are unsure about). For questions you can answer confidently from your own knowledge, answer directly instead. Use short, concise queries (English preferred).',
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'the search query' },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async (input, { abortSignal }) => {
      const searchInput = input as { query: string }
      return await executor(searchInput.query, abortSignal)
    },
    toModelOutput: toWebSearchModelOutput,
  }
}
