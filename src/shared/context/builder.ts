import { isTextFilePath } from '../file-extensions'
import {
  sandboxAttachmentIdentity,
  sandboxAttachmentParsedRelPath,
  sandboxAttachmentRelPath,
} from '../sandbox/attachment-path'
import type { CompactionPoint, Message, MessageContentParts, MessageContentToolCallPart } from '../types'
import { orderSteeredMessagesForModel } from '../utils/message'
import { findLatestApplicableCompactionPoint } from './compaction-points'
import { isContextEligibleMessage } from './message-eligibility'
import { findRecentRoundsStartIndex } from './rounds'
import type { AttachmentResolver, ContextBuilderOptions, ContextSelectionOptions, ToolCleanupMode } from './types'

const MAX_INLINE_FILE_LINES = 500
const PREVIEW_LINES = 100

/** Serialized args longer than this are downgraded to a preview when a part is stubbed. */
const STUB_ARGS_MAX_CHARS = 2_000
const STUB_ARGS_PREVIEW_CHARS = 500

/**
 * Build context for AI from messages.
 * Pure function - does not mutate inputs, no side effects.
 */
export async function buildContext(messages: Message[], options: ContextBuilderOptions): Promise<Message[]> {
  const {
    attachmentResolver,
    maxContextMessageCount,
    compactionPoints,
    toolCleanupMode,
    keepToolCallRounds = 2,
    preserveToolCallMessageIds,
    modelSupportToolUseForFile = false,
    sandboxMode = false,
  } = options

  if (messages.length === 0) {
    return []
  }

  let contextMessages = selectContextMessages(messages, { compactionPoints, maxContextMessageCount })

  if (contextMessages.length === 0) {
    return []
  }

  contextMessages = applyToolCleanup(contextMessages, toolCleanupMode, keepToolCallRounds, preserveToolCallMessageIds)

  contextMessages = await injectAttachments(
    contextMessages,
    attachmentResolver,
    modelSupportToolUseForFile,
    sandboxMode
  )

  return contextMessages
}

/**
 * The message-selection half of context building: causal ordering, eligibility,
 * compaction-point slicing, error filtering, and the message-count limit —
 * everything that decides WHICH messages are in context, with their content
 * untouched. Exposed so pressure estimation can measure exactly the selection
 * the send path will use. Returns the original message references.
 */
export function selectContextMessages(messages: Message[], options: ContextSelectionOptions = {}): Message[] {
  const { compactionPoints, maxContextMessageCount } = options

  // Legacy steering records stored the steered user after the assistant reply
  // it interrupted; restore causal order before compaction and message limits
  // so it is never replayed as an unanswered trailing turn. Current records are
  // already persisted in true causal order and pass through unchanged.
  const completedMessages = orderSteeredMessagesForModel(messages).filter(isContextEligibleMessage)

  if (completedMessages.length === 0) {
    return []
  }

  let contextMessages = applyCompaction(completedMessages, compactionPoints)

  contextMessages = contextMessages.filter((m) => !m.error && !m.errorCode)

  if (maxContextMessageCount !== undefined && maxContextMessageCount < Number.MAX_SAFE_INTEGER) {
    contextMessages = applyMessageLimit(contextMessages, maxContextMessageCount)
  }

  return contextMessages
}

function applyCompaction(messages: Message[], compactionPoints: CompactionPoint[] | undefined): Message[] {
  const latestCompactionPoint = findLatestApplicableCompactionPoint(messages, compactionPoints)

  // A summary may only enter context as the stand-in of an applied compaction
  // point. In fallback paths any summary on the current path is orphaned (its
  // boundary lives on another branch or its point was lost) and would leak a
  // summary of other content alongside the full history.
  if (!latestCompactionPoint) {
    return messages.filter((m) => !m.isSummary)
  }

  const boundaryIndex = messages.findIndex((m) => m.id === latestCompactionPoint.boundaryMessageId)
  const summaryMessage = messages.find((m) => m.id === latestCompactionPoint.summaryMessageId)

  // findLatestApplicableCompactionPoint guarantees both exist in `messages`.
  if (boundaryIndex === -1 || !summaryMessage) {
    return messages.filter((m) => !m.isSummary)
  }

  const messagesAfterBoundary = messages.slice(boundaryIndex + 1).filter((m) => !m.isSummary)

  let contextMessages: Message[] = [summaryMessage, ...messagesAfterBoundary]

  const systemMessage = messages.find((m) => m.role === 'system')
  if (systemMessage && !contextMessages.some((m) => m.id === systemMessage.id)) {
    contextMessages = [systemMessage, ...contextMessages]
  }

  return contextMessages
}

