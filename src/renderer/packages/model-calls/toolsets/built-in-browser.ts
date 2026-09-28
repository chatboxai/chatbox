import {
  BUILT_IN_BROWSER_MAX_UPLOAD_FILES,
  BUILT_IN_BROWSER_TOOL_NAME,
  type BuiltInBrowserCommand,
  type BuiltInBrowserDownload,
  type BuiltInBrowserPage,
  type BuiltInBrowserUploadFile,
  builtInBrowserCommandOf,
} from '@shared/built-in-browser'
import type { SandboxProvider } from '@shared/sandbox-provider'
import { TASK_SANDBOX_EXTRA_WRITE_PATHS } from '@shared/task-sandbox'
import { VIEW_IMAGE_MAX_NORMALIZED_LENGTH } from '@shared/tools/view-image-batch'
import type { AppActionApprovalDetails } from '@shared/types'
import { formatFileSize } from '@shared/utils'
import { isWindowsAbsolutePath } from '@shared/utils/windows-path'
import { validatedToolSchema } from '@shared/validated-tool-schema'
import type { ToolSet } from 'ai'
import { trackAgentModeFullAccessBypass } from '@/analytics/agent-mode'
import { requestAppActionApproval } from '@/packages/app-action-approval'
import type { BuiltInBrowser } from '@/platform/interfaces'
import { BUILT_IN_BROWSER_SKILL_NAME } from './built-in-browser-skill'
import { normalizeToolPathForPlatform } from './filesystem'
import { asRecord, numberField, stringField, toTextModelOutput } from './model-output'
import { remapPhantomHomePathForProvider } from './sandbox-paths'
import type { ImageToolResults } from './view-image'

const DEFAULT_READ_MAX_CHARS = 12_000
const DEFAULT_RUN_TIMEOUT_MS = 5_000
const UPLOAD_TIMEOUT_MS = 20_000
/** Folder of the working directory that receives the files runs download. */
const DOWNLOADS_FOLDER = 'downloads'

interface BrowserToolInput {
  command: BuiltInBrowserCommand
  url?: string
  page?: string
  code?: string
  maxLength?: number
  timeoutMs?: number
  download?: boolean
  target?: string
  files?: string[]
}

/** The session's files the browser may hand to pages or save downloads to. */
export interface BrowserFileAccess {
  sessionId?: string
  provider?: SandboxProvider
  /** Real directories the user granted this session. */
  userWorkingDirectories?: string[]
  /** Agent Full Access skips the approval of uploads from outside the working directories. */
  fullAccess?: boolean
}

type ToolCallOptions = {
  abortSignal?: AbortSignal
  toolCallId: string
  approved?: boolean
  approvalDetails?: AppActionApprovalDetails
}

const USER_INTERACTED_NOTE =
  'The user clicked, typed or scrolled in this page since your last browser call. Their actions take priority; do not undo them.'

