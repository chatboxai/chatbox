import { SESSION_TOKEN_PAGE_MESSAGES } from '../../ports/session-token-cache'
import { getContextProjectionText, selectContextMessages } from '@shared/context'
import { setRuntimeRegistry } from '@shared/model-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompactionPoint, Message } from '../../types'
import { SessionEventBus } from '../session/session-events'
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
  getCompactionBudgetForModel,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
} from './TokenEstimationService'
const message = (id: string, text = 'batch content'): Message => ({
  id,
  role: 'user',
  contentParts: [{ type: 'text', text }],
})
function fixture(
  messages: Message[],
  get = vi.fn(async (_key: string): Promise<string | null> => null),
  compactionPoints: CompactionPoint[] = []
) {
  let payloadVersion = 0
  const events = new SessionEventBus()
  const accepted: SessionTextTokenResult[] = []
  const numerical = new Map<string, SessionTokenCacheResult>()
  const repository = {
    acceptSessionTokenCacheResults: vi.fn<SessionTokenRepositoryPort['acceptSessionTokenCacheResults']>(
      async (_sessionId, results) => {
        for (const result of results) numerical.set(`${result.cacheKey}:${result.identity.payloadId}`, result)
      }
    ),
    createSessionTokenPlan: vi.fn<SessionTokenRepositoryPort['createSessionTokenPlan']>(async (request) => {
      const selected = selectTokenEstimationContext({ messages, compactionPoints }, request.maxContextMessageCount)
      return {
        sessionId: request.sessionId,
        revision: payloadVersion + 1,
        header: { id: request.sessionId, name: 'Tokens' },
        thread: {
          sessionId: request.sessionId,
          threadId: 'thread',
          threadOrder: -1,
          name: 'Active',
          createdAt: 1,
          compactionPoints,
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
        messageIds: selected.map((value) => value.id),
        projectionEntries: selected.map(({ role, isSummary }) => ({ role, isSummary })),
        canManualCompact: messages.some((value) => value.role !== 'system' && !value.isSummary),
      }
    }),
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
    service: new TokenEstimationService({ get }, repository, events),
    events,
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
  describe('model-facing projection wording', () => {
    const summary: Message = {
      id: 'summary',
      role: 'assistant',
      isSummary: true,
      contentParts: [{ type: 'text', text: 'Earlier work summary' }],
    }
    const compacted = (next: Message) =>
      fixture([message('old'), summary, next], undefined, [
        { summaryMessageId: 'summary', boundaryMessageId: 'old', createdAt: 1 },
      ])
    // Same selected text with no summary, so nothing is projected.
    const plain = (next: Message) => fixture([{ ...summary, role: 'user', isSummary: false }, next])
    const wordingTokens = async (next: Message, language?: string) =>
      (
        await service.estimate({
          additionalInstructions: getContextProjectionText([summary, next], { language }),
        })
      ).contextTokens

    it.each([
      ['a user turn', message('next', 'Next question')],
      ['an assistant turn', { ...message('next', 'Partial answer'), role: 'assistant' as const }],
    ])('counts the handoff wording when the summary is followed by %s', async (_, next) => {
      const projected = await compacted(next).service.estimate({ sessionId: 's' })
      const baseline = await plain(next).service.estimate({ sessionId: 's' })

      expect(projected.contextMessageCount).toBe(2)
      expect(await wordingTokens(next)).toBeGreaterThan(0)
      expect(projected.contextTokens).toBe(baseline.contextTokens + (await wordingTokens(next)))
    })

    it('follows the session language', async () => {
      const next = message('next', 'Next question')
      const f = compacted(next)
      const en = await f.service.estimate({ sessionId: 's', language: 'en' })
      const zh = await f.service.estimate({ sessionId: 's', language: 'zh-Hans' })

      expect(getContextProjectionText([summary, next], { language: 'zh-Hans' })).not.toBe(
        getContextProjectionText([summary, next], { language: 'en' })
      )
      expect(zh.contextTokens - en.contextTokens).toBe(
        (await wordingTokens(next, 'zh-Hans')) - (await wordingTokens(next, 'en'))
      )
    })

    it('keeps counting the wording when the history aggregate is reused', async () => {
      const next = message('next', 'Next question')
      const f = compacted(next)
      const first = await f.service.estimate({ sessionId: 's', language: 'zh-Hans' })
      const pages = f.repository.readSessionTokenPage.mock.calls.length
      const reused = await f.service.estimate({ sessionId: 's', language: 'zh-Hans' })
      const switched = await f.service.estimate({ sessionId: 's', language: 'en' })

      expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(pages)
      expect(reused).toEqual(first)
      expect(first.contextTokens - switched.contextTokens).toBe(
        (await wordingTokens(next, 'zh-Hans')) - (await wordingTokens(next, 'en'))
      )
    })
  })
  it('uses the shared page limit and cancels before the next page', async () => {
    const total = SESSION_TOKEN_PAGE_MESSAGES * 2 + 7
    const f = fixture(Array.from({ length: total }, (_, i) => message(`m${i}`)))
    const progress = vi.fn()
    await f.service.estimate({ sessionId: 's' }, { onProgress: progress })
    expect(progress.mock.calls.map(([, done, total]) => [done, total])).toEqual([
      [SESSION_TOKEN_PAGE_MESSAGES, total],
      [SESSION_TOKEN_PAGE_MESSAGES * 2, total],
      [total, total],
    ])
    expect(progress.mock.calls.map(([result]) => result.approximation.context)).toEqual([true, true, false])
    expect(f.repository.readSessionTokenPage.mock.calls.map(([request]) => request.limit)).toEqual([
      SESSION_TOKEN_PAGE_MESSAGES,
      SESSION_TOKEN_PAGE_MESSAGES,
      SESSION_TOKEN_PAGE_MESSAGES,
    ])
    await f.events.publish({ type: 'session-list-reset' })
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
  it('reuses completed history for sending while recalculating draft and instructions', async () => {
    const f = fixture(Array.from({ length: 33 }, (_, i) => message(`m${i}`)))
    const history = await f.service.estimate({ sessionId: 's' })
    const pages = f.repository.readSessionTokenPage.mock.calls.length
    const progress = vi.fn()
    const draft = message('draft', 'new input '.repeat(20))
    const instructions = 'Updated memory '.repeat(30)
    const expected = await service.estimate({ constructedMessage: draft, additionalInstructions: instructions })
    const sent = await f.service.estimate(
      {
        sessionId: 's',
        constructedMessage: draft,
        maxContextMessageCount: Number.MAX_SAFE_INTEGER,
        resolveInstructions: async () => instructions,
      },
      { onProgress: progress }
    )
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(pages)
    expect(f.repository.createSessionTokenPlan).toHaveBeenCalledTimes(2)
    expect(sent.currentInputTokens).toBe(expected.currentInputTokens)
    expect(sent.contextTokens).toBe(history.contextTokens + expected.contextTokens)
    expect(sent.totalTokens).toBe(history.totalTokens + expected.totalTokens)
    expect(progress).toHaveBeenLastCalledWith(sent, 33, 33)
    const plain = await f.service.estimate({ sessionId: 's' })
    expect(plain).toEqual(history)
  })

  it('validates revision, context range, thread and tokenization policy before reuse', async () => {
    const messages = Array.from({ length: 120 }, (_, i) => message(`m${i}`))
    const f = fixture(messages)
    await f.service.estimate({ sessionId: 's' })
    f.repository.readSessionTokenPage.mockClear()
    messages[0] = message('m0', 'Changed history '.repeat(100))
    f.changePayload()
    const changed = await f.service.estimate({ sessionId: 's' })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(2)
    const limited = await f.service.estimate({ sessionId: 's', maxContextMessageCount: 4 })
    expect(limited.contextMessageCount).toBe(4)
    expect(limited.contextTokens).toBeLessThan(changed.contextTokens)
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(3)
    await f.service.estimate({ sessionId: 's', model: { provider: 'deepseek', modelId: 'deepseek-chat' } })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(5)
    await f.service.estimate({ sessionId: 's', sandboxMode: true })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(7)
    await f.service.estimate({ sessionId: 's', modelSupportToolUseForFile: true })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(9)
    const plan = (await f.repository.createSessionTokenPlan({ sessionId: 's' }))!
    f.repository.createSessionTokenPlan.mockResolvedValue({ ...plan, thread: { ...plan.thread, threadId: 'other' } })
    await f.service.estimate({ sessionId: 's' })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(11)
  })

  it('invalidates aggregates on deletion and replacement even when revisions are reused', async () => {
    const f = fixture([message('m')])
    await f.service.estimate({ sessionId: 's' })
    await f.events.publish({ type: 'session-deleted', ids: ['s'] })
    await f.service.estimate({ sessionId: 's' })
    await f.events.publish({ type: 'session-list-reset' })
    await f.service.estimate({ sessionId: 's' })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(3)
  })

  it('does not retain an aggregate completed across a source reset', async () => {
    const f = fixture([message('m')])
    await f.service.estimate(
      { sessionId: 's' },
      {
        onProgress: () => {
          void f.events.publish({ type: 'session-list-reset' })
        },
      }
    )
    await f.service.estimate({ sessionId: 's' })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(2)
  })

  it('never reuses a canceled partial estimate', async () => {
    const f = fixture(Array.from({ length: 233 }, (_, i) => message(`m${i}`)))
    const controller = new AbortController()
    await expect(
      f.service.estimate(
        { sessionId: 's' },
        {
          signal: controller.signal,
          onProgress: () => controller.abort(),
        }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    f.repository.readSessionTokenPage.mockClear()
    const result = await f.service.estimate({ sessionId: 's' })
    expect(result.contextMessageCount).toBe(233)
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(3)
  })

  it('bounds aggregate retention and requires lifecycle events for reuse', async () => {
    const f = fixture([message('m')])
    for (let i = 0; i < 17; i++) await f.service.estimate({ sessionId: `s${i}` })
    f.repository.readSessionTokenPage.mockClear()
    await f.service.estimate({ sessionId: 's16' })
    expect(f.repository.readSessionTokenPage).not.toHaveBeenCalled()
    await f.service.estimate({ sessionId: 's0' })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(1)
    const isolated = new TokenEstimationService({ get: f.get }, f.repository)
    await isolated.estimate({ sessionId: 's16' })
    await isolated.estimate({ sessionId: 's16' })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(3)
  })

  it('reuses stable history and only rereads mutable attachments', async () => {
    const attached: Message = {
      ...message('file'),
      files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'notes' }],
    }
    let content = 'Initial document'
    const f = fixture(
      [...Array.from({ length: 40 }, (_, i) => message(`m${i}`)), attached],
      vi.fn(async () => content)
    )
    const first = await f.service.estimate({ sessionId: 's' })
    f.repository.readSessionTokenPage.mockClear()
    content = 'Updated document '.repeat(100)
    const second = await f.service.estimate({ sessionId: 's' })
    expect(f.repository.readSessionTokenPage).toHaveBeenCalledTimes(1)
    expect(f.repository.readSessionTokenPage.mock.calls[0][0].plan.messageIds).toEqual(['file'])
    expect(second.contextMessageCount).toBe(41)
    expect(second.contextTokens).toBeGreaterThan(first.contextTokens)
    expect(f.get).toHaveBeenCalledTimes(2)
    expect(await f.service.estimate({ sessionId: 's' })).toEqual(second)
  })

  it('rechecks missing attachments without retaining their incomplete status in the stable sum', async () => {
    const attached: Message = {
      ...message('file'),
      files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'notes' }],
    }
    const get = vi
      .fn<(_key: string) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue('Recovered content')
    const f = fixture([message('stable'), attached], get)
    expect((await f.service.estimate({ sessionId: 's' })).missingAttachments?.context).toBe(true)
    const recovered = await f.service.estimate({ sessionId: 's' })
    expect(recovered.missingAttachments?.context).toBe(false)
    expect(recovered.approximation.context).toBe(false)
    expect(f.repository.readSessionTokenPage.mock.calls[1][0].plan.messageIds).toEqual(['file'])
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
    expect(getCompactionBudgetForModel({ model, compactionThreshold: 0.6 })?.thresholdTokens).toBe(
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
