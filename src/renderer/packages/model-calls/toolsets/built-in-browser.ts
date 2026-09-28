import {
  BUILT_IN_BROWSER_TOOL_NAME,
  type BuiltInBrowserCommand,
  type BuiltInBrowserPage,
  builtInBrowserCommandOf,
} from '@shared/built-in-browser'
import { VIEW_IMAGE_MAX_NORMALIZED_LENGTH } from '@shared/tools/view-image-batch'
import { validatedToolSchema } from '@shared/validated-tool-schema'
import type { ToolSet } from 'ai'
import type { BuiltInBrowser } from '@/platform/interfaces'
import { BUILT_IN_BROWSER_SKILL_NAME } from './built-in-browser-skill'
import { asRecord, numberField, stringField, toTextModelOutput } from './model-output'
import type { ImageToolResults } from './view-image'

const DEFAULT_READ_MAX_CHARS = 12_000
const DEFAULT_RUN_TIMEOUT_MS = 5_000

interface BrowserToolInput {
  command: BuiltInBrowserCommand
  url?: string
  page?: string
  code?: string
  maxLength?: number
  timeoutMs?: number
}

const USER_INTERACTED_NOTE =
  'The user clicked, typed or scrolled in this page since your last browser call. Their actions take priority; do not undo them.'

/** Names the page a read result describes and what happened on it since the previous result. */
function pageLines(record: Record<string, unknown> | null): string[] {
  const title = stringField(record, 'title')
  const url = stringField(record, 'url')
  const page = stringField(record, 'page')
  const settled = record?.settledOperations
  return [
    title ? `Title: ${title}` : undefined,
    url ? `URL: ${url}` : undefined,
    page ? `Page: ${page}` : undefined,
    record?.userInteracted === true ? `Note: ${USER_INTERACTED_NOTE}` : undefined,
    Array.isArray(settled) && settled.length ? `Earlier runs finished: ${JSON.stringify(settled)}` : undefined,
  ].filter((line): line is string => line !== undefined)
}

function formatReadOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error) return [`Error: ${error}`, ...pageLines(record)].join('\n')
  const content = stringField(record, 'content') ?? ''
  const originalLength = numberField(record, 'originalLength')
  const truncated = record?.truncated === true
  const header = [...pageLines(record), ...(content ? ['Content:'] : [])].join('\n')
  const truncationHint =
    truncated && originalLength !== undefined
      ? `\n\n[Content truncated. Showing ${content.length} of ${originalLength} characters.]`
      : ''
  return `${header ? `${header}\n` : ''}${content}${truncationHint}`
}

const readModelOutput = toTextModelOutput(formatReadOutput)
const runModelOutput = toTextModelOutput((output) => JSON.stringify(output))

function describeTool(options: { hasParseLink: boolean; screenshot: boolean }): string {
  const whenToUse = options.hasParseLink
    ? ' Slower than parse_link: prefer parse_link, and use this when it fails or is incomplete, or for local addresses.'
    : ''
  const screenshot = options.screenshot
    ? '\n- screenshot: capture the visible viewport of url or the current page.'
    : ''
  return `Chatbox's built-in browser, shown to the user in the sidebar. Runs page JavaScript, reaches local addresses, and has the user's sign-ins.${whenToUse}
Commands:
- read: return the rendered text of url, or of the current page when url is omitted.
- run: run code, an async function body, on the page named by page, the reference from the latest read or run result that has one, and return its status and return value. To click, type or scroll, load the ${BUILT_IN_BROWSER_SKILL_NAME} skill first.${screenshot}
If a page needs sign-in or a check only the user can do, ask them to do it in the sidebar, then read again.`
}

/** What happened on the page since the previous result, for the model to account for. */
function pageEvents(page: BuiltInBrowserPage) {
  return {
    ...(page.userInteracted ? { userInteracted: true, note: USER_INTERACTED_NOTE } : {}),
    ...(page.settledOperations?.length ? { settledOperations: page.settledOperations } : {}),
  }
}

async function readPage(builtInBrowser: BuiltInBrowser, input: BrowserToolInput, signal?: AbortSignal) {
  const limit = Math.min(Math.max(input.maxLength ?? DEFAULT_READ_MAX_CHARS, 500), 50_000)
  const page = await builtInBrowser.readPage({ url: input.url, signal })
  const content = page.content.trim()
  const shown = content.slice(0, limit)
  return {
    url: page.url,
    title: page.title,
    page: page.page,
    ...pageEvents(page),
    content: shown,
    originalLength: content.length,
    truncated: content.length > shown.length,
  }
}

