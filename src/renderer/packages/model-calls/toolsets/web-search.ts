import { tool } from 'ai'
import { ChatboxAIAPIError } from 'src/shared/models/errors'
import z from 'zod'
import * as remote from '@/packages/remote'
import { webSearchExecutor } from '@/packages/web-search'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'

const toolSetDescription = `
A set of tools to assist the AI in answering user queries.

web_search:
A search engine. Useful for when you need to answer questions about current events. Input should be a search query. Prefer English query. Query should be short and concise.

parse_link:
Parses the readable content of a web page. Use this when you need to extract detailed information from a specific URL shared by the user.

`

export const webSearchTool = tool({
  description:
    'a search engine. useful for when you need to answer questions about current events. input should be a search query. prefer English query. query should be short and concise',
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
  execute: async (input: { url: string; maxLength?: number }, _context: { abortSignal?: AbortSignal }) => {
    const licenseKey = settingActions.getLicenseKey()
    if (!licenseKey) {
      throw ChatboxAIAPIError.fromCodeName('license_key_required', 'license_key_required')
    }

    const parsed = await remote.parseUserLinkPro({ licenseKey, url: input.url })
    const content = ((await platform.getStoreBlob(parsed.storageKey)) || '').trim()

    const maxLength = input.maxLength ?? DEFAULT_PARSE_LINK_MAX_CHARS
    const normalizedMaxLength = Math.min(Math.max(maxLength, 500), 50_000)
    const truncatedContent = content.slice(0, normalizedMaxLength)

    return {
      url: input.url,
      title: parsed.title,
      content: truncatedContent,
      originalLength: content.length,
      truncated: content.length > truncatedContent.length,
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
