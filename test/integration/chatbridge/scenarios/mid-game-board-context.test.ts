import '../setup'

import type { ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import type { ModelInterface } from '@shared/models/types'
import type { CallChatCompletionOptions } from '@shared/models/types'
import type { Message, StreamTextResult } from '@shared/types'
import { streamText } from '@/packages/model-calls/stream-text'
import {
  buildChatBridgeChessMidGameSessionFixture,
  createAppLifecycleMessage,
} from '../fixtures/app-aware-session'

function createTextMessage(id: string, role: Message['role'], text: string, timestamp: number): Message {
  return {
    id,
    role,
    timestamp,
    contentParts: [{ type: 'text', text }],
  }
}

function createModelStub() {
  const chat = vi.fn(async (_messages: ModelMessage[], _options: CallChatCompletionOptions): Promise<StreamTextResult> => ({
    contentParts: [{ type: 'text', text: 'board-aware reply' }],
  }))

  const model: ModelInterface = {
    name: 'Test ChatBridge Model',
    modelId: 'test-chatbridge-model',
    isSupportVision: () => true,
    isSupportToolUse: () => false,
    isSupportSystemMessage: () => true,
    chat,
    paint: vi.fn(async () => []),
  }

  return {
    chat,
    model,
  }
}

function getInjectedSystemPrompt(coreMessages: ModelMessage[]) {
  const systemMessage = coreMessages.find((message) => message.role === 'system')
  expect(systemMessage).toBeDefined()
  expect(typeof systemMessage?.content).toBe('string')
  return systemMessage?.content as string
}

describe('ChatBridge mid-game board context regression coverage', () => {
  it('injects the latest active chess board summary into the model path before chat execution', async () => {
    const fixture = buildChatBridgeChessMidGameSessionFixture()
    const { chat, model } = createModelStub()

    const result = await streamText(model, {
      sessionId: 'session-chess-live',
      messages: fixture.messages,
      onResultChangeWithCancel: vi.fn(),
    })

    expect(chat).toHaveBeenCalledOnce()
    expect(result.coreMessages).toHaveLength(fixture.messages.length)

    const systemPrompt = getInjectedSystemPrompt(result.coreMessages)

    expect(systemPrompt).toContain('ChatBridge active Chess context (host-owned and normalized):')
    expect(systemPrompt).toContain('Context state: live')
    expect(systemPrompt).toContain('Board FEN: r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6')
    expect(systemPrompt).toContain('Side to move: white')
    expect(systemPrompt).toContain('Host note: White to move in an Italian Game structure after ...e5.')
    expect(systemPrompt).toContain('Use only this bounded host summary for position-specific chess advice.')
  })

  it('marks stale chess state explicitly in the model prompt instead of pretending the board is live', async () => {
    const { chat, model } = createModelStub()
    const messages: Message[] = [
      createTextMessage(
        'msg-chess-stale-system',
        'system',
        'Keep Chess reasoning grounded in host-owned context even when the session is stale.',
        1
      ),
      createTextMessage('msg-chess-stale-user', 'user', 'Resume the last chess position if you can.', 2),
      createAppLifecycleMessage(
        'msg-chess-stale-assistant',
        'assistant',
        'The last known Chess board is available, but the host marked it stale.',
        {
          appId: 'chess',
          appName: 'Chess',
          toolCallId: 'tool-chess-stale',
          lifecycle: 'stale',
          summary: 'The last known board is available, but it may be outdated.',
          snapshot: {
            route: '/apps/chess',
            status: 'stale',
            boardContext: {
              schemaVersion: 1,
              fen: 'r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6',
              sideToMove: 'white',
              fullmoveNumber: 6,
              legalMovesCount: 33,
              positionStatus: 'in_progress',
              lastMove: {
                san: '...e5',
                uci: 'e7e5',
              },
              summary: 'White to move in an Italian Game structure after ...e5.',
            },
          },
          timestamp: 3,
        }
      ),
      createTextMessage('msg-chess-stale-follow-up', 'user', 'Should White still aim for c3 and d4?', 4),
    ]

    const result = await streamText(model, {
      sessionId: 'session-chess-stale',
      messages,
      onResultChangeWithCancel: vi.fn(),
    })

    expect(chat).toHaveBeenCalledOnce()

    const systemPrompt = getInjectedSystemPrompt(result.coreMessages)

    expect(systemPrompt).toContain('Context state: stale')
    expect(systemPrompt).toContain('The host marks this board snapshot as stale.')
    expect(systemPrompt).toContain('ask the user to refresh or resume the board')
    expect(systemPrompt).not.toContain('Context state: live')
  })
})
