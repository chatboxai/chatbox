import { selectContextMessages } from '@shared/context'
import { setRuntimeRegistry } from '@shared/model-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../../types'
import {
  SESSION_TEXT_TOKEN_VERSION,
  type SessionTokenCacheResult,
  type SessionTextTokenResult,
  type SessionTokenRepositoryPort,
  type SessionTextTokenRepositoryPort,
} from '../../ports'
import {
  TokenEstimationService,
  selectTokenEstimationContext,
  resolveModelContextWindow,
  getCompactionThresholdTokens,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
} from './TokenEstimationService'

const message = (id: string, text = 'batch content'): Message => ({
  id,
  role: 'user',
  contentParts: [{ type: 'text', text }],
})
function fixture(messages: Message[], get = vi.fn(async (_key: string): Promise<string | null> => null)) {
  let payloadVersion = 0
  const accepted: SessionTextTokenResult[] = []
  const numerical = new Map<string, SessionTokenCacheResult>()
  const repository = {
    acceptSessionTokenCacheResults: vi.fn<SessionTokenRepositoryPort['acceptSessionTokenCacheResults']>(
      async (_sessionId, results) => {
        for (const result of results) numerical.set(`${result.cacheKey}:${result.identity.payloadId}`, result)
      }
    ),
    createSessionTokenPlan: vi.fn<SessionTokenRepositoryPort['createSessionTokenPlan']>(async (request) => ({
      sessionId: request.sessionId,
      revision: 1,
      header: { id: request.sessionId, name: 'Tokens' },
      thread: {
        sessionId: request.sessionId,
        threadId: 'thread',
        seq: -1,
        name: 'Active',
        createdAt: 1,
        compactionPoints: [],
        rootMessageId: messages[0]?.id ?? null,
        activeLeafMessageId: messages.at(-1)?.id ?? null,
      },
      beforeTarget: {
        userMessageCount: messages.length,
        hasAssistantMessage: false,
        hasLegacyCommandHistory: false,
        sandboxSeedAttachments: [],
        fileResourceKeys: [],
      },
      messageIds: selectTokenEstimationContext({ messages }, request.maxContextMessageCount).map((value) => value.id),
      canManualCompact: messages.some((value) => value.role !== 'system' && !value.isSummary),
    })),
    readSessionTokenPage: vi.fn<SessionTokenRepositoryPort['readSessionTokenPage']>(
      async ({ plan, offset, limit, cacheKey }) => {
        const ids = plan.messageIds.slice(offset, offset + limit)
        const entries = ids.map((id) => ({
          sessionId: plan.sessionId,
          messageId: id,
          payloadId: `${id}:${payloadVersion}`,
          payloadBytes: 100,
          value: numerical.get(`${cacheKey}:${id}:${payloadVersion}`)?.value,
        }))
        const selected = ids
          .filter((id) => !entries.find((entry) => entry.messageId === id)?.value)
          .map((id) => messages.find((value) => value.id === id)!)
        return {
          sessionId: plan.sessionId,
          revision: plan.revision,
          messages: selected,
          entries,
          nextOffset: offset + ids.length < plan.messageIds.length ? offset + ids.length : null,
          textTokens: {
            sources: Object.fromEntries(
              selected.map((value) => [
                value.id,
                {
                  sessionId: plan.sessionId,
                  messageId: value.id,
                  payloadId: `${value.id}:${payloadVersion}`,
                  calculationVersion: SESSION_TEXT_TOKEN_VERSION,
                  textDigest: `${value.id}:${payloadVersion}`,
                  text: value.contentParts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
                },
              ])
            ),
            results: accepted,
          },
        }
      }
    ),
    acceptSessionTextTokenResults: vi.fn<SessionTextTokenRepositoryPort['acceptSessionTextTokenResults']>(
      async (sessionId, results) => {
        accepted.push(...results)
        return { sessionId, results: [...results] }
      }
    ),
  }
  return {
    service: new TokenEstimationService({ get }, repository),
    repository,
    get,
    changePayload() {
      payloadVersion++
    },
  }
}
const service = new TokenEstimationService({ get: async () => null })
afterEach(() => {
  setRuntimeRegistry(null)
})