/** Names the page a read result describes and what happened on it since the previous result. */
function pageLines(record: Record<string, unknown> | null): string[] {
  const title = stringField(record, 'title')
  const url = stringField(record, 'url')
  const page = stringField(record, 'page')
  const settled = record?.settledOperations
  const downloads = record?.downloads
  return [
    title ? `Title: ${title}` : undefined,
    url ? `URL: ${url}` : undefined,
    page ? `Page: ${page}` : undefined,
    record?.note === USER_INTERACTED_NOTE ? `Note: ${USER_INTERACTED_NOTE}` : undefined,
    Array.isArray(downloads) && downloads.length ? `Downloads: ${JSON.stringify(downloads)}` : undefined,
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
const jsonModelOutput = toTextModelOutput((output) => JSON.stringify(output))

function isWindowsRenderer(): boolean {
  return typeof navigator !== 'undefined' && (navigator.userAgent ?? '').includes('Windows')
}

/**
 * The host directory of the session's local sandbox, where relative paths resolve and downloads
 * land, and the directories an upload may read without approval: that directory, the directories
 * the user granted, and the sandbox's temp directory.
 */
async function fileScopeOf(
  access: BrowserFileAccess | undefined
): Promise<{ workingDirectory?: string; roots: string[] }> {
  const provider = access?.provider
  const sessionId = access?.sessionId
  let workingDirectory: string | undefined
  if (provider?.type === 'local' && sessionId) {
    await provider.init(sessionId).catch(() => undefined)
    workingDirectory = (await provider.resolveWorkingDirectory(sessionId).catch(() => null)) ?? undefined
  }
  const granted = provider?.getAcceptedExtraWritableDirs?.() ?? access?.userWorkingDirectories ?? []
  const roots = [
    ...(workingDirectory ? [workingDirectory] : []),
    ...granted.filter((dir) => dir.trim().length > 0),
    ...(isWindowsRenderer() ? [] : TASK_SANDBOX_EXTRA_WRITE_PATHS),
  ]
  return { workingDirectory, roots }
}

function siteOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** The page and every file an upload hands over, by canonical path, with the path requested when it differs. */
function describeUpload(url: string, requested: string[], files: BuiltInBrowserUploadFile[]): string {
  return [
    `Page: ${url}`,
    ...files.map((file, index) => {
      const via = requested[index] && requested[index] !== file.path ? `, requested as ${requested[index]}` : ''
      return `${file.path} (${formatFileSize(file.size)}${via})`
    }),
  ].join('\n')
}

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
- run: run code, an async function body, on \`page\` from the latest result that has one; returns its status and value. To click, type or scroll, load the ${BUILT_IN_BROWSER_SKILL_NAME} skill first. With download, files the run downloads are saved to the working directory.
- upload: hand local files to a file input on \`page\`; the site uploads them itself.${screenshot}
If a page needs sign-in or a check only the user can do, ask them to do it in the sidebar, then read again.`
}

/** What happened on the page since the previous result, for the model to account for. */
function pageEvents(page: BuiltInBrowserPage, currentDownloads: BuiltInBrowserDownload[] = []) {
  const downloads = [...(page.downloads ?? []), ...currentDownloads]
  return {
    ...(downloads.length ? { downloads } : {}),
    ...(page.userInteracted ? { note: USER_INTERACTED_NOTE } : {}),
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
    ...(page.page ? { page: page.page } : {}),
    ...pageEvents(page),
    content: shown,
    originalLength: content.length,
    truncated: content.length > shown.length,
  }
}

async function runScript(
  builtInBrowser: BuiltInBrowser,
  input: BrowserToolInput,
  fileAccess: BrowserFileAccess | undefined,
  signal?: AbortSignal
) {
  if (!input.page || !input.code) {
    return { status: 'not_started', error: 'The run command needs page, from the latest browser result, and code.' }
  }
  signal?.throwIfAborted()
  let downloadDirectory: string | undefined
  if (input.download) {
    const { workingDirectory } = await fileScopeOf(fileAccess)
    if (!workingDirectory) {
      return { status: 'not_started', error: 'Downloads need the session working directory, which is unavailable.' }
    }
    downloadDirectory = isWindowsAbsolutePath(workingDirectory)
      ? `${workingDirectory.replace(/\\+$/, '')}\\${DOWNLOADS_FOLDER}`
      : `${workingDirectory.replace(/\/+$/, '')}/${DOWNLOADS_FOLDER}`
  }
  let page: BuiltInBrowserPage
  try {
    page = await builtInBrowser.readPage({
      script: { code: input.code, page: input.page, ...(downloadDirectory ? { downloadDirectory } : {}) },
      timeoutMs: input.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    // The browser reports every outcome of a script it handed to the page; a thrown error means it never started.
    return { status: 'not_started', error: error instanceof Error ? error.message : String(error) }
  }
  const result = page.scriptResult
  if (!result) return { status: 'unknown', error: 'The browser did not return a script result.', ...pageEvents(page) }
  const { operationId, downloads, ...outcome } = result
  return {
    ...outcome,
    // Only an unknown outcome is reported again later, in settledOperations, under this id.
    ...(result.status === 'unknown' ? { operationId } : {}),
    ...(page.page ? { page: page.page } : {}),
    url: page.url,
    ...(page.lastNavigation ? { lastNavigation: page.lastNavigation } : {}),
    ...pageEvents(page, downloads),
    ...(result.navigated && !page.page && result.status !== 'not_started'
      ? { next: 'The page is loading another document. Read it without a url before running another script.' }
      : {}),
  }
}

/**
 * Hands files to a page. Files outside the session's working directories need the user's approval,
 * which the browser reports before touching the page; Full Access skips it.
 */
async function uploadFiles(
  builtInBrowser: BuiltInBrowser,
  input: BrowserToolInput,
  fileAccess: BrowserFileAccess | undefined,
  options: ToolCallOptions
) {
  const { abortSignal: signal } = options
  if (!input.page || !input.target || !input.files?.length) {
    return {
      status: 'not_started',
      error: 'The upload command needs page, from the latest browser result, target and files.',
    }
  }
  signal?.throwIfAborted()
  const { workingDirectory, roots } = await fileScopeOf(fileAccess)
  const files = await Promise.all(
    input.files.map(async (file) =>
      normalizeToolPathForPlatform(await remapPhantomHomePathForProvider(file, fileAccess?.provider))
    )
  )
  const upload = (approvedVersion: string | undefined) =>
    builtInBrowser.readPage({
      upload: {
        page: input.page as string,
        target: input.target as string,
        files,
        ...(workingDirectory ? { baseDirectory: workingDirectory } : {}),
        allowedRoots: roots,
        ...(approvedVersion ? { approvedVersion } : {}),
      },
      timeoutMs: UPLOAD_TIMEOUT_MS,
      signal,
    })
  const approvedDetails = options.approved ? options.approvalDetails : undefined
  let page = await upload(approvedDetails?.type === 'browser_upload' ? approvedDetails.version : undefined)
  const downloadEvents = [...(page.downloads ?? [])]
  const pending = page.uploadResult
  if (pending?.code === 'approval_required' && pending.files && pending.approvalVersion) {
    if (fileAccess?.fullAccess) {
      trackAgentModeFullAccessBypass({ tool: 'browser_upload' })
    } else {
      // Approval binds to these files; files that differ when the approved call runs are asked about again.
      const approved = await requestAppActionApproval(
        options.toolCallId,
        'browser.upload',
        `Upload to ${siteOf(page.url)}`,
        describeUpload(page.url, files, pending.files),
        { type: 'browser_upload', version: pending.approvalVersion }
      )
      if (!approved) return { status: 'not_started', error: 'Upload denied by user.', ...pageEvents(page) }
    }
    page = await upload(pending.approvalVersion)
    downloadEvents.push(...(page.downloads ?? []))
  }
  page = { ...page, downloads: downloadEvents }
  const result = page.uploadResult
  if (!result) return { status: 'unknown', error: 'The browser did not return an upload result.', ...pageEvents(page) }
  // An upload is never reported again later, so its operation id has no use to the model.
  const { operationId: _operationId, files: handed, ...outcome } = result
  return {
    ...outcome,
    ...(handed?.length
      ? { files: handed.map(({ name, size, path }) => ({ name, size, path })), site: siteOf(page.url) }
      : {}),
    ...(page.page ? { page: page.page } : {}),
    url: page.url,
    ...(page.lastNavigation ? { lastNavigation: page.lastNavigation } : {}),
    ...pageEvents(page),
  }
}

/**
 * The built-in browser as one tool whose `command` selects the operation, so its definition stays
 * small and fixed; the built-in-browser skill documents interaction. Screenshots need a vision
 * model and travel through the same injection and replay bounds as view_image.
 */
export function getBuiltInBrowserToolSet(
  builtInBrowser: BuiltInBrowser | undefined,
  options: { hasParseLink: boolean; imageResults?: ImageToolResults; fileAccess?: BrowserFileAccess }
): { tools: ToolSet } | null {
  if (!builtInBrowser) return null
  const { imageResults, fileAccess } = options
  const commands: BuiltInBrowserCommand[] = imageResults
    ? ['read', 'run', 'upload', 'screenshot']
    : ['read', 'run', 'upload']
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
          description: 'run/upload: page from the latest result that has one.',
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
        download: {
          type: 'boolean',
          description: `run: save files the script downloads to ${DOWNLOADS_FOLDER}/ in the working directory.`,
        },
        target: {
          type: 'string',
          minLength: 1,
          description: 'upload: CSS selector of the file input, or of the control that opens the file picker.',
        },
        files: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          minItems: 1,
          maxItems: BUILT_IN_BROWSER_MAX_UPLOAD_FILES,
          description: 'upload: file paths, absolute or relative to the working directory.',
        },
      },
      required: ['command'],
      additionalProperties: false,
    }),
    execute: async (rawInput, toolOptions) => {
      const { abortSignal, toolCallId, messages } = toolOptions
      const input = rawInput as BrowserToolInput
      if (input.command === 'run') return runScript(builtInBrowser, input, fileAccess, abortSignal)
      if (input.command === 'upload') {
        const { approved, approvalDetails } = toolOptions as typeof toolOptions &
          Pick<ToolCallOptions, 'approved' | 'approvalDetails'>
        return uploadFiles(builtInBrowser, input, fileAccess, { abortSignal, toolCallId, approved, approvalDetails })
      }
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
      return command === 'run' || command === 'upload' ? jsonModelOutput(options) : readModelOutput(options)
    },
  }
  return { tools: { [BUILT_IN_BROWSER_TOOL_NAME]: tool } }
}