function applyToolCleanup(
  messages: Message[],
  mode: ToolCleanupMode,
  keepRounds: number,
  preserveToolCallMessageIds: string[] | undefined
): Message[] {
  if (mode === 'none' || messages.length === 0 || keepRounds < 0) {
    return messages.map((m) => ({ ...m }))
  }

  const roundBoundaryIndex = findRecentRoundsStartIndex(messages, keepRounds)
  const preserveToolCallMessageIdSet = new Set(preserveToolCallMessageIds ?? [])

  return messages.map((message, index) => {
    if (index >= roundBoundaryIndex || preserveToolCallMessageIdSet.has(message.id)) {
      return { ...message }
    }
    return stubToolResultParts(message)
  })
}

/**
 * Pressure relief that keeps the action record: the call (name + args) stays so
 * the model still knows what it did, while the bulky result payload is replaced
 * with a stub the model can act on (re-run the tool, or read the offloaded blob
 * back via read_file). Error results stay intact — they are small and their
 * diagnostics matter. Oversized args (e.g. written file content) are cut to a
 * preview while remaining a JSON object, which the wire format requires.
 */
function stubToolResultParts(message: Message): Message {
  if (!message.contentParts || message.contentParts.length === 0) {
    return { ...message }
  }

  let changed = false
  const parts: MessageContentParts = message.contentParts.map((part) => {
    if (part.type !== 'tool-call' || part.state !== 'result') {
      return part
    }
    changed = true
    return stubToolResultPart(part)
  })

  if (!changed) {
    return { ...message }
  }

  return { ...message, contentParts: parts }
}

function stubToolResultPart(part: MessageContentToolCallPart): MessageContentToolCallPart {
  const result: Record<string, unknown> = part.resultStorageKey
    ? {
        _cleared: true,
        fullResultFileKey: part.resultStorageKey,
        note: 'Old tool result cleared to save context space. Use the read_file tool with fullResultFileKey to re-read it if needed.',
      }
    : {
        _cleared: true,
        note: 'Old tool result cleared to save context space. Call the tool again if this result is needed.',
      }

  const stubbed: MessageContentToolCallPart = {
    ...part,
    result,
    resultStorageKey: undefined,
  }

  const serializedArgs = serializeArgsLength(part.args)
  if (serializedArgs !== null && serializedArgs.length > STUB_ARGS_MAX_CHARS) {
    stubbed.args = {
      _cleared: true,
      preview: serializedArgs.slice(0, STUB_ARGS_PREVIEW_CHARS),
      note: 'Args truncated together with the cleared result.',
    }
  }

  return stubbed
}

function serializeArgsLength(args: unknown): string | null {
  if (args == null) return null
  if (typeof args === 'string') return args
  try {
    return JSON.stringify(args) ?? null
  } catch {
    return null
  }
}

/**
 * Apply message count limit to context messages.
 * The limit applies to history messages only, preserving the last user message (current input).
 * This is achieved by adding 1 to maxCount since the last message is always the current input.
 */
