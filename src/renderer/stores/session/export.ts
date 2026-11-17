import { formatSessionAsJson, openSessionChatExport } from '@chatbox/core/utils/chat-export'
import type { ExportChatFormat, ExportChatScope } from '@shared/types'
import { formatChatAsHtml, formatChatAsInteractiveHtml, formatChatAsMarkdown, formatChatAsTxt } from '@/lib/format-chat'
import platform from '@/platform'
import { rendererApplication } from '@/app/renderer-application'

async function source(sessionId: string) {
  return openSessionChatExport(platform.getSessionRowStore(), rendererApplication.sessions, sessionId)
}

export async function exportSessionJson(sessionId: string): Promise<string | null> {
  const read = await source(sessionId)
  return read ? formatSessionAsJson(read) : null
}

export async function exportSessionChat(
  sessionId: string,
  content: ExportChatScope,
  format: ExportChatFormat,
  includeAllBranches = false
) {
  const read = await source(sessionId)
  if (!read) return
  const includeArchived = content === 'all_threads'
  const threads = read.formattedThreads(includeArchived, includeAllBranches && format !== 'HTML')
  const exported =
    format === 'Markdown'
      ? await formatChatAsMarkdown(read.header.name, threads)
      : format === 'TXT'
        ? await formatChatAsTxt(read.header.name, threads)
        : includeAllBranches
          ? await formatChatAsInteractiveHtml(read, includeArchived)
          : await formatChatAsHtml(read.header.name, threads)
  await read.assertCurrent()
  const extension = format === 'Markdown' ? 'md' : format.toLowerCase()
  await platform.exporter.exportTextFile(`${read.header.name}.${extension}`, exported)
}
