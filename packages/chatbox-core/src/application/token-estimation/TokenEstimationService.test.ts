import { selectContextMessages } from '@shared/context'
import { setRuntimeRegistry } from '@shared/model-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message, Session } from '../../types'
import { findCompactionBoundaryMessage } from '../context/compaction-boundary'
import {
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  getCompactionThresholdTokens,
  resolveModelContextWindow,
  selectTokenEstimationContext,
  TokenEstimationService,
} from './TokenEstimationService'

const blobs = new Map<string, string>()
const service = new TokenEstimationService({
  get: (key) => Promise.resolve(blobs.get(key) ?? null),
})

afterEach(() => {
  setRuntimeRegistry(null)
})

describe('TokenEstimationService', () => {
  it('counts draft, selected context, tool payloads, and inline attachments with v2 semantics', async () => {
    blobs.set('attachment:1', 'attachment body '.repeat(40))
    const toolMessage: Message = {
      id: 'assistant-tool',
      role: 'assistant',
      contentParts: [
        { type: 'text', text: 'tool reply' },
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'call-1',
          toolName: 'lookup',
          args: { query: 'weather' },
          result: { forecast: 'sunny'.repeat(20) },
        },
      ],
    }
    const attachmentMessage: Message = {
      id: 'user-file',
      role: 'user',
      contentParts: [{ type: 'text', text: 'read this' }],
      files: [{ id: 'file-1', name: 'notes.txt', fileType: 'text/plain', storageKey: 'attachment:1' }],
    }
    const session: Session = {
      id: 'session',
      name: 'Tokens',
      messages: [
        { id: 'old', role: 'user', contentParts: [{ type: 'text', text: 'old message' }] },
        toolMessage,
        attachmentMessage,
      ],
    }

    const result = await service.estimate({
      session,
      constructedMessage: { id: 'draft', role: 'user', contentParts: [{ type: 'text', text: 'new draft' }] },
      maxContextMessageCount: 2,
      model: { provider: 'openai', modelId: 'gpt-4o' },
    })

    expect(result.currentInputTokens).toBeGreaterThan(0)
    expect(result.contextMessageCount).toBe(2)
    expect(result.breakdown.context.toolCalls).toBeGreaterThan(0)
    expect(result.breakdown.context.attachments).toBeGreaterThan(0)
    expect(result.totalTokens).toBe(result.currentInputTokens + result.contextTokens)
  })

  it('uses the DeepSeek tokenizer independently from the default tokenizer', async () => {
    const request = {
      constructedMessage: {
        id: 'draft',
        role: 'user' as const,
        contentParts: [{ type: 'text' as const, text: 'hello world '.repeat(40) }],
      },
    }
    const defaultResult = await service.estimate({
      ...request,
      model: { provider: 'openai', modelId: 'gpt-test' },
    })
    const deepSeekResult = await service.estimate({
      ...request,
      model: { provider: 'deepseek', modelId: 'deepseek-chat' },
    })
    expect(deepSeekResult.currentInputTokens).not.toBe(defaultResult.currentInputTokens)
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

  it('exposes manual compaction only when the full context has an eligible boundary', () => {
    const systemOnly: Session = {
      id: 'system-only',
      name: 'System only',
      messages: [{ id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'Prompt' }] }],
    }
    const summaryOnly: Session = {
      id: 'summary-only',
      name: 'Summary only',
      messages: [
        { id: 'summary', role: 'assistant', isSummary: true, contentParts: [{ type: 'text', text: 'Summary' }] },
      ],
    }
    const conversation: Session = {
      id: 'conversation',
      name: 'Conversation',
      messages: [{ id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] }],
    }

    expect(service.estimateImmediately({ session: systemOnly }).canManualCompact).toBe(false)
    expect(service.estimateImmediately({ session: summaryOnly }).canManualCompact).toBe(false)
    expect(service.estimateImmediately({ session: conversation }).canManualCompact).toBe(true)
  })

  it('reuses exact historical attachment work across draft and unrelated streaming updates', async () => {
    const get = vi.fn(() => Promise.resolve('historical attachment body '.repeat(20)))
    const cachedService = new TokenEstimationService({ get })
    const attached: Message = {
      id: 'attached',
      role: 'user',
      contentParts: [{ type: 'text', text: 'Read the attachment' }],
      files: [{ id: 'file', name: 'notes.txt', fileType: 'text/plain', storageKey: 'file:key' }],
    }
    const session = (streamText: string): Session => ({
      id: 'cached',
      name: 'Cached history',
      messages: [
        { ...attached, contentParts: [{ type: 'text', text: 'Read the attachment' }] },
        { id: 'stream', role: 'assistant', generating: true, contentParts: [{ type: 'text', text: streamText }] },
      ],
    })

    await cachedService.estimate({
      session: session('first chunk'),
      constructedMessage: { id: 'draft', role: 'user', contentParts: [{ type: 'text', text: 'a' }] },
    })
    await cachedService.estimate({
      session: session('second chunk'),
      constructedMessage: { id: 'draft', role: 'user', contentParts: [{ type: 'text', text: 'ab' }] },
    })

    expect(get).toHaveBeenCalledTimes(1)
  })

  it('keeps immediate draft work separate from stable history across draft and streaming clones', () => {
    const immediateService = new TokenEstimationService({ get: () => Promise.resolve(null) })
    let historicalTokenReads = 0
    let draftTokenReads = 0
    const historicalTokenCountMap = new Proxy<Record<string, number>>(
      { default: 40 },
      {
        get(target, property, receiver) {
          if (property === 'default') historicalTokenReads += 1
          return Reflect.get(target, property, receiver)
        },
      }
    )
    const stableHistory: Message = {
      id: 'stable-history',
      role: 'user',
      contentParts: [{ type: 'text', text: 'Stable historical prompt' }],
      tokenCountMap: historicalTokenCountMap,
    }
    const estimate = (draftText: string, streamText: string) => {
      const draftTokenCountMap = new Proxy<Record<string, number>>(
        { default: draftText.length },
        {
          get(target, property, receiver) {
            if (property === 'default') draftTokenReads += 1
            return Reflect.get(target, property, receiver)
          },
        }
      )
      return immediateService.estimateImmediately({
        session: {
          id: 'immediate-cache',
          name: 'Immediate cache',
          messages: [
            stableHistory,
            {
              id: 'generating-reply',
              role: 'assistant',
              generating: true,
              contentParts: [{ type: 'text', text: streamText }],
            },
          ],
        },
        constructedMessage: {
          id: 'draft',
          role: 'user',
          contentParts: [{ type: 'text', text: draftText }],
          tokenCountMap: draftTokenCountMap,
        },
        model: { provider: 'openai', modelId: 'gpt-test' },
      })
    }

    estimate('a', 'first chunk')
    const readsAfterFirstEstimate = historicalTokenReads
    estimate('ab', 'first chunk')
    estimate('abc', 'second chunk')

    expect(historicalTokenReads).toBe(readsAfterFirstEstimate)
    expect(draftTokenReads).toBe(3)
  })

  it('uses hydrated attachment weight when choosing a raw-tail boundary', async () => {
    const get = vi.fn(() => Promise.resolve('very large inline file '.repeat(4_000)))
    const attachmentService = new TokenEstimationService({ get })
    const messages: Message[] = []
    for (let round = 1; round <= 4; round += 1) {
      messages.push({
        id: `u${round}`,
        role: 'user',
        contentParts: [{ type: 'text', text: `question ${round}` }],
        ...(round === 4
          ? { files: [{ id: 'huge', name: 'huge.txt', fileType: 'text/plain', storageKey: 'huge:key' }] }
          : {}),
      })
      messages.push({ id: `a${round}`, role: 'assistant', contentParts: [{ type: 'text', text: `answer ${round}` }] })
    }
    const estimateMessagesTokens = await attachmentService.createMessagesTokenEstimator(messages, {
      provider: 'openai',
      modelId: 'gpt-test',
    })

    expect(
      findCompactionBoundaryMessage(messages, {
        maxTailTokens: 500,
        estimateMessagesTokens,
      })?.id
    ).toBe('a4')
    expect(get).toHaveBeenCalledOnce()
  })

  it('selects the same finite history window that the next send will use', () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      id: `m${index + 1}`,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      contentParts: [{ type: 'text' as const, text: `message ${index + 1}` }],
    }))
    const system: Message = { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'System prompt' }] }
    const draft: Message = { id: 'draft', role: 'user', contentParts: [{ type: 'text', text: 'Current input' }] }
    const session: Session = { id: 'window', name: 'Window', messages: [system, ...history] }
    const outgoingHistory = selectContextMessages([...session.messages, draft], { maxContextMessageCount: 10 }).filter(
      (message) => message !== draft
    )

    expect(selectTokenEstimationContext(session, 10, draft).map((message) => message.id)).toEqual(
      outgoingHistory.map((message) => message.id)
    )
    expect(
      service.estimateImmediately({ session, constructedMessage: draft, maxContextMessageCount: 0 }).contextTokens
    ).toBe(service.estimateImmediately({ session: { ...session, messages: [system] } }).contextTokens)
  })

  it('bounds long-text estimation and reports the approximate result', async () => {
    const startedAt = performance.now()
    const result = await service.estimate({
      constructedMessage: {
        id: 'long-draft',
        role: 'user',
        contentParts: [{ type: 'text', text: 'a'.repeat(8_192) }],
      },
    })

    expect(result.currentInputTokens).toBeGreaterThan(0)
    expect(result.approximation.currentInput).toBe(true)
    expect(performance.now() - startedAt).toBeLessThan(2_000)
  })

  it('includes a conservative image allowance and marks it approximate', async () => {
    const imageMessage: Message = {
      id: 'image-draft',
      role: 'user',
      contentParts: [{ type: 'image', storageKey: 'image:key' }],
    }

    const immediate = service.estimateImmediately({ constructedMessage: imageMessage })
    const resolved = await service.estimate({ constructedMessage: imageMessage })

    expect(immediate.breakdown.currentInput.attachments).toBeGreaterThanOrEqual(4_096)
    expect(immediate.approximation.currentInput).toBe(true)
    expect(resolved.breakdown.currentInput.attachments).toBeGreaterThanOrEqual(4_096)
    expect(resolved.approximation.currentInput).toBe(true)
  })
})
