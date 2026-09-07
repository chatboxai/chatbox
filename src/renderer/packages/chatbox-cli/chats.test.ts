import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, listSessionsMetaPageMock, searchSessionsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  listSessionsMetaPageMock: vi.fn(),
  searchSessionsMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: {
      listSessionsMetaPage: listSessionsMetaPageMock,
      listArchivedSessionsMetaPage: vi.fn(),
    },
    sessionQueryBridge: { getSession: getSessionMock },
  },
}))
vi.mock('@/stores/sessionHelpers', () => ({ searchSessions: searchSessionsMock }))

import { chatCommands } from './chats'
import { parseArguments } from './parser'
import type { ChatboxCliCommandContext } from './types'

function command(name: string) {
  const result = chatCommands.find((candidate) => candidate.path[1] === name)
  if (!result) throw new Error(`Missing chats command: ${name}`)
  return result
}

function context(argv: string[]): ChatboxCliCommandContext {
  return {
    argv,
    parsed: parseArguments(argv),
    displayCommand: `chatbox chats ${argv.join(' ')}`,
    approved: false,
  }
}

describe('Chatbox CLI history reads', () => {
  beforeEach(() => vi.clearAllMocks())

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

  it('reads only compact visible message content, excluding system and tool payloads', async () => {
    getSessionMock.mockResolvedValue({
      id: 's1',
      name: 'Project',
      messages: [
        { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'secret system prompt' }] },
        { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'hello' }], timestamp: 1 },
        {
          id: 'background',
          role: 'user',
          contentParts: [{ type: 'text', text: 'automated callback payload' }],
          backgroundTask: {
            id: 'task-1',
            type: 'image_generation',
            status: 'completed',
            recordId: 'record-1',
            startedAt: 1,
            finishedAt: 2,
            elapsedMs: 1,
            summary: 'done',
          },
        },
        {
          id: 'assistant',
          role: 'assistant',
          contentParts: [
            { type: 'reasoning', text: 'private chain of thought' },
            { type: 'tool-call', state: 'result', toolCallId: 't1', toolName: 'x', result: { secret: true } },
            { type: 'text', text: 'visible answer' },
          ],
          timestamp: 2,
        },
      ],
    })

    const result = await command('read').execute(context(['s1']))
    const serialized = JSON.stringify(result)
    expect(serialized).toContain('hello')
    expect(serialized).toContain('visible answer')
    expect(serialized).not.toContain('secret system prompt')
    expect(serialized).not.toContain('private chain of thought')
    expect(serialized).not.toContain('"secret":true')
    expect(serialized).not.toContain('automated callback payload')
  })

  it('does not return system messages from search results', async () => {
    searchSessionsMock.mockImplementation(
      (_query: string, _sessionId: string | undefined, onResult: (sessions: unknown[]) => void) => {
        onResult([
          {
            id: 's1',
            name: 'Project',
            messages: [
              { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'secret system prompt' }] },
              {
                id: 'background',
                role: 'user',
                contentParts: [{ type: 'text', text: 'automated callback payload' }],
                backgroundTask: {
                  id: 'task-1',
                  type: 'image_generation',
                  status: 'completed',
                  recordId: 'record-1',
                  startedAt: 1,
                  finishedAt: 2,
                  elapsedMs: 1,
                  summary: 'done',
                },
              },
              { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'visible match' }] },
            ],
          },
        ])
      }
    )

    const result = await command('search').execute(context(['match']))
    const serialized = JSON.stringify(result)
    expect(serialized).toContain('visible match')
    expect(serialized).not.toContain('secret system prompt')
    expect(serialized).not.toContain('"role":"system"')
    expect(serialized).not.toContain('automated callback payload')
  })
})
