import { ChatboxAIAPIError } from '@shared/models/errors'
import { tool } from 'ai'
import z from 'zod'
import * as remote from '@/packages/remote'
import { getParseLinkProvider, webSearchExecutor } from '@/packages/web-search'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'

const toolSetDescription = `
Use these tools to search the web and extract content from URLs.

## web_search
Search the web for current information. Use short, concise queries (English preferred).

## parse_link
Extract readable content from a URL. Use when you need detailed information from a specific webpage.
`

export const webSearchTool = tool({
  description:
    'Search the web for current events and real-time information. Use short, concise queries (English preferred).',
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
    'Parses the readable content of a web page. Use this when you need to extract detailed information from a specific URL shared by the user.',
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

    // Chatbox AI (build-in) path: requires a license key (any tier — backend has no Pro gate).
    if (searchProvider === 'build-in') {
      const licenseKey = settingActions.getLicenseKey()
      if (!licenseKey) {
        throw ChatboxAIAPIError.fromCodeName(
          'parse_link via Chatbox AI requires a license key, but none is configured',
          'chatbox_search_license_key_required'
        )
      }
      const parsed = await remote.parseUserLinkPro({ licenseKey, url: input.url, abortSignal })
      const storedContent = await platform.getStoreBlob(parsed.storageKey)
      if (storedContent == null) {
        const technical = `parse_link storage blob missing for URL ${input.url} (storageKey: ${parsed.storageKey})`
        throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
      }
      const content = storedContent.trim()
      const truncatedContent = content.slice(0, normalizedMaxLength)
      return {
        url: input.url,
        title: parsed.title,
        content: truncatedContent,
        originalLength: content.length,
        truncated: content.length > truncatedContent.length,
      }
    }

    // Third-party provider path (e.g. Tavily). Throws if API key missing or extraction fails.
    const provider = getParseLinkProvider()
    if (!provider) {
      const technical = `parse_link is not supported by the configured search provider "${searchProvider}"`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_not_supported') ?? new Error(technical)
    }
    const result = await provider.parseLink(input.url, abortSignal)
    if (!result) {
      const technical = `parse_link returned no result for URL ${input.url} (provider: ${searchProvider})`
      throw ChatboxAIAPIError.fromCodeName(technical, 'parse_link_failed') ?? new Error(technical)
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
  description: toolSetDescription,
  tools: {
    web_search: webSearchTool,
    parse_link: parseLinkTool,
  },
}