async function runScript(builtInBrowser: BuiltInBrowser, input: BrowserToolInput, signal?: AbortSignal) {
  if (!input.page || !input.code) {
    return { status: 'not_started', error: 'The run command needs page, from the latest browser result, and code.' }
  }
  signal?.throwIfAborted()
  let page: BuiltInBrowserPage
  try {
    page = await builtInBrowser.readPage({
      script: { code: input.code, page: input.page },
      timeoutMs: input.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    // The browser reports every outcome of a script it handed to the page; a thrown error means it never started.
    return { status: 'not_started', error: error instanceof Error ? error.message : String(error) }
  }
  const result = page.scriptResult
  if (!result) return { status: 'unknown', error: 'The browser did not return a script result.' }
  const { operationId, ...outcome } = result
  return {
    ...outcome,
    operationId,
    ...(page.page ? { page: page.page } : {}),
    url: page.url,
    ...(page.lastNavigation ? { lastNavigation: page.lastNavigation } : {}),
    ...pageEvents(page),
    ...(result.navigated && !page.page && result.status !== 'not_started'
      ? { next: 'The page is loading another document. Read it without a url before running another script.' }
      : {}),
  }
}

/**
 * The built-in browser as one tool whose `command` selects the operation, so its definition stays
 * small and fixed; the built-in-browser skill documents interaction. Screenshots need a vision
 * model and travel through the same injection and replay bounds as view_image.
 */
export function getBuiltInBrowserToolSet(
  builtInBrowser: BuiltInBrowser | undefined,
  options: { hasParseLink: boolean; imageResults?: ImageToolResults }
): { tools: ToolSet } | null {
  if (!builtInBrowser) return null
  const { imageResults } = options
  const commands: BuiltInBrowserCommand[] = imageResults ? ['read', 'run', 'screenshot'] : ['read', 'run']
  const tool: ToolSet[string] = {
    description: describeTool({ hasParseLink: options.hasParseLink, screenshot: !!imageResults }),
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        command: { type: 'string', enum: commands },
        url: {
          type: 'string',
          format: 'uri',
          description: 'read/screenshot: page to open; omit for the current page.',
        },
        page: {
          type: 'string',
          description: 'run: the page reference from the latest read or run result that has one.',
        },
        code: {
          type: 'string',
          minLength: 1,
          maxLength: 20_000,
          description: 'run: e.g. return document.title',
        },
        maxLength: { type: 'integer', minimum: 500, maximum: 50_000, description: 'read: maximum characters.' },
        timeoutMs: {
          type: 'integer',
          minimum: 1000,
          maximum: 30_000,
          description: `run: maximum wait in ms, default ${DEFAULT_RUN_TIMEOUT_MS}.`,
        },
      },
      required: ['command'],
      additionalProperties: false,
    }),
    execute: async (rawInput, { abortSignal, toolCallId, messages }) => {
      const input = rawInput as BrowserToolInput
      if (input.command === 'run') return runScript(builtInBrowser, input, abortSignal)
      if (input.command !== 'screenshot') return readPage(builtInBrowser, input, abortSignal)
      if (!imageResults) return { error: 'Screenshots are not available for this model.' }
      imageResults.reserve(messages)
      const page = await builtInBrowser.readPage({ url: input.url, screenshot: true, signal: abortSignal })
      const screenshot = page.screenshot
      if (!screenshot) return { error: 'The built-in browser did not return a screenshot.' }
      const dataUrl = `data:${screenshot.mediaType};base64,${screenshot.base64Data}`
      if (dataUrl.length > VIEW_IMAGE_MAX_NORMALIZED_LENGTH) {
        return { error: 'The screenshot exceeds the request image limit.' }
      }
      const result = await imageResults.record({ toolCallId, label: page.url, dataUrl })
      return { ...result, url: page.url, title: page.title, width: screenshot.width, height: screenshot.height }
    },
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => {
      const command = builtInBrowserCommandOf(options.input)
      if (command === 'screenshot' && imageResults && !stringField(asRecord(options.output), 'error')) {
        return imageResults.toModelOutput(options)
      }
      return command === 'run' ? runModelOutput(options) : readModelOutput(options)
    },
  }
  return { tools: { [BUILT_IN_BROWSER_TOOL_NAME]: tool } }
}
