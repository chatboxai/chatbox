import { forkTailStartIndex } from '../session/message-forks'
import type { Message, MessageToolCallPart, Session, SessionThread } from '../types/session'
import { getMessageText } from './message'

/** Minimal thread shape shared by every export formatter. */
export type ExportableThread = Pick<SessionThread, 'name' | 'messages'>

function expandMessageBranches(
  messages: Message[],
  messageForksHash: Session['messageForksHash'],
  visitedForkIds: ReadonlySet<string> = new Set()
): Message[][] {
  if (!messageForksHash) {
    return [messages]
  }

  const forkMessageIndex = messages.findIndex(
    (message) => Boolean(messageForksHash[message.id]) && !visitedForkIds.has(message.id)
  )
  if (forkMessageIndex < 0) {
    return [messages]
  }

  const forkMessage = messages[forkMessageIndex]
  const fork = messageForksHash[forkMessage.id]
  if (!fork || fork.lists.length === 0) {
    return [messages]
  }

  const tailStart = forkTailStartIndex(messages, forkMessageIndex)
  const sharedPrefix = messages.slice(0, tailStart)
  const activeTail = messages.slice(tailStart)
  const activePosition =
    Number.isInteger(fork.position) && fork.position >= 0 && fork.position < fork.lists.length ? fork.position : 0
  const nextVisitedForkIds = new Set(visitedForkIds).add(forkMessage.id)

  return fork.lists.flatMap((branch, position) => {
    const branchTail = position === activePosition ? activeTail : branch.messages
    return expandMessageBranches(branchTail, messageForksHash, nextVisitedForkIds).map((expandedTail) => [
      ...sharedPrefix,
      ...expandedTail,
    ])
  })
}

/**
 * Build ordinary export threads for Markdown/TXT and non-interactive HTML.
 * Exporting all branches is opt-in because flattening duplicates shared
 * prefixes and can produce a large document for deeply nested forks.
 */
export function buildSessionExportThreads(
  session: Session,
  includeArchivedThreads: boolean,
  includeAllBranches = false
): ExportableThread[] {
  const threads: ExportableThread[] = includeArchivedThreads ? [...(session.threads ?? [])] : []
  threads.push({
    name: session.threadName || session.name,
    messages: session.messages,
  })
  if (!includeAllBranches) {
    return threads
  }

  return threads.flatMap((thread) => {
    const branches = expandMessageBranches(thread.messages, session.messageForksHash)
    if (branches.length === 1) {
      return [thread]
    }
    return branches.map((messages, index) => ({
      name: `${thread.name} (Branch ${index + 1}/${branches.length})`,
      messages,
    }))
  })
}

export type ToolCallSummary = {
  id: string
  toolName: string
  state: MessageToolCallPart['state']
  args?: unknown
  result?: unknown
}

export function collectToolCallSummaries(message: Message): Map<string, ToolCallSummary> {
  const summaries = new Map<string, ToolCallSummary>()
  for (const part of message.contentParts ?? []) {
    if (part.type !== 'tool-call') continue
    const existing = summaries.get(part.toolCallId) ?? {
      id: part.toolCallId,
      toolName: part.toolName,
      state: part.state,
    }
    existing.toolName = part.toolName
    existing.state = part.state
    if (part.args !== undefined) existing.args = part.args
    if (part.result !== undefined) existing.result = part.result
    summaries.set(part.toolCallId, existing)
  }
  return summaries
}

function tryParseJsonString(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return value
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed)
    } catch (_error) {
      return value
    }
  }
  return value
}

export function stringifyDataForExport(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const normalized = typeof value === 'string' ? tryParseJsonString(value) : value
  if (typeof normalized === 'string') return normalized
  try {
    return JSON.stringify(normalized, null, 2)
  } catch (_error) {
    return String(normalized)
  }
}

export function indentMultiline(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n')
}

export function getAttachmentNames(message: Message): string[] {
  return message.files?.map((file) => file.name).filter(Boolean) ?? []
}

export function renderToolCallMarkdown(summary: ToolCallSummary): string {
  let content = `Tool Call: ${summary.toolName} (state: ${summary.state})\n`
  const argsText = stringifyDataForExport(summary.args)
  if (argsText) content += `Args:\n${indentMultiline(argsText, '  ')}\n`
  const resultText = stringifyDataForExport(summary.result)
  if (resultText) content += `Result:\n${indentMultiline(resultText, '  ')}\n`
  return `${content}\n`
}