describe('row token estimation', () => {
  it('does no history IO or token traversal in the immediate draft path', () => {
    const f = fixture([message('history', 'large '.repeat(100000))])
    const result = f.service.estimateImmediately({ sessionId: 's', constructedMessage: message('draft', 'Hello') })
    expect(result.currentInputTokens).toBeGreaterThan(0)
    expect(result.contextTokens).toBe(0)
    expect(result.approximation.context).toBe(true)
    expect(f.repository.createSessionTokenPlan).not.toHaveBeenCalled()
    expect(f.repository.readSessionTokenPage).not.toHaveBeenCalled()
  })
  it('counts independent instructions once without changing conversation counts', async () => {
    const f = fixture([message('user', 'Hello')])
    const baseline = await f.service.estimate({ sessionId: 's' })
    const instructions = await service.estimate({ additionalInstructions: 'The user prefers Chinese explanations.' })
    const progress = vi.fn()
    const result = await f.service.estimate(
      { sessionId: 's', resolveInstructions: async () => 'The user prefers Chinese explanations.' },
      { onProgress: progress }
    )
    expect(result.contextTokens).toBe(baseline.contextTokens + instructions.contextTokens)
    expect(result.contextMessageCount).toBe(1)
    expect(instructions.contextMessageCount).toBe(0)
    expect(progress.mock.calls.at(-1)?.[0].contextTokens).toBe(result.contextTokens)
  })
  it('reads at most sixteen bodies per page and cancels before the next page', async () => {
    const f = fixture(Array.from({ length: 40 }, (_, i) => message(`m${i}`)))
    const progress = vi.fn()
    await f.service.estimate({ sessionId: 's' }, { onProgress: progress })
    expect(progress.mock.calls.map(([, done, total]) => [done, total])).toEqual([
      [16, 40],
      [32, 40],
      [40, 40],
    ])
    expect(progress.mock.calls.map(([result]) => result.approximation.context)).toEqual([true, true, false])
    expect(f.repository.readSessionTokenPage.mock.calls.map(([request]) => request.limit)).toEqual([16, 16, 16])
    const controller = new AbortController()
    f.repository.readSessionTokenPage.mockClear()
    await expect(
      f.service.estimate({ sessionId: 's' }, { signal: controller.signal, onProgress: () => controller.abort() })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(1)
  })
  it('supports native AbortSignals without throwIfAborted', async () => {
    const controller = new AbortController()
    Object.defineProperty(controller.signal, 'throwIfAborted', { value: undefined })
    await expect(service.estimate({}, { signal: controller.signal })).resolves.toMatchObject({ totalTokens: 0 })
    controller.abort()
    await expect(service.estimate({}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('counts tool payloads and hydrated attachments in the selected history', async () => {
    const attached: Message = {
      ...message('file'),
      files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'notes' }],
    }
    const tool: Message = {
      id: 'tool',
      role: 'assistant',
      contentParts: [
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'call',
          toolName: 'lookup',
          args: { query: 'weather' },
          result: { forecast: 'sunny'.repeat(20) },
        },
      ],
    }
    const f = fixture(
      [message('old'), tool, attached],
      vi.fn(async () => 'attachment body '.repeat(40))
    )
    const result = await f.service.estimate({
      sessionId: 's',
      maxContextMessageCount: 2,
      constructedMessage: message('draft'),
    })
    expect(result.contextMessageCount).toBe(2)
    expect(result.breakdown.context.toolCalls).toBeGreaterThan(0)
    expect(result.breakdown.context.attachments).toBeGreaterThan(0)
    expect(result.totalTokens).toBe(result.currentInputTokens + result.contextTokens)
    expect(attached.tokenCountMap).toBeUndefined()
    expect(f.repository.acceptSessionTextTokenResults).toHaveBeenCalled()
  })
  it('rechecks external attachment content for every independent estimate', async () => {
    const attached: Message = {
      ...message('file'),
      files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'notes' }],
    }
    const f = fixture(
      [attached],
      vi.fn(async () => 'attachment body '.repeat(40))
    )
    await f.service.estimate({ sessionId: 's', constructedMessage: message('draft', 'a') })
    await f.service.estimate({ sessionId: 's', constructedMessage: message('draft', 'ab') })
    expect(f.get).toHaveBeenCalledTimes(2)
    f.changePayload()
    await f.service.estimate({ sessionId: 's' })
    expect(f.get).toHaveBeenCalledTimes(3)
    await f.service.estimate({ sessionId: 's', model: { provider: 'deepseek', modelId: 'deepseek-chat' } })
    expect(f.get).toHaveBeenCalledTimes(4)
  })
  it('retries missing attachments instead of retaining an incomplete result', async () => {
    const attached: Message = {
      ...message('file'),
      files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'notes' }],
    }
    const get = vi
      .fn<(_key: string) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue('Recovered document content')
    const f = fixture([attached], get)
    expect((await f.service.estimate({ sessionId: 's' })).missingAttachments?.context).toBe(true)
    expect((await f.service.estimate({ sessionId: 's' })).missingAttachments?.context).toBe(false)
    expect(get).toHaveBeenCalledTimes(2)
  })
  it('selects the same finite history as the next send', () => {
    const messages = Array.from({ length: 12 }, (_, i) => message(`m${i}`))
    const draft = message('draft')
    expect(selectTokenEstimationContext({ messages }, 10, draft)).toEqual(
      selectContextMessages([...messages, draft], { maxContextMessageCount: 10 }).filter((value) => value !== draft)
    )
  })
  it('uses DeepSeek tokenization independently', async () => {
    const constructedMessage = message('draft', 'hello world '.repeat(40))
    const normal = await service.estimate({ constructedMessage, model: { provider: 'openai', modelId: 'gpt-test' } })
    const deepSeek = await service.estimate({
      constructedMessage,
      model: { provider: 'deepseek', modelId: 'deepseek-chat' },
    })
    expect(normal.currentInputTokens).not.toBe(deepSeek.currentInputTokens)
  })
  it('bounds long drafts and instruction text and marks approximate results', async () => {
    const request = {
      constructedMessage: message('draft', 'a'.repeat(8192)),
      additionalInstructions: 'memory '.repeat(1000),
    }
    expect(service.estimateImmediately(request).approximation).toEqual({ currentInput: true, context: true })
    expect((await service.estimate(request)).approximation).toEqual({ currentInput: true, context: true })
  })
  it('includes a conservative image allowance', async () => {
    const image: Message = { id: 'image', role: 'user', contentParts: [{ type: 'image', storageKey: 'image' }] }
    for (const result of [
      service.estimateImmediately({ constructedMessage: image }),
      await service.estimate({ constructedMessage: image }),
    ]) {
      expect(result.breakdown.currentInput.attachments).toBeGreaterThanOrEqual(4096)
      expect(result.approximation.currentInput).toBe(true)
    }
  })
  it('keeps an unknown visual limit unknown while compaction receives the 128k fallback', () => {
    const model = { provider: 'custom-provider', modelId: 'unknown-private-model' }
    expect(resolveModelContextWindow(model)).toBeNull()
    expect(getCompactionThresholdTokens({ model, compactionThreshold: 0.6 })).toBe(
      Math.floor((FALLBACK_CONTEXT_WINDOW_TOKENS - 32_000) * 0.6)
    )
  })

  it('keeps a cross-provider context window unknown when matching providers disagree', () => {
    const registryModel = (contextWindow: number) => ({
      modelId: 'shared-model',
      type: 'chat' as const,
      capabilities: [],
      contextWindow,
      maxOutput: 8_192,
    })
    setRuntimeRegistry({
      'provider-a': { 'shared-model': registryModel(262_144) },
      'provider-b': { 'shared-model': registryModel(131_072) },
    })

    expect(resolveModelContextWindow({ provider: 'custom-provider', modelId: 'shared-model' })).toBeNull()
    expect(resolveModelContextWindow({ provider: 'provider-b', modelId: 'shared-model' })).toBe(131_072)
  })
})
