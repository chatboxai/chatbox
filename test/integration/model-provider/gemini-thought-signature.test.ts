/**
 * Env-gated live regression test for Gemini 3 thought_signature history replay.
 *
 * Run:
 *   CHATBOX_LICENSE_KEY=... pnpm test:model-provider -- gemini-thought-signature
 *
 * Do not read the repo .env here: in this repository it may be a 1Password FIFO,
 * and dotenv can block before Vitest has a chance to skip the suite.
 */
import { appendFileSync } from 'node:fs'
import { type ToolSet, tool } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createInitialState, processStreamChunk, type StreamProcessorState } from '@chatbox/core/generation'
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

const CHATBOX_LICENSE_KEY = process.env.CHATBOX_LICENSE_KEY || ''
const TEST_MODEL = 'gemini-3.1-pro'
const DEBUG_LOG = '/tmp/gemini-sig-test-debug.log'

const USER_PROMPT =
  '我要测试工具调用次数，不要向我提问，直接开始。请严格按下面要求做，不要合并步骤：对 1 到 5 这 5 个数字，每个数字单独调用一次 run_code 工具执行 print(数字)，每次只输出这一个数字。必须分成 5 次独立的工具调用，绝对不要用循环，也不要一次输出多个数字。现在立刻调用 run_code 执行 print(1) 开始。'

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
        const match = code.match(/print\((\d+)\)/)
        return { success: true, stdout: match ? `${match[1]}\n` : '' }
      },
    }),
  }
}

async function createGeminiModel() {
  const platform = new TestPlatform()
  const dependencies = await createMockModelDependencies(platform, new MockSentryAdapter())
  const systemProvider = SystemProviders().find((provider) => provider.id === ModelProviderEnum.ChatboxAI)
  if (!systemProvider) throw new Error('ChatboxAI provider not found')
  const globalSettings: Settings = {
    ...getDefaultSettings(),
    licenseKey: CHATBOX_LICENSE_KEY,
    providers: {
      [ModelProviderEnum.ChatboxAI]: {
        ...systemProvider.defaultSettings,
        models: [{ modelId: TEST_MODEL, apiStyle: 'google', capabilities: ['tool_use', 'reasoning'] }],
      },
    },
  }
  const sessionSettings: SessionSettings = {
    provider: ModelProviderEnum.ChatboxAI,
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
  const stream = model.chatStream(messages, { tools, maxSteps }) as AsyncGenerator<ModelStreamPart<ToolSet>>
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

function persistenceRoundTrip(state: StreamProcessorState, stripProviderMetadata: boolean) {
  const raw = JSON.parse(JSON.stringify(state.contentParts))
  if (stripProviderMetadata) {
    for (const part of raw) {
      delete part.providerMetadata
      delete part.resultProviderMetadata
    }
  }
  return MessageContentPartsSchema.parse(raw)
}

function rebuildContinueRequest(persistedParts: ReturnType<typeof persistenceRoundTrip>, prompt = USER_PROMPT) {
  const messages: Message[] = [
    { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: prompt }] },
    { id: 'a1', role: 'assistant', contentParts: persistedParts },
  ]
  return convertToModelMessages(messages, async () => null, {
    modelSupportVision: true,
    ensureGoogleFunctionCallSignatures: true,
  })
}

describe.runIf(CHATBOX_LICENSE_KEY)('Gemini 3 thought_signature live round trip', () => {
  it('continues after a tool-call history replay with persisted provider metadata', async () => {
    const model = await createGeminiModel()
    const executed: string[] = []
    const tools = buildTools(executed)

    const firstRun = await runStreamAndCollectParts(
      model,
      await convertToModelMessages(
        [{ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: USER_PROMPT }] }],
        async () => null,
        {
          modelSupportVision: true,
        }
      ),
      tools,
      3
    )

    const toolCallParts = firstRun.contentParts.filter((part) => part.type === 'tool-call')
    debugLog('positive: phase1 contentParts', firstRun.contentParts)
    expect(toolCallParts.length).toBeGreaterThanOrEqual(2)
    expect(toolCallParts.some((part) => part.providerMetadata?.google?.thoughtSignature)).toBe(true)

    const continueMessages = await rebuildContinueRequest(persistenceRoundTrip(firstRun, false))
    debugLog('positive: continue request messages', continueMessages)
    const secondRun = await runStreamAndCollectParts(model, continueMessages, tools)
    debugLog('positive: continue result', { finishReason: secondRun.finishReason, calls: executed.length })
    expect(secondRun.finishReason).toBeTruthy()
    expect(secondRun.finishReason).not.toBe('error')
  }, 180_000)

  it('continues after a parallel tool-call batch where only the first call is signed', async () => {
    const model = await createGeminiModel()
    const executed: string[] = []
    const tools = buildTools(executed)
    const parallelPrompt =
      '请在你的下一个回复里【同时并行】调用 run_code 工具 5 次，分别执行 print(1)、print(2)、print(3)、print(4)、print(5)。必须在同一个回复中一次性发出全部 5 个工具调用，不要分步。'

    const firstRun = await runStreamAndCollectParts(
      model,
      await convertToModelMessages(
        [{ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: parallelPrompt }] }],
        async () => null,
        { modelSupportVision: true }
      ),
      tools,
      1
    )

    const toolCallParts = firstRun.contentParts.filter((part) => part.type === 'tool-call')
    debugLog('parallel: phase1 contentParts', firstRun.contentParts)
    expect(toolCallParts.length).toBeGreaterThanOrEqual(2)
    expect(toolCallParts.filter((part) => part.providerMetadata?.google?.thoughtSignature).length).toBe(1)

    const continueMessages = await rebuildContinueRequest(persistenceRoundTrip(firstRun, false), parallelPrompt)
    debugLog('parallel: continue request messages', continueMessages)
    expect(continueMessages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool'])

    const secondRun = await runStreamAndCollectParts(model, continueMessages, tools)
    debugLog('parallel: continue result', { finishReason: secondRun.finishReason, calls: executed.length })
    expect(secondRun.finishReason).toBeTruthy()
    expect(secondRun.finishReason).not.toBe('error')
  }, 180_000)
})
