import type { Message, Session, SessionMetaRecord } from '@shared/types'
import { InMemorySessionRepository } from '@chatbox/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/packages/initial_data', () => ({
  defaultSessionsForCN: [{ id: 'builtin-cn' }],
  defaultSessionsForEN: [{ id: 'builtin-en' }],
}))

const { readWindowMock, listAllSessionsMetaMock } = vi.hoisted(() => ({
  readWindowMock: vi.fn(),
  listAllSessionsMetaMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { listAllSessionsMeta: listAllSessionsMetaMock, readSessionTranscriptWindow: readWindowMock },
  },
}))
import {
  FIRST_SUCCESSFUL_CHAT_KEY,
  getHasCompletedFirstSuccessfulChat,
  markFirstSuccessfulChatCompleted,
  resetFirstSuccessfulChatForDebug,
} from './firstSuccessfulChat'
import {
  hasContentForAutoTitle,
  hasSuccessfulUserAssistantTurn,
  isSuccessfulAssistantReply,
} from './session/message-success'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()

  get length() {
    return this.data.size
  }

  clear(): void {
    this.data.clear()
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('localStorage unavailable')
  }
}

const listAllSessionsMeta = listAllSessionsMetaMock
let repository: InMemorySessionRepository

function installLocalStorage(storage: Storage = new MemoryStorage()) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

function textMessage(role: Message['role'], text: string, overrides: Partial<Message> = {}): Message {
  return {
    id: `${role}-${text}`,
    role,
    contentParts: text ? [{ type: 'text', text }] : [],
    ...overrides,
  }
}

function toolResultMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-tool-result',
    role: 'assistant',
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'tool-1',
        toolName: 'test_tool',
        result: { ok: true },
      },
    ],
    ...overrides,
  }
}

function session(id: string, messages: Message[], overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    type: 'chat',
    messages,
    ...overrides,
  }
}

function meta(id: string, overrides: Partial<SessionMetaRecord> = {}): SessionMetaRecord {
  return {
    id,
    name: id,
    type: 'chat',
    sortOrder: 1,
    createdAt: 1,
    ...overrides,
  }
}

