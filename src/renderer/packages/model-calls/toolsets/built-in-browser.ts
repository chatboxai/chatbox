import { BROWSE_PAGE_TOOL_NAME } from '@shared/built-in-browser'
import { validatedToolSchema } from '@shared/validated-tool-schema'
import type { ToolSet } from 'ai'
import type { BuiltInBrowser } from '@/platform/interfaces'
import { asRecord, numberField, stringField, toTextModelOutput } from './model-output'

const DEFAULT_BROWSE_PAGE_MAX_CHARS = 12_000

function buildInstruction(options: { hasParseLink: boolean }) {
  const whenToUse = options.hasParseLink
    ? `Read pages with parse_link first. Use ${BROWSE_PAGE_TOOL_NAME} when parse_link fails or its content is missing, incomplete, or clearly not the page itself, and for local or intranet addresses.`
    : `Use ${BROWSE_PAGE_TOOL_NAME} to read a specific page.`
  return `
## Built-in browser
${BROWSE_PAGE_TOOL_NAME} opens a URL in Chatbox's built-in browser, shown to the user in the right sidebar, and returns the rendered text. It runs the page's JavaScript, reaches local addresses, and uses sites the user has signed into there, but it is slower than remote link parsing. ${whenToUse}
The user can take over the sidebar browser at any time. If a page needs sign-in, a verification check, or other action only the user can take, ask them to do it in the sidebar and tell you when they are done; then call ${BROWSE_PAGE_TOOL_NAME} without a url to read the page they left open. Never guess content you could not read.
`
}

function formatBrowsePageOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error) return `Error: ${error}`
  const title = stringField(record, 'title')
  const url = stringField(record, 'url')
  const content = stringField(record, 'content') ?? ''
  const originalLength = numberField(record, 'originalLength')
  const truncated = record?.truncated === true
  const header = [
    title ? `Title: ${title}` : undefined,
    url ? `URL: ${url}` : undefined,
    content ? 'Content:' : undefined,
  ]
    .filter(Boolean)
    .join('\n')
  const truncationHint =
    truncated && originalLength !== undefined
      ? `\n\n[Content truncated. Showing ${content.length} of ${originalLength} characters.]`
      : ''
  return `${header ? `${header}\n` : ''}${content}${truncationHint}`
}

function createBrowsePageTool(builtInBrowser: BuiltInBrowser): ToolSet[string] {
  return {
    description:
      "Reads a web page in Chatbox's built-in browser, shown to the user in the right sidebar, and returns its rendered text. Runs JavaScript, reaches local addresses, and uses the user's built-in browser sign-ins. Omit url to read the page currently open in the sidebar.",
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          description: 'URL to open, e.g. https://example.com/article. Omit to read the page currently open.',
        },
        maxLength: {
          type: 'integer',
          minimum: 500,
          maximum: 50_000,
          description: 'Optional maximum number of characters to return from the page text.',
        },
      },
      additionalProperties: false,
    }),
    execute: async (input, { abortSignal }) => {
      const { url, maxLength } = input as { url?: string; maxLength?: number }
      const limit = Math.min(Math.max(maxLength ?? DEFAULT_BROWSE_PAGE_MAX_CHARS, 500), 50_000)
      const page = await builtInBrowser.readPage({ url, signal: abortSignal })
      const content = page.content.trim()
      const shown = content.slice(0, limit)
      return {
        url: page.url,
        title: page.title,
        content: shown,
        originalLength: content.length,
        truncated: content.length > shown.length,
      }
    },
    toModelOutput: toTextModelOutput(formatBrowsePageOutput),
  }
}

export function getBuiltInBrowserToolSet(
  builtInBrowser: BuiltInBrowser | undefined,
  options: { hasParseLink: boolean }
): {
  description: string
  tools: ToolSet
} | null {
  if (!builtInBrowser) return null
  return {
    description: buildInstruction(options),
    tools: {
      [BROWSE_PAGE_TOOL_NAME]: createBrowsePageTool(builtInBrowser),
    },
  }
}