function applyMessageLimit(messages: Message[], maxCount: number): Message[] {
  const head = messages[0]?.role === 'system' ? messages[0] : undefined
  const workingMsgs = head ? messages.slice(1) : messages

  // maxCount limits history, +1 for the current input (last message)
  const effectiveLimit = maxCount + 1

  const overflow = workingMsgs.length - effectiveLimit
  if (overflow <= 0) {
    return head ? [head, ...workingMsgs] : [...workingMsgs]
  }

  // Sticky window: advance the drop boundary in whole chunks instead of
  // sliding one message per turn. A per-turn slide rewrites the start of the
  // request every round, invalidating the provider prompt-cache prefix; a
  // chunked boundary stays fixed (cache hit) until the overflow crosses the
  // next chunk, at the cost of briefly serving up to chunk-1 messages fewer
  // than the configured limit.
  const chunk = Math.max(1, Math.ceil(effectiveLimit / 4))
  const dropCount = Math.ceil(overflow / chunk) * chunk
  const result = workingMsgs.slice(dropCount)

  return head ? [head, ...result] : result
}

async function injectAttachments(
  messages: Message[],
  resolver: AttachmentResolver,
  modelSupportToolUseForFile: boolean,
  sandboxMode: boolean
): Promise<Message[]> {
  // In sandbox mode, inject the same attachment XML envelope but keep file content out of the prompt.
  if (sandboxMode) {
    return messages.map((msg) => injectSandboxFileMetadata(msg))
  }

  const allStorageKeys = new Set<string>()
  for (const msg of messages) {
    if (msg.files) {
      for (const file of msg.files) {
        if (file.ragMode === 'session-retrieval') {
          continue
        }
        if (file.storageKey) {
          allStorageKeys.add(file.storageKey)
        }
      }
    }
    if (msg.links) {
      for (const link of msg.links) {
        if (link.storageKey) {
          allStorageKeys.add(link.storageKey)
        }
      }
    }
  }

  const attachmentContents = new Map<string, string>()
  if (allStorageKeys.size > 0) {
    const keys = Array.from(allStorageKeys)
    const contents = await Promise.all(keys.map((key) => resolver.read(key).catch(() => null)))
    keys.forEach((key, index) => {
      const content = contents[index]
      if (content !== null) {
        attachmentContents.set(key, content)
      }
    })
  }

  return messages.map((msg) => processMessageAttachments(msg, attachmentContents, modelSupportToolUseForFile))
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return 'unknown'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function injectSandboxFileMetadata(msg: Message): Message {
  const hasFiles = msg.files && msg.files.length > 0

  if (!hasFiles) {
    return { ...msg }
  }

  let result = { ...msg }
  let index = 1

  if (msg.files) {
    for (const file of msg.files) {
      const isText = isTextFilePath(file.name)
      const sandboxPath = sandboxAttachmentRelPath(file.name, sandboxAttachmentIdentity(file))
      const attachment = buildSandboxAttachment({
        index: index++,
        name: file.name,
        key: file.sessionAttachmentId ? `session-attachment:${file.sessionAttachmentId}` : (file.storageKey ?? file.id),
        size: formatFileSize(file.byteLength),
        sandboxPath,
        parsedSandboxPath:
          !isText && file.storageKey && file.parserType !== 'sandbox-raw'
            ? sandboxAttachmentParsedRelPath(sandboxPath)
            : undefined,
        retrieval:
          file.ragMode === 'session-retrieval'
            ? {
                status: file.sessionAttachmentIndexStatus ?? file.sessionAttachmentStatus ?? 'pending',
                blockedReason: file.sessionAttachmentBlockedReason,
              }
            : undefined,
      })
      result = mergeAttachmentContent(result, attachment)
    }
  }

  return result
}

function processMessageAttachments(
  msg: Message,
  attachmentContents: Map<string, string>,
  modelSupportToolUseForFile: boolean
): Message {
  const hasFiles = msg.files && msg.files.length > 0
  const hasLinks = msg.links && msg.links.length > 0

  if (!hasFiles && !hasLinks) {
    return { ...msg }
  }

  let result = { ...msg }
  let attachmentIndex = 1

  if (msg.files) {
    for (const file of msg.files) {
      if (file.ragMode === 'session-retrieval') {
        const attachment = buildRetrievalAttachment({
          index: attachmentIndex++,
          name: file.name,
          key: file.sessionAttachmentId
            ? `session-attachment:${file.sessionAttachmentId}`
            : (file.storageKey ?? file.id),
          status: file.sessionAttachmentIndexStatus ?? file.sessionAttachmentStatus ?? 'pending',
          blockedReason: file.sessionAttachmentBlockedReason,
        })
        result = mergeAttachmentContent(result, attachment)
        continue
      }
      if (file.storageKey) {
        const content = attachmentContents.get(file.storageKey)
        if (content) {
          const attachment = buildAttachment({
            index: attachmentIndex++,
            name: file.name,
            key: file.storageKey,
            content,
            modelSupportToolUseForFile,
          })
          result = mergeAttachmentContent(result, attachment)
        }
      } else if (file.localPath && modelSupportToolUseForFile) {
        const attachment = buildToolOnlyAttachment({
          index: attachmentIndex++,
          name: file.name,
          key: `local:${file.localPath}`,
        })
        result = mergeAttachmentContent(result, attachment)
      }
    }
  }

  if (msg.links) {
    for (const link of msg.links) {
      if (link.storageKey) {
        const content = attachmentContents.get(link.storageKey)
        if (content) {
          const attachment = buildAttachment({
            index: attachmentIndex++,
            name: link.title,
            key: link.storageKey,
            content,
            modelSupportToolUseForFile,
          })
          result = mergeAttachmentContent(result, attachment)
        }
      }
    }
  }

  return result
}

interface AttachmentParams {
  index: number
  name: string
  key: string
  content: string
  modelSupportToolUseForFile: boolean
}

function buildAttachment(params: AttachmentParams): string {
  const { index, name, key, content, modelSupportToolUseForFile } = params
  const lines = content.split('\n')
  const fileLines = lines.length
  const fileSize = content.length

  const shouldTruncate = modelSupportToolUseForFile && fileLines > MAX_INLINE_FILE_LINES

  let prefix = '\n\n<ATTACHMENT_FILE>\n'
  prefix += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  prefix += `<FILE_NAME>${name}</FILE_NAME>\n`
  prefix += `<FILE_KEY>${key}</FILE_KEY>\n`
  prefix += `<FILE_LINES>${fileLines}</FILE_LINES>\n`
  prefix += `<FILE_SIZE>${fileSize} bytes</FILE_SIZE>\n`
  prefix += '<FILE_CONTENT>\n'

  const contentToAdd = shouldTruncate ? lines.slice(0, PREVIEW_LINES).join('\n') : content

  let suffix = '</FILE_CONTENT>\n'
  if (shouldTruncate) {
    suffix += `<TRUNCATED>Content truncated. Showing first ${PREVIEW_LINES} of ${fileLines} lines. Use read_file or search_file_content tool with FILE_KEY="${key}" to read more content.</TRUNCATED>\n`
  }
  suffix += '</ATTACHMENT_FILE>\n'

  return prefix + contentToAdd + '\n' + suffix
}

function buildRetrievalAttachment(params: {
  index: number
  name: string
  key: string
  status: string
  blockedReason?: string
}): string {
  const { index, name, key, status, blockedReason } = params
  let text = '\n\n<ATTACHMENT_FILE>\n'
  text += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  text += `<FILE_NAME>${name}</FILE_NAME>\n`
  text += `<FILE_KEY>${key}</FILE_KEY>\n`
  text += '<FILE_CONTENT>\n'
  text += '</FILE_CONTENT>\n'
  text += '<RETRIEVAL_MODE>session_attachment_rag</RETRIEVAL_MODE>\n'
  text += `<INDEX_STATUS>${status}</INDEX_STATUS>\n`
  if (blockedReason) {
    text += `<BLOCKED_REASON>${blockedReason}</BLOCKED_REASON>\n`
  }
  text += [
    '<SYSTEM_REMINDER>',
    'This uploaded file is indexed for retrieval, not inlined in the conversation. ',
    'For document-specific questions about this file, use query_session_attachment and then ',
    'read_session_attachment_parents before answering. If the user asks something unrelated to the uploaded file, ',
    'answer normally without retrieval.',
    '</SYSTEM_REMINDER>\n',
  ].join('')
  text += '</ATTACHMENT_FILE>\n'
  return text
}

function buildSandboxAttachment(params: {
  index: number
  name: string
  key: string
  size: string
  sandboxPath: string
  parsedSandboxPath?: string
  retrieval?: {
    status: string
    blockedReason?: string
  }
}): string {
  const { index, name, key, size, sandboxPath, parsedSandboxPath, retrieval } = params
  let text = '\n\n<ATTACHMENT_FILE>\n'
  text += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  text += `<FILE_NAME>${escapeXmlText(name)}</FILE_NAME>\n`
  text += `<FILE_KEY>${escapeXmlText(key)}</FILE_KEY>\n`
  text += `<FILE_SIZE>${escapeXmlText(size)}</FILE_SIZE>\n`
  text += '<FILE_CONTENT>\n'
  text += '</FILE_CONTENT>\n'
  text += '<SANDBOX_MODE>true</SANDBOX_MODE>\n'
  text += `<SANDBOX_PATH>${escapeXmlText(sandboxPath)}</SANDBOX_PATH>\n`
  if (parsedSandboxPath) {
    text += `<PARSED_SANDBOX_PATH>${escapeXmlText(parsedSandboxPath)}</PARSED_SANDBOX_PATH>\n`
  }
  if (retrieval) {
    text += '<RETRIEVAL_MODE>session_attachment_rag</RETRIEVAL_MODE>\n'
    text += `<INDEX_STATUS>${escapeXmlText(retrieval.status)}</INDEX_STATUS>\n`
    if (retrieval.blockedReason) {
      text += `<BLOCKED_REASON>${escapeXmlText(retrieval.blockedReason)}</BLOCKED_REASON>\n`
    }
    text += [
      '<SYSTEM_REMINDER>',
      'This uploaded file is indexed for retrieval and is also available in the sandbox working directory. ',
      'For document-specific questions about this file, use query_session_attachment and then ',
      'read_session_attachment_parents before answering. Use code_execution or read_file when direct file processing is needed.',
      '</SYSTEM_REMINDER>\n',
    ].join('')
  } else {
    text += [
      '<SYSTEM_REMINDER>',
      'This uploaded file is available in the sandbox working directory, not inlined in the conversation. ',
      parsedSandboxPath
        ? 'Use read_file on PARSED_SANDBOX_PATH for extracted text, or code_execution on SANDBOX_PATH for the original binary. Use those paths exactly — uploads that share a filename live in distinct subdirectories.'
        : 'Use read_file or code_execution on SANDBOX_PATH to inspect it. Use that path exactly — uploads that share a filename live in distinct subdirectories.',
      '</SYSTEM_REMINDER>\n',
    ].join('')
  }
  text += '</ATTACHMENT_FILE>\n'
  return text
}

function buildToolOnlyAttachment(params: { index: number; name: string; key: string }): string {
  const { index, name, key } = params
  let text = '\n\n<ATTACHMENT_FILE>\n'
  text += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  text += `<FILE_NAME>${name}</FILE_NAME>\n`
  text += `<FILE_KEY>${key}</FILE_KEY>\n`
  text += '<FILE_CONTENT>\n'
  text += '</FILE_CONTENT>\n'
  text += `<TRUNCATED>Content preview unavailable. Use read_file or search_file_content tool with FILE_KEY="${key}" to inspect this file.</TRUNCATED>\n`
  text += '</ATTACHMENT_FILE>\n'
  return text
}

function mergeAttachmentContent(message: Message, attachmentText: string): Message {
  const contentParts = message.contentParts ?? []
  const existingText = contentParts.find((p) => p.type === 'text')?.text ?? ''
  const newText = existingText + attachmentText

  const nonTextParts = contentParts.filter((p) => p.type !== 'text')
  const textPart = { type: 'text' as const, text: newText }

  return {
    ...message,
    contentParts: [...nonTextParts, textPart],
  }
}
