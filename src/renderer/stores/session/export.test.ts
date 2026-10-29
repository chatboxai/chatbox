import { InMemorySessionRepository } from '@chatbox/core/testing'
import type { ExportableThread, SessionChatExport } from '@chatbox/core/utils/chat-export'
import type { ExportChatFormat, Session } from '@shared/types'
import { createMessage } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getHeader: vi.fn(),
  forks: vi.fn(),
  rows: vi.fn(),
  exportFile: vi.fn(),
  formatted: vi.fn(async (_name: string, threads: AsyncIterable<ExportableThread> | Iterable<ExportableThread>) => {
    const result: string[][] = []
    for await (const thread of threads) {
      const texts: string[] = []
      for await (const message of thread.messages)
        texts.push(message.contentParts.find((part) => part.type === 'text')?.text ?? '')
      result.push(texts)
    }
    return JSON.stringify(result)
  }),
  interactive: vi.fn(async (_source: SessionChatExport, _archived: boolean) => '<html>interactive</html>'),
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: {
      getSessionHeader: mocks.getHeader,
      readSessionForkOptionsPage: mocks.forks,
    },
  },
}))
vi.mock('@/platform', () => ({
  default: { getSessionRowStore: mocks.rows, exporter: { exportTextFile: mocks.exportFile } },
}))
vi.mock('@/lib/format-chat', () => ({
  formatChatAsHtml: mocks.formatted,
  formatChatAsMarkdown: mocks.formatted,
  formatChatAsTxt: mocks.formatted,
  formatChatAsInteractiveHtml: mocks.interactive,
}))
import { exportSessionChat, exportSessionJson } from './export'

function createBranchedSession(): Session {
  const pivot = createMessage('user', 'question')
  pivot.id = 'pivot'
  pivot.timestamp = 1
  const replies = ['branch-one', 'branch-two', 'branch-active'].map((text) => {
    const reply = createMessage('assistant', text)
    reply.id = text
    reply.timestamp = 1
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

describe('row session export', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const repository = new InMemorySessionRepository()
    await repository.seedSession(createBranchedSession())
    mocks.getHeader.mockImplementation(repository.getSessionHeader)
    mocks.forks.mockImplementation(repository.readSessionForkOptionsPage)
    mocks.rows.mockReturnValue(repository.rowStore)
  })

  it.each<ExportChatFormat>(['HTML', 'Markdown', 'TXT'])('exports the active branch as %s', async (format) => {
    await exportSessionChat('session-1', 'current_thread', format)
    expect(mocks.exportFile.mock.calls[0]?.[1]).toBe(JSON.stringify([['question', 'branch-active']]))
  })

  it('passes the independent row source to interactive HTML', async () => {
    await exportSessionChat('session-1', 'all_threads', 'HTML', true)
    expect(mocks.interactive.mock.calls[0]?.[0].header.name).toBe('Branched session')
    expect(mocks.interactive.mock.calls[0]?.[1]).toBe(true)
    expect(mocks.exportFile).toHaveBeenCalledWith('Branched session.html', '<html>interactive</html>')
  })

  it.each<ExportChatFormat>(['Markdown', 'TXT'])('exports all branches as %s', async (format) => {
    await exportSessionChat('session-1', 'current_thread', format, true)
    expect(mocks.exportFile.mock.calls[0]?.[1]).toBe(
      JSON.stringify([
        ['question', 'branch-one'],
        ['question', 'branch-two'],
        ['question', 'branch-active'],
      ])
    )
  })

  it('provides JSON to the separate viewer', async () => {
    const json = await exportSessionJson('session-1')
    expect(JSON.parse(json ?? 'null')).toMatchObject(createBranchedSession())
    expect(mocks.exportFile).not.toHaveBeenCalled()
  })

  it('does not publish a file for a missing session', async () => {
    mocks.getHeader.mockResolvedValue(null)
    expect(await exportSessionJson('missing')).toBeNull()
    await exportSessionChat('missing', 'all_threads', 'TXT')
    expect(mocks.exportFile).not.toHaveBeenCalled()
  })
})