export function renderToolCallTxt(summary: ToolCallSummary): string {
  let content = `    Tool Call: ${summary.toolName} (state: ${summary.state})\n`
  const argsText = stringifyDataForExport(summary.args)
  if (argsText) content += `      Args:\n${indentMultiline(argsText, '        ')}\n`
  const resultText = stringifyDataForExport(summary.result)
  if (resultText) content += `      Result:\n${indentMultiline(resultText, '        ')}\n`
  return `${content}\n`
}

/**
 * Plain-text Markdown/TXT chat export. Shared between the renderer (desktop/web) and the
 * native mobile shell so the two stop drifting on per-part / per-message formatting.
 * HTML export stays in the renderer (`lib/format-chat.tsx`) because it needs DOM rendering.
 */
export function formatChatAsMarkdown(sessionName: string, threads: ExportableThread[]): string {
  let content = `# ${sessionName}\n\n`
  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i]
    content += `## ${i + 1}. ${thread.name}\n\n`
    for (const msg of thread.messages) {
      const attachments = getAttachmentNames(msg)
      const toolCallSummaries = collectToolCallSummaries(msg)
      const renderedToolCalls = new Set<string>()
      const textBuffer: string[] = []
      const flushTextBuffer = () => {
        if (textBuffer.length === 0) {
          return
        }
        const sanitized = textBuffer.join('\n').replaceAll(/```\w*/g, '')
        content += '```\n' + sanitized + '\n```\n\n'
        textBuffer.length = 0
      }
      content += `**${msg.role}**: \n\n`
      if (msg.contentParts?.length) {
        for (const part of msg.contentParts) {
          if (part.type === 'tool-call') {
            if (renderedToolCalls.has(part.toolCallId)) {
              continue
            }
            const summary = toolCallSummaries.get(part.toolCallId)
            if (!summary) {
              continue
            }
            flushTextBuffer()
            content += renderToolCallMarkdown(summary)
            renderedToolCalls.add(part.toolCallId)
            continue
          }
          if (part.type === 'text') {
            textBuffer.push(part.text)
            continue
          }
          if (part.type === 'image') {
            textBuffer.push('[image]')
            continue
          }
          if (part.type === 'info') {
            textBuffer.push(part.text)
          }
        }
        flushTextBuffer()
      } else {
        content += '```\n' + getMessageText(msg).replaceAll(/```\w*/g, '') + '\n```\n\n'
      }
      if (attachments.length > 0) {
        content += 'Attachments:\n'
        for (const name of attachments) {
          content += `- ${name}\n`
        }
        content += '\n'
      }
    }
    content += '\n\n'
  }
  content += '--------------------\n\n'
  content += `
<a href="https://chatboxai.app" style="display: flex; align-items: center;">
<img src='https://chatboxai.app/icon.png' style='width: 40px; height: 40px; padding-right: 6px'>
<b style='font-size:30px'>Chatbox AI</b>
</a>
`
  return content
}

export function formatChatAsTxt(sessionName: string, threads: ExportableThread[]): string {
  let content = `==================================== [[${sessionName}]] ====================================`
  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i]
    content += `\n\n------------------------------ [${i + 1}. ${thread.name}] ------------------------------\n\n`
    for (const msg of thread.messages) {
      const attachments = getAttachmentNames(msg)
      const toolCallSummaries = collectToolCallSummaries(msg)
      const renderedToolCalls = new Set<string>()
      const textBuffer: string[] = []
      const flushTextBuffer = () => {
        if (textBuffer.length === 0) {
          return
        }
        content += `${textBuffer.join('\n')}\n\n`
        textBuffer.length = 0
      }
      content += `▶ ${msg.role.toUpperCase()}: \n\n`
      if (msg.contentParts?.length) {
        for (const part of msg.contentParts) {
          if (part.type === 'tool-call') {
            if (renderedToolCalls.has(part.toolCallId)) {
              continue
            }
            const summary = toolCallSummaries.get(part.toolCallId)
            if (!summary) {
              continue
            }
            flushTextBuffer()
            content += renderToolCallTxt(summary)
            renderedToolCalls.add(part.toolCallId)
            continue
          }
          if (part.type === 'text') {
            textBuffer.push(part.text)
            continue
          }
          if (part.type === 'image') {
            textBuffer.push('[image]')
            continue
          }
          if (part.type === 'info') {
            textBuffer.push(part.text)
          }
        }
        flushTextBuffer()
      } else {
        content += `${getMessageText(msg)}\n\n`
      }
      content += '\n'
      if (attachments.length > 0) {
        content += '  Attachments:\n'
        for (const name of attachments) {
          content += `    - ${name}\n`
        }
        content += '\n'
      }
    }
    content += '\n\n\n\n'
  }
  content += `========================================================================\n\n`
  content += `Chatbox AI (https://chatboxai.app)`
  return content
}
