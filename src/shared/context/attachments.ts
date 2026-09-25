import { isTextFilePath } from '../file-extensions'
import {
  sandboxAttachmentIdentity,
  sandboxAttachmentParsedRelPath,
  sandboxAttachmentRelPath,
} from '../sandbox/attachment-path'
import type { Message, MessageFile, MessageLink } from '../types'
import { MAX_UPLOADED_FILE_LINES, uploadedFilePath, uploadedFileToolHint } from '../uploaded-file-tools'
import {
  ATTACHMENT_INDEX_STATUS_GUIDANCE,
  FOCUSED_ATTACHMENT_QUERY_GUIDANCE,
  WHOLE_DOCUMENT_READ_GUIDANCE,
} from './attachment-guidance'
import type { AttachmentResolver } from './types'

const MAX_INLINE_FILE_LINES = MAX_UPLOADED_FILE_LINES
export const PREVIEW_LINES = 100

export type AttachmentContentMode = 'full' | 'preview'
export interface AttachmentPolicy {
  modelSupportToolUseForFile?: boolean
  sandboxMode?: boolean
}
export type AttachmentPlanEntry =
  | { kind: 'text'; text: string }
  | {
      kind: 'content'
      attachment: MessageFile | MessageLink
      attachmentType: 'file' | 'link'
      index: number
      contentMode: AttachmentContentMode
    }

export function getAttachmentContentMode(
  lineCount: number | undefined,
  modelSupportToolUseForFile = false
): AttachmentContentMode {
  return modelSupportToolUseForFile && (lineCount ?? 0) > MAX_INLINE_FILE_LINES ? 'preview' : 'full'
}

/** The attachment payload shape shared by request construction and token estimation. */
export function planMessageAttachments(message: Message, policy: AttachmentPolicy = {}): AttachmentPlanEntry[] {
  const plan: AttachmentPlanEntry[] = []
  let index = 1
  for (const file of message.files ?? []) {
    if (policy.sandboxMode) {
      const isText = isTextFilePath(file.name)
      const sandboxPath = sandboxAttachmentRelPath(file.name, sandboxAttachmentIdentity(file))
      plan.push({
        kind: 'text',
        text: buildSandboxAttachment({
          index: index++,
          name: file.name,
          key: file.sessionAttachmentId
            ? `session-attachment:${file.sessionAttachmentId}`
            : (file.storageKey ?? file.id),
          size: formatFileSize(file.byteLength),
          lineCount: file.lineCount,
          isText,
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
        }),
      })
    } else if (file.ragMode === 'session-retrieval') {
      plan.push({
        kind: 'text',
        text: buildRetrievalAttachment({
          index: index++,
          name: file.name,
          key: file.sessionAttachmentId
            ? `session-attachment:${file.sessionAttachmentId}`
            : (file.storageKey ?? file.id),
          status: file.sessionAttachmentIndexStatus ?? file.sessionAttachmentStatus ?? 'pending',
          blockedReason: file.sessionAttachmentBlockedReason,
        }),
      })
    } else if (file.storageKey) {
      plan.push({
        kind: 'content',
        attachment: file,
        attachmentType: 'file',
        index: index++,
        contentMode: getAttachmentContentMode(file.lineCount, policy.modelSupportToolUseForFile),
      })
    } else if (file.localPath && policy.modelSupportToolUseForFile) {
      plan.push({
        kind: 'text',
        text: buildToolOnlyAttachment({ index: index++, name: file.name, key: `local:${file.localPath}` }),
      })
    }
  }
  if (!policy.sandboxMode)
    for (const link of message.links ?? []) {
      if (link.storageKey)
        plan.push({
          kind: 'content',
          attachment: link,
          attachmentType: 'link',
          index: index++,
          contentMode: getAttachmentContentMode(link.lineCount, policy.modelSupportToolUseForFile),
        })
    }
  return plan
}

