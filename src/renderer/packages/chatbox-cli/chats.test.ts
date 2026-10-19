import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import type { Session } from '@shared/types'

const { getHeaderMock, readTranscriptMock, readSearchWindowMock, readSearchCandidatesMock, listSessionsMetaPageMock } =
  vi.hoisted(() => ({
    getHeaderMock: vi.fn(),
    readTranscriptMock: vi.fn(),
    readSearchWindowMock: vi.fn(),
    readSearchCandidatesMock: vi.fn(),
    listSessionsMetaPageMock: vi.fn(),
  }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: {
      listSessionsMetaPage: listSessionsMetaPageMock,
      listArchivedSessionsMetaPage: vi.fn(),
      getSessionHeader: getHeaderMock,
      readSessionTranscriptWindow: readTranscriptMock,
      readSessionSearchWindow: readSearchWindowMock,
      readSessionSearchCandidates: readSearchCandidatesMock,
    },
  },
}))
import { chatCommands } from './chats'
import { parseArguments } from './parser'
import type { ChatboxCliCommandContext } from './types'

function command(name: string) {
  const result = chatCommands.find((candidate) => candidate.path[1] === name)
  if (!result) throw new Error(`Missing chats command: ${name}`)
  return result
}
function context(argv: string[]): ChatboxCliCommandContext {
  return { argv, parsed: parseArguments(argv), displayCommand: `chatbox chats ${argv.join(' ')}`, approved: false }
}
async function seed(value: Session) {
  const repository = new InMemorySessionRepository()
  await repository.seedSession(value)
  getHeaderMock.mockImplementation((id: string) => repository.getSessionHeader(id))
  readTranscriptMock.mockImplementation(repository.readSessionTranscriptWindow)
  readSearchWindowMock.mockImplementation(repository.readSessionSearchWindow)
  readSearchCandidatesMock.mockImplementation(repository.readSessionSearchCandidates)
  listSessionsMetaPageMock.mockResolvedValue({
    items: [{ id: value.id, name: value.name, sortOrder: 1 }],
    nextCursor: null,
    total: 1,
  })
  return repository
}

describe('Chatbox CLI history reads', () => {
  beforeEach(() => vi.clearAllMocks())
  it('exposes reusable image keys from image-only messages', async () => {
    await seed({
      id: 's1',
      name: 'Images',
      messages: [{ id: 'image-1', role: 'user', contentParts: [{ type: 'image', storageKey: 'picture:reference' }] }],
    })
    await expect(command('read').execute(context(['s1']))).resolves.toMatchObject({
      messages: [{ images: [{ storageKey: 'picture:reference' }] }],
      nextCursor: null,
    })
  })
  it('lists compact metadata with pagination', async () => {
    listSessionsMetaPageMock.mockResolvedValue({
      items: [{ id: 's1', name: 'Project', sortOrder: 1, createdAt: 100, starred: true }],
      nextCursor: 1,
      total: 2,
    })
    await expect(command('list').execute(context(['--limit', '1']))).resolves.toMatchObject({
      items: [{ id: 's1', name: 'Project', starred: true }],
      nextCursor: 1,
      total: 2,
    })
  })
  it('reads compact visible content and uses a revision-bound continuation', async () => {
    await seed({
      id: 's1',
      name: 'Project',
      messages: [
        { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'secret system prompt' }] },
        { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] },
        {
          id: 'assistant',
          role: 'assistant',
          contentParts: [
            { type: 'reasoning', text: 'private chain of thought' },
            { type: 'tool-call', state: 'result', toolCallId: 't1', toolName: 'x', result: { secret: true } },
            { type: 'text', text: 'visible answer' },
          ],
        },
      ],
    })
    const result = await command('read').execute(context(['s1', '--limit', '1']))
    expect(JSON.stringify(result)).toContain('visible answer')
    expect(JSON.stringify(result)).not.toContain('private chain of thought')
    expect(JSON.stringify(result)).not.toContain('"secret":true')
    expect(typeof result.nextCursor).toBe('string')
    const next = await command('read').execute(context(['s1', '--limit', '1', '--cursor', String(result.nextCursor)]))
    expect(JSON.stringify(next)).toContain('hello')
    expect(
      readTranscriptMock.mock.calls.every(([request]) => request.limit === 1 && request.maxBytes === 2 * 1024 * 1024)
    ).toBe(true)
  })
  it('searches only visible conversational text and returns lightweight hits', async () => {
    await seed({
      id: 's1',
      name: 'Project',
      messages: [
        { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'secret match' }] },
        {
          id: 'background',
          role: 'user',
          contentParts: [{ type: 'text', text: 'automated match' }],
          backgroundTask: {
            id: 'task',
            type: 'image_generation',
            status: 'completed',
            recordId: 'record',
            startedAt: 1,
            finishedAt: 2,
            elapsedMs: 1,
            summary: 'done',
          },
        },
        { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'visible match' }] },
      ],
    })
    const result = await command('search').execute(context(['match']))
    expect(result.hits).toEqual([
      { sessionId: 's1', sessionName: 'Project', messageId: 'user', preview: 'visible match' },
    ])
  })
})
