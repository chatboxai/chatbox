import type { Message, MessageToolCallPart } from '../types/session'
import { getMessageText } from './message'
import type { ExportableThread } from './row-chat-export'
export {
  type ExportableThread,
  type SessionChatExport,
  openSessionChatExport,
  formatSessionAsJson,
} from './row-chat-export'

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
export async function formatChatAsMarkdown(
  sessionName: string,
  threads: AsyncIterable<ExportableThread> | Iterable<ExportableThread>
): Promise<string> {
  let content = `# ${sessionName}\n\n`
  let i = 0
  for await (const thread of threads) {
    i++
    content += `## ${i}. ${thread.name}\n\n`
    for await (const msg of thread.messages) {
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

export async function formatChatAsTxt(
  sessionName: string,
  threads: AsyncIterable<ExportableThread> | Iterable<ExportableThread>
): Promise<string> {
  let content = `==================================== [[${sessionName}]] ====================================`
  let i = 0
  for await (const thread of threads) {
    i++
    content += `\n\n------------------------------ [${i}. ${thread.name}] ------------------------------\n\n`
    for await (const msg of thread.messages) {
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