describe('firstSuccessfulChat', () => {
  beforeEach(() => {
    installLocalStorage()
    vi.clearAllMocks()
    repository = new InMemorySessionRepository()
    readWindowMock.mockImplementation(repository.readSessionTranscriptWindow)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks and resets the localStorage sentinel', () => {
    markFirstSuccessfulChatCompleted()
    expect(localStorage.getItem(FIRST_SUCCESSFUL_CHAT_KEY)).toBe('1')

    resetFirstSuccessfulChatForDebug()
    expect(localStorage.getItem(FIRST_SUCCESSFUL_CHAT_KEY)).toBeNull()
  })

  it('respects stored completed value without scanning sessions', async () => {
    localStorage.setItem(FIRST_SUCCESSFUL_CHAT_KEY, '1')

    await expect(getHasCompletedFirstSuccessfulChat()).resolves.toBe(true)
    expect(listAllSessionsMeta).not.toHaveBeenCalled()
  })

  it('respects stored incomplete value without scanning sessions', async () => {
    localStorage.setItem(FIRST_SUCCESSFUL_CHAT_KEY, '0')

    await expect(getHasCompletedFirstSuccessfulChat()).resolves.toBe(false)
    expect(listAllSessionsMeta).not.toHaveBeenCalled()
  })

  it('ignores built-in template sessions during missing-key inference', async () => {
    listAllSessionsMeta.mockResolvedValue([meta('builtin-en'), meta('builtin-cn')])

    await expect(getHasCompletedFirstSuccessfulChat()).resolves.toBe(false)
    expect(readWindowMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(FIRST_SUCCESSFUL_CHAT_KEY)).toBe('0')
  })

  it('detects a successful non-template user-assistant turn during missing-key inference', async () => {
    const userSession = session('user-session', [
      textMessage('system', 'rules'),
      textMessage('user', 'hello'),
      textMessage('assistant', 'hi'),
    ])
    listAllSessionsMeta.mockResolvedValue([meta('builtin-en'), meta('user-session')])
    await repository.seedSession(userSession)

    await expect(getHasCompletedFirstSuccessfulChat()).resolves.toBe(true)
    expect(readWindowMock).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'user-session', limit: 50 }))
    expect(localStorage.getItem(FIRST_SUCCESSFUL_CHAT_KEY)).toBe('1')
  })

  it('ignores hidden and non-chat sessions during missing-key inference', async () => {
    listAllSessionsMeta.mockResolvedValue([
      meta('hidden-session', { hidden: true }),
      meta('picture-session', { type: 'picture' }),
    ])

    await expect(getHasCompletedFirstSuccessfulChat()).resolves.toBe(false)
    expect(readWindowMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(FIRST_SUCCESSFUL_CHAT_KEY)).toBe('0')
  })

  it('fails closed when localStorage is unavailable', async () => {
    installLocalStorage(new ThrowingStorage())

    await expect(getHasCompletedFirstSuccessfulChat()).resolves.toBe(true)
    expect(listAllSessionsMeta).not.toHaveBeenCalled()
  })

  it('recognizes successful assistant replies', () => {
    expect(isSuccessfulAssistantReply(textMessage('assistant', 'done'))).toBe(true)
    expect(isSuccessfulAssistantReply(toolResultMessage())).toBe(true)
  })

  it('rejects assistant replies that should not complete the first chat', () => {
    expect(isSuccessfulAssistantReply(textMessage('assistant', '', { generating: true }))).toBe(false)
    expect(isSuccessfulAssistantReply(textMessage('assistant', 'failed', { error: 'boom' }))).toBe(false)
    expect(isSuccessfulAssistantReply(textMessage('assistant', 'failed', { errorCode: 500 }))).toBe(false)
    expect(isSuccessfulAssistantReply(textMessage('assistant', 'partial', { finishReason: 'canceled' }))).toBe(false)
    expect(isSuccessfulAssistantReply(textMessage('assistant', 'blocked', { finishReason: 'content-filter' }))).toBe(
      false
    )
    expect(
      isSuccessfulAssistantReply(
        textMessage('assistant', '', {
          finishReason: 'agent-mode-suggested',
          contentParts: [{ type: 'agent-mode-suggestion', reason: 'test' }],
        })
      )
    ).toBe(false)
    expect(
      isSuccessfulAssistantReply(
        toolResultMessage({
          finishReason: 'tool-call-paused',
          contentParts: [
            {
              type: 'tool-call',
              state: 'paused',
              toolCallId: 'tool-1',
              toolName: 'test_tool',
            },
          ],
        })
      )
    ).toBe(false)
  })

  it('requires a previous user message in the same message list', () => {
    expect(hasSuccessfulUserAssistantTurn([textMessage('assistant', 'hi')])).toBe(false)
    expect(hasSuccessfulUserAssistantTurn([textMessage('user', 'hello'), textMessage('assistant', 'hi')])).toBe(true)
  })

  it('allows auto-title content while an assistant reply is still generating', () => {
    expect(
      hasContentForAutoTitle([textMessage('user', 'hello'), textMessage('assistant', '', { generating: true })])
    ).toBe(true)
    expect(
      hasSuccessfulUserAssistantTurn([
        textMessage('user', 'hello'),
        textMessage('assistant', 'working on it', { generating: true }),
      ])
    ).toBe(false)
  })

  it('allows auto-title content for a resumed reply carrying a stale paused finish reason', () => {
    // Resuming a paused tool call flips generating back to true without clearing
    // finishReason: 'tool-call-paused'; the stale reason must not block naming.
    expect(
      hasContentForAutoTitle([
        textMessage('user', 'hello'),
        textMessage('assistant', '', {
          generating: true,
          finishReason: 'tool-call-paused',
          contentParts: [
            {
              type: 'tool-call',
              state: 'call',
              toolCallId: 'tool-1',
              toolName: 'test_tool',
            },
          ],
        }),
      ])
    ).toBe(true)
    // A settled paused reply (not generating) stays ineligible.
    expect(
      hasContentForAutoTitle([
        textMessage('user', 'hello'),
        textMessage('assistant', 'partial', { finishReason: 'tool-call-paused' }),
      ])
    ).toBe(false)
  })

  it('rejects auto-title content for failed or suggestion-only replies', () => {
    expect(
      hasContentForAutoTitle([
        textMessage('user', 'hello'),
        textMessage('assistant', 'partial', { finishReason: 'canceled' }),
      ])
    ).toBe(false)
    expect(
      hasContentForAutoTitle([
        textMessage('user', 'hello'),
        textMessage('assistant', '', {
          finishReason: 'agent-mode-suggested',
          contentParts: [{ type: 'agent-mode-suggestion', reason: 'test' }],
        }),
      ])
    ).toBe(false)
  })

  it('checks archived thread messages through bounded pages', async () => {
    await repository.seedSession(
      session('threaded', [], {
        threads: [
          {
            id: 'thread-1',
            name: 'Thread',
            createdAt: 1,
            messages: [textMessage('user', 'hello'), textMessage('assistant', 'hi')],
          },
        ],
      })
    )
    listAllSessionsMeta.mockResolvedValue([meta('threaded')])
    await expect(getHasCompletedFirstSuccessfulChat()).resolves.toBe(true)
  })

  it('finds a turn spanning pages without pairing messages across threads', async () => {
    const filler = Array.from({ length: 50 }, (_, index) => textMessage('system', `rules-${index}`))
    await repository.seedSession(
      session('paged', [textMessage('user', 'hello'), ...filler, textMessage('assistant', 'hi')])
    )
    listAllSessionsMeta.mockResolvedValue([meta('paged')])
    await expect(getHasCompletedFirstSuccessfulChat()).resolves.toBe(true)
    expect(readWindowMock).toHaveBeenCalledTimes(2)
    localStorage.removeItem(FIRST_SUCCESSFUL_CHAT_KEY)
    await repository.seedSession(
      session('paged', [textMessage('assistant', 'hi')], {
        threads: [{ id: 'earlier', name: 'Earlier', createdAt: 1, messages: [textMessage('user', 'hello')] }],
      })
    )
    await expect(getHasCompletedFirstSuccessfulChat()).resolves.toBe(false)
  })
})