export async function injectAttachments(
  messages: Message[],
  resolver: AttachmentResolver,
  modelSupportToolUseForFile: boolean,
  sandboxMode: boolean,
  onMissingAttachment?: (storageKey: string) => void
): Promise<Message[]> {
  const plans = messages.map((message) => planMessageAttachments(message, { modelSupportToolUseForFile, sandboxMode }))
  const keys = [
    ...new Set(
      plans.flatMap((plan) =>
        plan.flatMap((entry) =>
          entry.kind === 'content' && entry.attachment.storageKey ? [entry.attachment.storageKey] : []
        )
      )
    ),
  ]
  const contents = new Map<string, string>()
  await Promise.all(
    keys.map(async (key) => {
      const content = await resolver.read(key).catch(() => null)
      if (content === null) onMissingAttachment?.(key)
      else contents.set(key, content)
    })
  )
  return messages.map((message, i) =>
    plans[i].reduce(
      (result, entry) => {
        if (entry.kind === 'text') return mergeAttachmentContent(result, entry.text)
        const content = contents.get(entry.attachment.storageKey ?? '')
        if (!content) return result
        return mergeAttachmentContent(
          result,
          buildAttachment({
            index: entry.index,
            name:
              entry.attachmentType === 'file'
                ? (entry.attachment as MessageFile).name
                : (entry.attachment as MessageLink).title,
            key: entry.attachment.storageKey ?? '',
            content,
            modelSupportToolUseForFile,
          })
        )
      },
      { ...message }
    )
  )
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

interface AttachmentParams {
  index: number
  name: string
  key: string
  content: string
  modelSupportToolUseForFile: boolean
  contentMode?: AttachmentContentMode
}

export function buildAttachment(params: AttachmentParams): string {
  const { index, name, key, content, modelSupportToolUseForFile } = params
  const lines = content.split('\n')
  const fileLines = lines.length
  const fileSize = content.length

  const shouldTruncate =
    (params.contentMode ?? getAttachmentContentMode(fileLines, modelSupportToolUseForFile)) === 'preview'

  let prefix = '\n\n<ATTACHMENT_FILE>\n'
  prefix += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  prefix += `<FILE_NAME>${escapeXmlText(name)}</FILE_NAME>\n`
  prefix += `<FILE_PATH>${uploadedFilePath(key)}</FILE_PATH>\n`
  prefix += `<FILE_LINES>${fileLines}</FILE_LINES>\n`
  prefix += `<FILE_SIZE>${fileSize} bytes</FILE_SIZE>\n`
  prefix += '<FILE_CONTENT>\n'

  const contentToAdd = shouldTruncate ? lines.slice(0, PREVIEW_LINES).join('\n') : content

  let suffix = '</FILE_CONTENT>\n'
  if (shouldTruncate) {
    suffix += `<TRUNCATED>Content truncated. Showing first ${PREVIEW_LINES} of ${fileLines} lines. ${uploadedFileToolHint(key)}</TRUNCATED>\n`
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
  text += `<FILE_NAME>${escapeXmlText(name)}</FILE_NAME>\n`
  text += `<FILE_KEY>${escapeXmlText(key.startsWith('session-attachment:') ? key : uploadedFilePath(key))}</FILE_KEY>\n`
  text += '<FILE_CONTENT>\n'
  text += '</FILE_CONTENT>\n'
  text += '<RETRIEVAL_MODE>session_attachment_rag</RETRIEVAL_MODE>\n'
  text += `<INDEX_STATUS>${escapeXmlText(status)}</INDEX_STATUS>\n`
  if (blockedReason) {
    text += `<BLOCKED_REASON>${escapeXmlText(blockedReason)}</BLOCKED_REASON>\n`
  }
  text += [
    '<SYSTEM_REMINDER>',
    'This uploaded file is indexed for retrieval, not inlined in the conversation. ',
    FOCUSED_ATTACHMENT_QUERY_GUIDANCE,
    ' Full-document tasks require sequential access to the complete text. Search hits alone cannot establish full coverage. ',
    'If no direct reading tool or text path is available, explain that limitation rather than claiming a complete conversion.',
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
  lineCount?: number
  isText: boolean
  sandboxPath: string
  parsedSandboxPath?: string
  retrieval?: {
    status: string
    blockedReason?: string
  }
}): string {
  const { index, name, key, size, lineCount, isText, sandboxPath, parsedSandboxPath, retrieval } = params
  let text = '\n\n<ATTACHMENT_FILE>\n'
  text += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  text += `<FILE_NAME>${escapeXmlText(name)}</FILE_NAME>\n`
  text += `<FILE_KEY>${escapeXmlText(key.startsWith('session-attachment:') ? key : uploadedFilePath(key))}</FILE_KEY>\n`
  text += `<FILE_SIZE>${escapeXmlText(size)}</FILE_SIZE>\n`
  text += '<FILE_CONTENT>\n'
  text += '</FILE_CONTENT>\n'
  text += '<SANDBOX_MODE>true</SANDBOX_MODE>\n'
  text += `<SANDBOX_PATH>${escapeXmlText(sandboxPath)}</SANDBOX_PATH>\n`
  if (parsedSandboxPath) {
    text += `<PARSED_SANDBOX_PATH>${escapeXmlText(parsedSandboxPath)}</PARSED_SANDBOX_PATH>\n`
  }
  text += `<PARSED_TEXT_STATUS>${isText ? 'not_required' : parsedSandboxPath ? 'available' : 'unavailable'}</PARSED_TEXT_STATUS>\n`
  const hasTextSource = isText || !!parsedSandboxPath
  if (hasTextSource) {
    const knownLineCount = lineCount !== undefined && Number.isInteger(lineCount) && lineCount >= 0
    text += `<FILE_LINES>${knownLineCount ? lineCount : 'unknown'}</FILE_LINES>\n`
  }
  if (retrieval) {
    text += '<RETRIEVAL_MODE>session_attachment_rag</RETRIEVAL_MODE>\n'
    text += `<INDEX_STATUS>${escapeXmlText(retrieval.status)}</INDEX_STATUS>\n`
    if (retrieval.blockedReason) {
      text += `<BLOCKED_REASON>${escapeXmlText(retrieval.blockedReason)}</BLOCKED_REASON>\n`
    }
  }
  text += [
    '<SYSTEM_REMINDER>',
    'This uploaded file is available in the sandbox working directory, not inlined in the conversation. ',
    parsedSandboxPath
      ? 'Use read_file on PARSED_SANDBOX_PATH for extracted text, or code_execution on SANDBOX_PATH for the original binary. Use those paths exactly — uploads that share a filename live in distinct subdirectories.'
      : 'Use read_file or code_execution on SANDBOX_PATH to inspect it. Use that path exactly — uploads that share a filename live in distinct subdirectories.',
    ' ',
    WHOLE_DOCUMENT_READ_GUIDANCE,
    ' File metadata does not verify text completeness; confirm contents and totalLines with read_file.',
    retrieval ? ` ${FOCUSED_ATTACHMENT_QUERY_GUIDANCE} ${ATTACHMENT_INDEX_STATUS_GUIDANCE}` : '',
    '</SYSTEM_REMINDER>\n',
  ].join('')
  text += '</ATTACHMENT_FILE>\n'
  return text
}

function buildToolOnlyAttachment(params: { index: number; name: string; key: string }): string {
  const { index, name, key } = params
  let text = '\n\n<ATTACHMENT_FILE>\n'
  text += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  text += `<FILE_NAME>${escapeXmlText(name)}</FILE_NAME>\n`
  text += `<FILE_PATH>${uploadedFilePath(key)}</FILE_PATH>\n`
  text += '<FILE_CONTENT>\n'
  text += '</FILE_CONTENT>\n'
  text += `<TRUNCATED>Content preview unavailable. ${uploadedFileToolHint(key)}</TRUNCATED>\n`
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
