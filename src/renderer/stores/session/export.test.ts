import type { ExportChatFormat, Message, Session } from '@shared/types'
import { createMessage } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ExportedThread = { name: string; messages: Message[] }

const {
  mockGetSession,
  mockExportTextFile,
  mockFormatHtml,
  mockFormatInteractiveHtml,
  mockFormatMarkdown,
  mockFormatTxt,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockExportTextFile: vi.fn(),
  // Typed like the real formatters so `mock.calls[0][1]` keeps the thread type.
  mockFormatHtml: vi.fn(async (_sessionName: string, _threads: ExportedThread[]) => '<html></html>'),
  mockFormatInteractiveHtml: vi.fn(
    async (_sessionName: string, _threads: ExportedThread[]) => '<html>interactive</html>'
  ),
  mockFormatMarkdown: vi.fn((_sessionName: string, _threads: ExportedThread[]) => '# export'),
  mockFormatTxt: vi.fn((_sessionName: string, _threads: ExportedThread[]) => 'export'),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessionQueryBridge: { getSession: mockGetSession } },
}))

vi.mock('@/platform', () => ({
  default: {
    exporter: {
      exportTextFile: mockExportTextFile,
    },
  },
}))

vi.mock('@/lib/format-chat', () => ({
  formatChatAsHtml: mockFormatHtml,
  formatChatAsInteractiveHtml: mockFormatInteractiveHtml,
  formatChatAsMarkdown: mockFormatMarkdown,
  formatChatAsTxt: mockFormatTxt,
}))

import { exportSessionChat } from './export'

function createBranchedSession(): Session {
  const pivot = createMessage('user', 'question')
  pivot.id = 'pivot'
  const replies = ['branch-one', 'branch-two', 'branch-active'].map((text) => {
    const reply = createMessage('assistant', text)
    reply.id = text
    return reply
  })
  return {
    id: 'session-1',
    name: 'Branched session',
    threadName: 'Current conversation',
    messages: [pivot, replies[2]],
    messageForksHash: {
      [pivot.id]: {
        position: 2,
        createdAt: 1,
        lists: [
          { id: 'list-one', messages: [replies[0]] },
          { id: 'list-two', messages: [replies[1]] },
          { id: 'list-active', messages: [] },
        ],
      },
    },
  }
}

describe('exportSessionChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(createBranchedSession())
  })

  it.each<ExportChatFormat>(['HTML', 'Markdown', 'TXT'])(
    'exports only the active branch as %s by default',
    async (format) => {
      await exportSessionChat('session-1', 'current_thread', format)

      const formatter = format === 'HTML' ? mockFormatHtml : format === 'Markdown' ? mockFormatMarkdown : mockFormatTxt
      const exportedThreads = formatter.mock.calls[0]?.[1] ?? []
      const exportedReplies = exportedThreads.map((thread) => {
        const reply = thread.messages.at(-1)
        return reply?.contentParts.find((part) => part.type === 'text')?.text
      })
      expect(exportedReplies).toEqual(['branch-active'])
      expect(mockExportTextFile).toHaveBeenCalledOnce()
    }
  )

  it('preserves the fork tree for interactive HTML when every branch is requested', async () => {
    const session = createBranchedSession()
    mockGetSession.mockResolvedValue(session)

    await exportSessionChat('session-1', 'current_thread', 'HTML', true)

    expect(mockFormatHtml).not.toHaveBeenCalled()
    expect(mockFormatInteractiveHtml).toHaveBeenCalledWith(
      session.name,
      [{ name: session.threadName, messages: session.messages }],
      session.messageForksHash
    )
    expect(mockExportTextFile).toHaveBeenCalledWith(`${session.name}.html`, '<html>interactive</html>')
  })

  it.each<ExportChatFormat>(['Markdown', 'TXT'])('flattens every branch for %s when requested', async (format) => {
    await exportSessionChat('session-1', 'current_thread', format, true)

    const formatter = format === 'Markdown' ? mockFormatMarkdown : mockFormatTxt
    const exportedThreads = formatter.mock.calls[0]?.[1] ?? []
    const exportedReplies = exportedThreads.map((thread) => {
      const reply = thread.messages.at(-1)
      return reply?.contentParts.find((part) => part.type === 'text')?.text
    })
    expect(exportedReplies).toEqual(['branch-one', 'branch-two', 'branch-active'])
    expect(mockExportTextFile).toHaveBeenCalledOnce()
  })
})
