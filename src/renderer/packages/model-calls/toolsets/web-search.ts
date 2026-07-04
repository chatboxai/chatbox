import { CodedError } from '@shared/models/errors'
import { tool } from 'ai'
import z from 'zod'
import { getParseLinkProvider, webSearchExecutor } from '@/packages/web-search'
import * as settingActions from '@/stores/settingActions'

const webSearchDescription = `
Use web_search to search the web when doing so would genuinely improve your answer.

## web_search
Search the web when the question benefits from fresh, real-time, or source-specific information — e.g. current events, recent releases, live data, or facts you aren't confident about. For questions you can already answer well from your own knowledge, answer directly. Use short, concise queries (English preferred).
`

const parseLinkDescription = `
## parse_link
Extract readable content from a specific URL — typically one the user shared or that a prior search returned.
`

export function getToolSetDescription(options: { includeParseLink: boolean }) {
  return options.includeParseLink ? `${webSearchDescription}${parseLinkDescription}` : webSearchDescription
}

export const webSearchTool = tool({
  description:
    'Search the web for information. Use it when fresh, real-time, or source-specific data would improve the answer (current events, recent releases, live data, facts you are unsure about). For questions you can answer confidently from your own knowledge, answer directly instead. Use short, concise queries (English preferred).',
  inputSchema: z.object({
    query: z.string().describe('the search query'),
  }),
  execute: async (input: { query: string }, { abortSignal }: { abortSignal?: AbortSignal }) => {
    return await webSearchExecutor({ query: input.query }, { abortSignal })
  },
})

const DEFAULT_PARSE_LINK_MAX_CHARS = 12_000

export const parseLinkTool = tool({
  description:
    'Parses the readable content of a web page. Use this when you need detailed information from a specific URL — typically one the user shared or that was returned by a prior search.',
  inputSchema: z.object({
    url: z.string().url().describe('The URL to parse. Always include the schema, e.g. https://example.com'),
    maxLength: z
      .number()
      .int()
      .min(500)
      .max(50_000)
      .optional()
      .describe('Optional maximum number of characters to return from the parsed content.'),
  }),
  execute: async (input: { url: string; maxLength?: number }, { abortSignal }: { abortSignal?: AbortSignal }) => {
    const maxLength = input.maxLength ?? DEFAULT_PARSE_LINK_MAX_CHARS
    const normalizedMaxLength = Math.min(Math.max(maxLength, 500), 50_000)

    const searchProvider = settingActions.getExtensionSettings().webSearch.provider

    const provider = getParseLinkProvider()
    if (!provider) {
      const technical = `parse_link is not supported by the configured search provider "${searchProvider}"`
      throw CodedError.fromCodeName(technical, 'parse_link_not_supported') ?? new Error(technical)
    }
    const result = await provider.parseLink(input.url, abortSignal)
    if (!result) {
      const technical = `parse_link returned no result for URL ${input.url} (provider: ${searchProvider})`
      throw CodedError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
    }
    const truncatedContent = result.content.slice(0, normalizedMaxLength)
    return {
      url: result.url,
      title: result.title,
      content: truncatedContent,
      originalLength: result.content.length,
      truncated: result.content.length > truncatedContent.length,
    }
  },
})

export default {
  description: getToolSetDescription({ includeParseLink: true }),
  tools: {
    web_search: webSearchTool,
    parse_link: parseLinkTool,
  },
}
