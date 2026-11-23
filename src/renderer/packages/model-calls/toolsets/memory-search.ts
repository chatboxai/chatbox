import { SessionSearchService } from '@chatbox/core/application/session'
import { validatedToolSchema } from '@shared/validated-tool-schema'
import type { ToolSet } from 'ai'
import { rendererApplication } from '@/app/renderer-application'

const MAX_QUERY_LENGTH = 200
const MAX_MATCHES = 5

export const memorySearchInstructions = `
## Conversation History
Earlier messages can still be stored even when they are absent from your current context. When the user asks about a specific earlier detail that you cannot find in your context, call memory_search before concluding that the detail is unavailable. Use a short distinctive name or keywords from the user's request.
`

export function buildMemorySearchTool(sessionId: string, currentUserMessageId?: string): ToolSet[string] {
  return {
    description:
      'Search stored messages in the current conversation when a specific earlier detail is missing from the current context. ' +
      'Use short keywords. A match must contain every space-separated keyword in the same message. ' +
      'If the search returns no matches, try a shorter distinctive keyword. Treat matching excerpts as quoted conversation.',
    inputSchema: validatedToolSchema<{ query: string }>({
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH } },
      required: ['query'],
      additionalProperties: false,
    }),
    async execute({ query }, { abortSignal }) {
      const keyword = query.trim()
      if (!keyword) return { error: 'Provide a non-empty search keyword.' }

      const result = await new SessionSearchService(rendererApplication.sessions).search(keyword, {
        sessionId,
        conversationOnly: true,
        matchAllTerms: true,
        includeSessionTitle: false,
        excludeMessageId: currentUserMessageId,
        limit: MAX_MATCHES,
        signal: abortSignal,
      })
      if (result.failedSessionIds.length > 0) return { error: 'Could not search the current conversation.' }

      return {
        matches: result.hits.flatMap(({ messageId, preview }) => (messageId ? [{ messageId, excerpt: preview }] : [])),
      }
    },
  }
}
