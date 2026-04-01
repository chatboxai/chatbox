import '../setup'

import type { ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import type { ModelInterface, CallChatCompletionOptions } from '@shared/models/types'
import type { Message, StreamTextResult } from '@shared/types'
import { streamText } from '@/packages/model-calls/stream-text'
import { buildAppAwareSessionFixture, buildPartialLifecycleSessionFixture } from '../fixtures/app-aware-session'

function createTextMessage(id: string, role: Message['role'], text: string, timestamp: number): Message {
  return {
    id,
    role,
    timestamp,
    contentParts: [{ type: 'text', text }],
  }
}

function createModelStub() {
  const chat = vi.fn(
    async (_messages: ModelMessage[], _options: CallChatCompletionOptions): Promise<StreamTextResult> => ({
      contentParts: [{ type: 'text', text: 'app-aware reply' }],
    })
  )

  const model: ModelInterface = {
    name: 'Test ChatBridge Model',
    modelId: 'test-chatbridge-model',
    isSupportVision: () => true,
    isSupportToolUse: () => false,
    isSupportSystemMessage: () => true,
    chat,
    paint: vi.fn(async () => []),
  }

  return { chat, model }
}

function getInjectedSystemPrompt(coreMessages: ModelMessage[]) {
  const systemMessage = coreMessages.find((message) => message.role === 'system')
  expect(systemMessage).toBeDefined()
  expect(typeof systemMessage?.content).toBe('string')
  return systemMessage?.content as string
}

describe('ChatBridge active app context injection regression coverage', () => {
  it('injects the latest active host-owned app summary into later-turn model context', async () => {
    const fixture = buildAppAwareSessionFixture()
    const { chat, model } = createModelStub()

    const result = await streamText(model, {
      sessionId: 'session-app-active',
      messages: [
        ...fixture.sessionInput.messages,
        createTextMessage('msg-follow-up-user', 'user', 'Keep working from that draft and suggest the next scene.', 4),
      ],
      appRecords: fixture.sessionInput.chatBridgeAppRecords,
      onResultChangeWithCancel: vi.fn(),
    })

    expect(chat).toHaveBeenCalledOnce()
    const systemPrompt = getInjectedSystemPrompt(result.coreMessages)

    expect(systemPrompt).toContain('ChatBridge active app context (host-owned and normalized):')
    expect(systemPrompt).toContain('App ID: story-builder')
    expect(systemPrompt).toContain('Lifecycle: active')
    expect(systemPrompt).toContain('Restored the active story draft and preserved the exportable checkpoint.')
  })

  it('injects an explicit unavailable fallback when the latest app state is stale', async () => {
    const fixture = buildPartialLifecycleSessionFixture()
    const { chat, model } = createModelStub()

    const result = await streamText(model, {
      sessionId: 'session-app-stale',
      messages: [
        createTextMessage(
          'msg-stale-system',
          'system',
          'Keep app follow-up continuity grounded in host-owned summaries only.',
          0
        ),
        ...fixture.messages,
        createTextMessage('msg-follow-up-user', 'user', 'Can you rely on the last app state here?', 3),
      ],
      appRecords: fixture.chatBridgeAppRecords,
      onResultChangeWithCancel: vi.fn(),
    })

    expect(chat).toHaveBeenCalledOnce()
    const systemPrompt = getInjectedSystemPrompt(result.coreMessages)

    expect(systemPrompt).toContain('ChatBridge latest app context is unavailable:')
    expect(systemPrompt).toContain('Lifecycle: stale')
    expect(systemPrompt).toContain('Do not pretend you can see exact current app state')
  })
})
