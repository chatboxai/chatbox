/**
 * Env-gated live regression test for Anthropic thinking-signature replay after a
 * paused tool continuation (the app-restart / tool-approval resume path).
 *
 * Run:
 *   TEST_CLAUDE_API_KEY=... pnpm test:model-provider -- anthropic-thinking-replay
 *
 * Do not read the repo .env here: in this repository it may be a 1Password FIFO,
 * and dotenv can block before Vitest has a chance to skip the suite.
 */
import { appendFileSync } from 'node:fs'
import { createInitialState, processStreamChunk, type StreamProcessorState } from '@chatbox/core/generation'
import { type ToolSet, tool } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import TestPlatform from '../../../src/renderer/platform/test_platform'
import { settings as getDefaultSettings, newConfigs, SystemProviders } from '../../../src/shared/defaults'
import type AbstractAISDKModel from '../../../src/shared/models/abstract-ai-sdk'
import type { ModelStreamPart } from '../../../src/shared/models/types'
import { getModel } from '../../../src/shared/providers'
import { convertToModelMessages } from '../../../src/shared/services/model-message-converter'
import {
  type Message,
  MessageContentPartsSchema,
  ModelProviderEnum,
  type SessionSettings,
  type Settings,
} from '../../../src/shared/types'
import { createMockModelDependencies } from '../mocks/model-dependencies'
import { MockSentryAdapter } from '../mocks/sentry'

const TEST_CLAUDE_API_KEY = process.env.TEST_CLAUDE_API_KEY || process.env.CLAUDE_API_KEY || ''
const TEST_CLAUDE_API_HOST = process.env.CLAUDE_API_HOST || process.env.TEST_CLAUDE_API_HOST || ''
const TEST_MODEL = process.env.TEST_CLAUDE_MODEL || 'claude-haiku-4-5-20251001'
const DEBUG_LOG = '/tmp/anthropic-thinking-replay-test-debug.log'

const THINKING_PROVIDER_OPTIONS = { claude: { thinking: { type: 'enabled', budgetTokens: 1024 } } }

const USER_PROMPT =
  'Use the run_code tool to execute print(21+21) and then tell me the result. You must call the tool; do not compute the answer yourself.'

function debugLog(label: string, value: unknown) {
  appendFileSync(
    DEBUG_LOG,
    `\n===== ${label} =====\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`
  )
}

function buildTools(executed: string[]): ToolSet {
  return {
    run_code: tool({
      description: 'Execute a snippet of python code and return its stdout.',
      inputSchema: z.object({ code: z.string() }),
      execute: ({ code }) => {
        executed.push(code)
        return { success: true, stdout: '42\n' }
      },
    }),
  }
}

function summarizeRequestBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const record = body as Record<string, unknown>
  const thinking = record.thinking
  const messages = Array.isArray(record.messages) ? record.messages : []
  return {
    model: record.model,
    max_tokens: record.max_tokens,
    thinking,
    messageCount: messages.length,
    messages: messages.map((message) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return message
      const item = message as Record<string, unknown>
      const content = Array.isArray(item.content) ? item.content : []
      return {
        role: item.role,
        parts: content.map((part) => {
          if (!part || typeof part !== 'object' || Array.isArray(part)) return part
          const block = part as Record<string, unknown>
          return {
            type: block.type,
            hasSignature: typeof block.signature === 'string',
            signatureLen: typeof block.signature === 'string' ? block.signature.length : 0,
            thinkingLen: typeof block.thinking === 'string' ? block.thinking.length : 0,
            textLen: typeof block.text === 'string' ? block.text.length : 0,
            keys: Object.keys(block),
          }
        }),
      }
    }),
  }
}

