import { buildSessionExportThreads } from '@chatbox/core/utils/chat-export'
import type { ExportChatFormat, ExportChatScope } from '@shared/types'
import { formatChatAsHtml, formatChatAsInteractiveHtml, formatChatAsMarkdown, formatChatAsTxt } from '@/lib/format-chat'
import platform from '@/platform'
import { rendererApplication } from '@/app/renderer-application'

export async function exportSessionChat(
  sessionId: string,
  content: ExportChatScope,
  format: ExportChatFormat,
  includeAllBranches = false
) {
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!session) {
    return
  }
  const includeArchivedThreads = content === 'all_threads'
  const shouldFlattenBranches = includeAllBranches && format !== 'HTML'
  const threads = buildSessionExportThreads(session, includeArchivedThreads, shouldFlattenBranches)

  if (format === 'Markdown') {
    const exportedContent = formatChatAsMarkdown(session.name, threads)
    await platform.exporter.exportTextFile(`${session.name}.md`, exportedContent)
  } else if (format === 'TXT') {
    const exportedContent = formatChatAsTxt(session.name, threads)
    await platform.exporter.exportTextFile(`${session.name}.txt`, exportedContent)
  } else if (format === 'HTML') {
    const exportedContent = includeAllBranches
      ? await formatChatAsInteractiveHtml(session.name, threads, session.messageForksHash)
      : await formatChatAsHtml(session.name, threads)
    await platform.exporter.exportTextFile(`${session.name}.html`, exportedContent)
  }
}
