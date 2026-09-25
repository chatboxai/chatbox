import type { ModelStreamPart } from '@shared/models/types'
import type { MessageContentParts } from '@shared/types'
import type { ToolSet } from 'ai'

function chunk(type: string, data: Record<string, unknown> = {}): ModelStreamPart<ToolSet> {
  return { type, ...data } as ModelStreamPart<ToolSet>
}

/**
 * Cross-host generation fixture. New renderers can replay the same chunks and
 * compare the portable message projection without depending on React or DOM APIs.
 */
export const generationStreamFixture = {
  chunks: [
    chunk('text-delta', { text: 'I will check. ' }),
    chunk('tool-call', {
      toolCallId: 'tool-1',
      toolName: 'search',
      args: { query: 'Chatbox' },
    }),
    chunk('tool-result', {
      toolCallId: 'tool-1',
      result: { title: 'Chatbox', found: true },
    }),
    chunk('finish-step'),
    chunk('text-delta', { text: 'The result is ready.' }),
    chunk('finish', {
      finishReason: 'stop',
      totalUsage: {
        inputTokens: 12,
        inputTokenDetails: { noCacheTokens: 7, cacheReadTokens: 5, cacheWriteTokens: undefined },
        outputTokens: 8,
        outputTokenDetails: { textTokens: 8, reasoningTokens: undefined },
        totalTokens: 20,
      },
    }),
  ],
  expectedContentParts: [
    { type: 'text', text: 'I will check. ', stepIndex: 0 },
    {
      type: 'tool-call',
      state: 'result',
      toolCallId: 'tool-1',
      toolName: 'search',
      args: { query: 'Chatbox' },
      result: { title: 'Chatbox', found: true },
      stepIndex: 0,
    },
    { type: 'text', text: 'The result is ready.', stepIndex: 1 },
  ] satisfies MessageContentParts,
  expectedUsage: { inputTokens: 12, outputTokens: 8, totalTokens: 20, cachedInputTokens: 5 },
  expectedFinishReason: 'stop',
}