function installRequestSpy() {
  const originalFetch = globalThis.fetch
  const captured: unknown[] = []
  globalThis.fetch = (input, init) => {
    if (typeof init?.body === 'string') {
      try {
        captured.push(summarizeRequestBody(JSON.parse(init.body)))
      } catch {
        captured.push({ parseError: true })
      }
    }
    return originalFetch(input, init)
  }
  return {
    captured,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}

async function createClaudeModel() {
  const platform = new TestPlatform()
  const dependencies = await createMockModelDependencies(platform, new MockSentryAdapter())
  const systemProvider = SystemProviders().find((provider) => provider.id === ModelProviderEnum.Claude)
  if (!systemProvider) throw new Error('Claude provider not found')
  const globalSettings: Settings = {
    ...getDefaultSettings(),
    providers: {
      [ModelProviderEnum.Claude]: {
        ...systemProvider.defaultSettings,
        apiKey: TEST_CLAUDE_API_KEY,
        ...(TEST_CLAUDE_API_HOST ? { apiHost: TEST_CLAUDE_API_HOST } : {}),
        models: [{ modelId: TEST_MODEL, capabilities: ['tool_use', 'reasoning'] }],
      },
    },
  }
  const sessionSettings: SessionSettings = {
    provider: ModelProviderEnum.Claude,
    modelId: TEST_MODEL,
    maxTokens: 4096,
    stream: true,
  }
  return getModel(sessionSettings, globalSettings, newConfigs(), dependencies) as AbstractAISDKModel
}

async function runStreamAndCollectParts(
  model: AbstractAISDKModel,
  messages: Awaited<ReturnType<typeof convertToModelMessages>>,
  tools: ToolSet,
  maxSteps?: number
): Promise<StreamProcessorState> {
  const stream = model.chatStream(messages, {
    tools,
    maxSteps,
    providerOptions: THINKING_PROVIDER_OPTIONS,
  }) as AsyncGenerator<ModelStreamPart<ToolSet>>
  let state = createInitialState()
  for await (const chunk of stream) {
    const result = await processStreamChunk(chunk, state, {
      onFileReceived: async () => 'unused-storage-key',
      onLargeToolResult: async () => 'unused-storage-key',
    })
    state = result.state
  }
  return state
}

function persistenceRoundTrip(state: StreamProcessorState) {
  return MessageContentPartsSchema.parse(JSON.parse(JSON.stringify(state.contentParts)))
}

function rebuildContinueRequest(persistedParts: ReturnType<typeof persistenceRoundTrip>) {
  const messages: Message[] = [
    { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: USER_PROMPT }] },
    { id: 'a1', role: 'assistant', contentParts: persistedParts },
  ]
  return convertToModelMessages(messages, async () => null, {
    modelSupportVision: true,
    preserveReasoning: 'all-turns',
    signedReasoningOnly: true,
  })
}

describe.runIf(TEST_CLAUDE_API_KEY)('Anthropic thinking signature live round trip', () => {
  it('continues a paused tool run after replaying persisted thinking signatures', async () => {
    const model = await createClaudeModel()
    const executed: string[] = []
    const tools = buildTools(executed)

    const firstRun = await runStreamAndCollectParts(
      model,
      await convertToModelMessages(
        [{ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: USER_PROMPT }] }],
        async () => null,
        { modelSupportVision: true }
      ),
      tools,
      1
    )

    debugLog('phase1 contentParts', firstRun.contentParts)
    const reasoningParts = firstRun.contentParts.filter((part) => part.type === 'reasoning')
    const toolCallParts = firstRun.contentParts.filter((part) => part.type === 'tool-call')
    expect(toolCallParts.length).toBeGreaterThanOrEqual(1)
    expect(
      reasoningParts.some(
        (part) => part.providerMetadata?.anthropic?.signature || part.providerMetadata?.anthropic?.redactedData
      )
    ).toBe(true)

    const continueMessages = await rebuildContinueRequest(persistenceRoundTrip(firstRun))
    debugLog('continue request messages', continueMessages)

    // The replayed assistant turn must carry the thinking blocks back and must
    // not contain any empty text block (Anthropic rejects those outright).
    const assistantMessage = continueMessages.find((message) => message.role === 'assistant')
    const assistantParts = Array.isArray(assistantMessage?.content) ? assistantMessage.content : []
    expect(assistantParts.some((part) => part.type === 'reasoning')).toBe(true)
    expect(assistantParts.some((part) => part.type === 'text' && !part.text)).toBe(false)

    const spy = installRequestSpy()
    let secondRun: StreamProcessorState
    try {
      secondRun = await runStreamAndCollectParts(model, continueMessages, tools)
    } catch (error) {
      debugLog('continue request wire bodies', spy.captured)
      spy.restore()
      throw error
    }
    debugLog('continue request wire bodies', spy.captured)
    spy.restore()
    debugLog('continue result', {
      finishReason: secondRun.finishReason,
      calls: executed.length,
      parts: secondRun.contentParts,
    })
    expect(secondRun.finishReason).toBeTruthy()
    expect(secondRun.finishReason).not.toBe('error')
  }, 180_000)
})
