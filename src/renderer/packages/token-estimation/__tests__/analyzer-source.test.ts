import { getTokenizationTextDigest } from '@chatbox/core/application/session'
import { SESSION_TEXT_TOKEN_VERSION, type SessionTextTokenRead, type SessionTextTokenSource } from '@chatbox/core/ports'
import type { Message } from '@shared/types/session'
import { afterEach, expect, it, vi } from 'vitest'
import { analyzeContextTokens } from '../analyzer'
import * as draft from '../draft-tokenization'
import { _resetExactTokenizationFallbacks, recordExactTokenizationFallback } from '../exact-retry'

function message(id = 'message'): Message {
  return { id, role: 'user', updatedAt: 10, contentParts: [{ type: 'text', text: `Text ${id} 中文 😀` }] }
}

function read(messages: Message[]): SessionTextTokenRead {
  return {
    results: [],
    sources: Object.fromEntries(
      messages.map((item) => {
        const text = draft.getDraftTokenizationText(item)
        return [
          item.id,
          Object.freeze({
            sessionId: 'session',
            messageId: item.id,
            payloadId: `payload-${item.id}`,
            calculationVersion: SESSION_TEXT_TOKEN_VERSION,
            text,
            textDigest: getTokenizationTextDigest(text),
          }),
        ]
      })
    ),
  }
}

function options(contextMessages: Message[], textTokens = read(contextMessages)) {
  return {
    sessionId: 'session',
    contextMessages,
    textSources: textTokens.sources,
    tokenizerType: 'default' as const,
    modelSupportToolUseForFile: false,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  _resetExactTokenizationFallbacks()
})

it('reuses issued digests across sparse numerical publications while keeping complete analysis', () => {
  const messages = Array.from({ length: 1000 }, (_, index) => message(`m-${index}`))
  const input = options(messages)
  const hash = vi.spyOn(draft, 'getTokenizationTextDigest')
  const initial = analyzeContextTokens(input)
  expect(initial.pendingTasks).toHaveLength(1000)
  expect(hash.mock.calls.length).toBe(0)
  const updated = messages.map((item, index) =>
    index < 10
      ? {
          ...item,
          tokenCountMap: { default: 7 },
          tokenCalculatedAt: { default: 20 },
        }
      : item
  )
  const result = analyzeContextTokens({ ...input, contextMessages: updated })
  expect(hash.mock.calls.length).toBe(0)
  expect(result.pendingTasks).toHaveLength(990)
  expect(result.breakdown.text).toBe(70)
  expect(result).toEqual(analyzeContextTokens({ ...input, textSources: undefined, contextMessages: updated }))
  expect(hash).toHaveBeenCalledTimes(990)
})

it.each(['missing', 'session', 'message', 'version', 'payload', 'digest', 'text'] as const)(
  'hashes current text when source fields do not match: %s',
  (field) => {
    const item = message(),
      input = options([item]),
      source = input.textSources[item.id]
    const changed =
      field === 'missing'
        ? undefined
        : {
            ...source,
            ...(field === 'session' ? { sessionId: 'other' } : {}),
            ...(field === 'message' ? { messageId: 'other' } : {}),
            ...(field === 'version' ? { calculationVersion: 'other' } : {}),
            ...(field === 'payload' ? { payloadId: '' } : {}),
            ...(field === 'digest' ? { textDigest: 'malformed' } : {}),
            ...(field === 'text' ? { text: 'old text' } : {}),
          }
    const hash = vi.spyOn(draft, 'getTokenizationTextDigest')
    const result = analyzeContextTokens({
      ...input,
      textSources: changed ? { [item.id]: changed as SessionTextTokenSource } : {},
    })
    expect(hash).toHaveBeenCalledExactlyOnceWith(draft.getDraftTokenizationText(item))
    expect(result.pendingTasks[0].textDigest).toBe(source.textDigest)
  }
)

it('checks live text despite matching IDs and timestamps and accepts same-text copies', () => {
  const item = message(),
    input = options([item])
  const hash = vi.spyOn(draft, 'getTokenizationTextDigest')
  const edited = { ...item, contentParts: [{ type: 'text' as const, text: 'edited' }] }
  const result = analyzeContextTokens({ ...input, contextMessages: [edited] })
  expect(result.pendingTasks[0].textDigest).toBe(getTokenizationTextDigest('edited'))
  expect(hash).toHaveBeenCalledExactlyOnceWith('edited')
  hash.mockClear()
  expect(analyzeContextTokens({ ...input, contextMessages: [{ ...item }] }).pendingTasks[0].textDigest).toBe(
    input.textSources[item.id].textDigest
  )
  expect(hash).not.toHaveBeenCalled()
})

it('keeps retry attempts, approximate exhaustion, tokenizer and priority live', () => {
  const first = message('a'),
    second = message('b'),
    input = options([first, second])
  const digest = input.textSources[first.id].textDigest
  const hash = vi.spyOn(draft, 'getTokenizationTextDigest')
  recordExactTokenizationFallback(first.id, 'default', digest)
  const pending = analyzeContextTokens(input).pendingTasks
  expect(pending[0]).toMatchObject({ messageId: 'a', retryAttempt: 1, priority: 11 })
  expect(
    analyzeContextTokens({ ...input, tokenizerType: 'deepseek', contextMessages: [second, first] }).pendingTasks[1]
  ).toMatchObject({ messageId: 'a', retryAttempt: 0, priority: 10, tokenizerType: 'deepseek' })
  const approximate = {
    ...first,
    tokenCountMap: { default: 5 },
    tokenCalculatedAt: { default: 20 },
    tokenCountApproximate: { default: true },
  }
  expect(analyzeContextTokens({ ...input, contextMessages: [approximate] }).pendingTasks[0].retryAttempt).toBe(1)
  recordExactTokenizationFallback(first.id, 'default', digest)
  expect(analyzeContextTokens({ ...input, contextMessages: [approximate] })).toMatchObject({
    breakdown: { text: 5 },
    pendingTasks: [],
    hasApproximateText: true,
  })
  expect(hash).not.toHaveBeenCalled()
})

it('preserves canonical multipart text and separate attachment/tool/sandbox analysis', () => {
  const item: Message = {
    ...message(),
    contentParts: [
      { type: 'reasoning', text: 'reasoning' },
      { type: 'text', text: 'a\u0000b\ud800' },
      { type: 'image', storageKey: 'image' },
      { type: 'tool-call', state: 'result', toolCallId: 'call', toolName: 'lookup', args: {}, result: 'result' },
    ],
    files: [{ id: 'file', name: 'notes', fileType: 'text/plain', storageKey: 'file', lineCount: 10000 }],
  }
  const input = options([item])
  for (const sandboxMode of [true, false]) {
    const current = { ...input, sandboxMode, modelSupportToolUseForFile: true }
    expect(analyzeContextTokens(current)).toEqual(analyzeContextTokens({ ...current, textSources: undefined }))
  }
})
