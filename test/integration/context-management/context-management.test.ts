import './setup'
import { v4 as uuidv4 } from 'uuid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildContextForAI,
  buildContextForSession,
  buildContextForThread,
  checkOverflow,
  DEFAULT_COMPACTION_THRESHOLD,
  isAutoCompactionEnabled,
  OUTPUT_RESERVE_TOKENS,
} from '../../../src/renderer/packages/context-management'
import { buildContext } from '../../../src/shared/context'
import type {
  CompactionPoint,
  Message,
  MessageContentParts,
  MessageRole,
  Session,
  SessionThread,
} from '../../../src/shared/types/session'
import type { SessionSettings, Settings } from '../../../src/shared/types/settings'

vi.mock('../../../src/renderer/packages/model-registry', () => ({
  getModelContextWindowSync: vi.fn((modelId: string) => {
    const contextWindows: Record<string, number> = {
      'gpt-4o': 128_000,
      'gpt-4o-mini': 128_000,
      'claude-3-5-sonnet-20241022': 200_000,
      'gemini-1.5-pro': 1_000_000,
      'deepseek-chat': 64_000,
      'small-context-model': 48_000,
    }
    return contextWindows[modelId] ?? null
  }),
}))

function createTestMessage(
  role: MessageRole,
  content: string,
  options?: {
    id?: string
    isSummary?: boolean
    contentParts?: MessageContentParts
  }
): Message {
  const id = options?.id ?? uuidv4()
  return {
    id,
    role,
    contentParts: options?.contentParts ?? [{ type: 'text', text: content }],
    timestamp: Date.now(),
    isSummary: options?.isSummary,
  }
}

function createToolCallPart(toolName: string, args: unknown = {}): MessageContentParts[number] {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: uuidv4(),
    toolName,
    args,
    result: { success: true },
  }
}

function createCompactionPoint(
  summaryMessageId: string,
  boundaryMessageId: string,
  createdAt?: number
): CompactionPoint {
  return {
    summaryMessageId,
    boundaryMessageId,
    createdAt: createdAt ?? Date.now(),
  }
}

function createTestSession(
  messages: Message[],
  options?: {
    id?: string
    compactionPoints?: CompactionPoint[]
    settings?: SessionSettings
    threads?: SessionThread[]
  }
): Session {
  return {
    id: options?.id ?? uuidv4(),
    name: 'Test Session',
    messages,
    compactionPoints: options?.compactionPoints,
    settings: options?.settings,
    threads: options?.threads,
  }
}

function createTestThread(
  messages: Message[],
  options?: {
    id?: string
    compactionPoints?: CompactionPoint[]
  }
): SessionThread {
  return {
    id: options?.id ?? uuidv4(),
    name: 'Test Thread',
    messages,
    createdAt: Date.now(),
    compactionPoints: options?.compactionPoints,
  }
}

describe('Context Management Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Context Building with Compaction Points', () => {
    it('should return all messages when no compaction points exist', () => {
      const messages = [
        createTestMessage('user', 'Hello'),
        createTestMessage('assistant', 'Hi there!'),
        createTestMessage('user', 'How are you?'),
        createTestMessage('assistant', 'I am doing well.'),
      ]

      const result = buildContextForAI({ messages })

      expect(result).toHaveLength(4)
      expect(result[0].contentParts[0]).toEqual({ type: 'text', text: 'Hello' })
    })

    it('should slice messages from compaction point boundary', () => {
      const msg1 = createTestMessage('user', 'Old message 1')
      const msg2 = createTestMessage('assistant', 'Old response 1')
      const msg3 = createTestMessage('user', 'New message 1')
      const msg4 = createTestMessage('assistant', 'New response 1')
      const summaryMsg = createTestMessage('assistant', 'Summary of old conversation', {
        isSummary: true,
      })

      const messages = [msg1, msg2, msg3, msg4, summaryMsg]
      const compactionPoints = [createCompactionPoint(summaryMsg.id, msg2.id)]

      const result = buildContextForAI({ messages, compactionPoints })

      // Should include: summary, msg3, msg4 (after boundary msg2)
      expect(result).toHaveLength(3)
      expect(result[0].isSummary).toBe(true)
      expect(result[0].contentParts[0]).toEqual({ type: 'text', text: 'Summary of old conversation' })
      expect(result[1].contentParts[0]).toEqual({ type: 'text', text: 'New message 1' })
      expect(result[2].contentParts[0]).toEqual({ type: 'text', text: 'New response 1' })
    })

    it('should use the latest compaction point when multiple exist', () => {
      const msg1 = createTestMessage('user', 'Very old message')
      const msg2 = createTestMessage('assistant', 'Very old response')
      const msg3 = createTestMessage('user', 'Old message')
      const msg4 = createTestMessage('assistant', 'Old response')
      const msg5 = createTestMessage('user', 'New message')
      const msg6 = createTestMessage('assistant', 'New response')

      const summary1 = createTestMessage('assistant', 'First summary', { isSummary: true })
      const summary2 = createTestMessage('assistant', 'Latest summary', { isSummary: true })

      const messages = [msg1, msg2, msg3, msg4, msg5, msg6, summary1, summary2]

      // Create two compaction points with different timestamps
      const compactionPoints = [
        createCompactionPoint(summary1.id, msg2.id, Date.now() - 10000), // Older
        createCompactionPoint(summary2.id, msg4.id, Date.now()), // Newer
      ]

      const result = buildContextForAI({ messages, compactionPoints })

      // Should use summary2 and start from msg5 (after msg4)
      expect(result).toHaveLength(3)
      expect(result[0].contentParts[0]).toEqual({ type: 'text', text: 'Latest summary' })
      expect(result[1].contentParts[0]).toEqual({ type: 'text', text: 'New message' })
    })

    it('should skip a compaction point whose summary is missing and fall back to all messages', () => {
      const msg1 = createTestMessage('user', 'Old message')
      const msg2 = createTestMessage('assistant', 'Old response')
      const msg3 = createTestMessage('user', 'New message')
      const msg4 = createTestMessage('assistant', 'New response')

      const messages = [msg1, msg2, msg3, msg4]

      // Compaction point references a non-existent summary
      const compactionPoints = [createCompactionPoint('non-existent-summary-id', msg2.id)]

      const result = buildContextForAI({ messages, compactionPoints })

      // A point is only valid when both its summary and boundary exist on the
      // current path. Otherwise retain the full non-summary history.
      expect(result).toHaveLength(4)
      expect(result[0].contentParts[0]).toEqual({ type: 'text', text: 'Old message' })
    })

    it('should skip a compaction point whose boundary is missing without leaking the orphaned summary', () => {
      const messages = [createTestMessage('user', 'Message 1'), createTestMessage('assistant', 'Response 1')]
      const summary = createTestMessage('assistant', 'Summary', { isSummary: true })
      messages.push(summary)

      // Boundary references non-existent message
      const compactionPoints = [createCompactionPoint(summary.id, 'non-existent-boundary-id')]

      const result = buildContextForAI({ messages, compactionPoints })

      // Falls back to all messages, but the summary of the torn point may only
      // enter context as the stand-in of an applied compaction point
      expect(result).toHaveLength(2)
      expect(result.some((m) => m.isSummary)).toBe(false)
    })

    it('should filter out summary messages from messagesAfterBoundary', () => {
      const msg1 = createTestMessage('user', 'Old')
      const msg2 = createTestMessage('assistant', 'Old response')
      const summary1 = createTestMessage('assistant', 'Summary 1', { isSummary: true })
      const msg3 = createTestMessage('user', 'New')
      const msg4 = createTestMessage('assistant', 'New response')
      const summary2 = createTestMessage('assistant', 'Summary 2', { isSummary: true })

      const messages = [msg1, msg2, summary1, msg3, msg4, summary2]

      // Compaction point at msg2
      const compactionPoints = [createCompactionPoint(summary2.id, msg2.id)]

      const result = buildContextForAI({ messages, compactionPoints })

      // Should include summary2 + msg3 + msg4 (summary1 should be filtered out)
      expect(result).toHaveLength(3)
      expect(result.filter((m) => m.isSummary)).toHaveLength(1)
      expect(result[0].contentParts[0]).toEqual({ type: 'text', text: 'Summary 2' })
    })
  })

  describe('Tool Calls in Estimation Context Building', () => {
    it('keeps tool calls of every round at full fidelity', () => {
      const toolCallPart = createToolCallPart('read_file', { path: '/test.txt' })

      const msg1 = createTestMessage('user', 'Read file', {
        contentParts: [{ type: 'text', text: 'Read file' }],
      })
      const msg2 = createTestMessage('assistant', 'File content', {
        contentParts: [{ type: 'text', text: 'Content' }, toolCallPart],
      })
      const msg3 = createTestMessage('user', 'New question')
      const msg4 = createTestMessage('assistant', 'New answer')

      const messages = [msg1, msg2, msg3, msg4]

      const result = buildContextForAI({ messages })

      expect(result).toHaveLength(4)

      // Older rounds keep their tool calls: pressure estimation and the
      // compaction summarizer must both see the full history.
      const msg2Result = result[1]
      expect(msg2Result.contentParts.some((p) => p.type === 'tool-call')).toBe(true)
      expect(msg2Result.contentParts.find((p) => p.type === 'tool-call')).toMatchObject({
        args: { path: '/test.txt' },
        result: { success: true },
      })
    })
  })

  describe('Session and Thread Context Building', () => {
    it('should build context for session with compaction points', () => {
      const msg1 = createTestMessage('user', 'Old')
      const msg2 = createTestMessage('assistant', 'Old response')
      const msg3 = createTestMessage('user', 'New')
      const msg4 = createTestMessage('assistant', 'New response')
      const summary = createTestMessage('assistant', 'Summary', { isSummary: true })

      const session = createTestSession([msg1, msg2, msg3, msg4, summary], {
        compactionPoints: [createCompactionPoint(summary.id, msg2.id)],
      })

      const result = buildContextForSession(session)

      expect(result).toHaveLength(3) // summary + msg3 + msg4
      expect(result[0].isSummary).toBe(true)
    })

    it('should build context for specific thread in session', () => {
      const sessionMessages = [createTestMessage('user', 'Session message')]

      const threadMsg1 = createTestMessage('user', 'Thread message 1')
      const threadMsg2 = createTestMessage('assistant', 'Thread response 1')
      const threadSummary = createTestMessage('assistant', 'Thread summary', { isSummary: true })

      const thread = createTestThread([threadMsg1, threadMsg2, threadSummary], {
        compactionPoints: [createCompactionPoint(threadSummary.id, threadMsg1.id)],
      })

      const session = createTestSession(sessionMessages, {
        threads: [thread],
      })

      const result = buildContextForSession(session, { threadId: thread.id })

      // Should use thread's messages and compaction points
      expect(result).toHaveLength(2) // summary + threadMsg2
      expect(result[0].isSummary).toBe(true)
    })

    it('should build context for standalone thread', () => {
      const msg1 = createTestMessage('user', 'Thread msg 1')
      const msg2 = createTestMessage('assistant', 'Thread response 1')
      const msg3 = createTestMessage('user', 'Thread msg 2')
      const msg4 = createTestMessage('assistant', 'Thread response 2')
      const summary = createTestMessage('assistant', 'Thread summary', { isSummary: true })

      const thread = createTestThread([msg1, msg2, msg3, msg4, summary], {
        compactionPoints: [createCompactionPoint(summary.id, msg2.id)],
      })

      const result = buildContextForThread(thread)

      expect(result).toHaveLength(3) // summary + msg3 + msg4
    })

    it('should fall back to session messages when threadId not found', () => {
      const sessionMessages = [
        createTestMessage('user', 'Session message'),
        createTestMessage('assistant', 'Session response'),
      ]

      const session = createTestSession(sessionMessages, {
        threads: [],
      })

      const result = buildContextForSession(session, { threadId: 'non-existent-thread' })

      // Should use session messages
      expect(result).toHaveLength(2)
      expect(result[0].contentParts[0]).toEqual({ type: 'text', text: 'Session message' })
    })
  })

  describe('Session-level vs Global Settings Priority', () => {
    it('should prioritize session-level autoCompaction over global', () => {
      const globalSettings: Partial<Settings> = { autoCompaction: true }
      const sessionSettings: SessionSettings = { autoCompaction: false }

      const result = isAutoCompactionEnabled(sessionSettings, globalSettings as Settings)

      expect(result).toBe(false) // Session setting takes priority
    })

    it('should use global autoCompaction when session is undefined', () => {
      const globalSettings: Partial<Settings> = { autoCompaction: false }
      const sessionSettings: SessionSettings = {} // autoCompaction undefined

      const result = isAutoCompactionEnabled(sessionSettings, globalSettings as Settings)

      expect(result).toBe(false) // Falls back to global
    })

    it('should default to true when both are undefined', () => {
      const result = isAutoCompactionEnabled(undefined, undefined)

      expect(result).toBe(true) // Default is true
    })

    it('should use session true over global false', () => {
      const globalSettings: Partial<Settings> = { autoCompaction: false }
      const sessionSettings: SessionSettings = { autoCompaction: true }

      const result = isAutoCompactionEnabled(sessionSettings, globalSettings as Settings)

      expect(result).toBe(true)
    })
  })

  describe('Compaction Trigger Detection (Overflow)', () => {
    it('should detect overflow when tokens exceed threshold', () => {
      // gpt-4o has 128k context
      // Available = 128000 - 32000 = 96000
      // Threshold at 0.6 = 57600
      const highTokens = 60_000 // Above threshold

      const result = checkOverflow({ tokens: highTokens, modelId: 'gpt-4o' })

      expect(result.isOverflow).toBe(true)
      expect(result.contextWindow).toBe(128_000)
      expect(result.thresholdTokens).toBe(Math.floor(96_000 * DEFAULT_COMPACTION_THRESHOLD))
    })

    it('should not detect overflow when tokens are below threshold', () => {
      const lowTokens = 30_000 // Below threshold

      const result = checkOverflow({ tokens: lowTokens, modelId: 'gpt-4o' })

      expect(result.isOverflow).toBe(false)
    })

    it('should assume a fallback window for unknown models', () => {
      // Fallback window 128k: threshold = (128k − 32k) × 0.6 = 57.6k
      const result = checkOverflow({ tokens: 100_000, modelId: 'unknown-model' })

      expect(result.isOverflow).toBe(true)
      expect(result.contextWindow).toBe(128_000)
    })

    it('should use custom compactionThreshold from settings', () => {
      // With 0.9 threshold: 96000 * 0.9 = 86400
      const tokens = 70_000 // Would overflow at 0.6, but not at 0.9

      const resultDefault = checkOverflow({ tokens, modelId: 'gpt-4o' })
      const resultHigh = checkOverflow({
        tokens,
        modelId: 'gpt-4o',
        settings: { compactionThreshold: 0.9 },
      })

      expect(resultDefault.isOverflow).toBe(true)
      expect(resultHigh.isOverflow).toBe(false)
    })

    it('should handle models with different context windows', () => {
      // Claude 3.5 has 200k context
      // Available = 200000 - 32000 = 168000
      // Threshold at 0.6 = 100800
      const result = checkOverflow({ tokens: 90_000, modelId: 'claude-3-5-sonnet-20241022' })

      expect(result.isOverflow).toBe(false) // 90000 < 100800
      expect(result.contextWindow).toBe(200_000)
    })

    it('should handle models with small context windows', () => {
      // small-context-model has 48k
      // With fallback: Available = max(48000 - 32000, 48000 * 0.5) = max(16000, 24000) = 24000
      // Threshold at 0.6 = 14400
      const contextWindow = 48_000
      const availableWindow = Math.max(contextWindow - OUTPUT_RESERVE_TOKENS, Math.floor(contextWindow * 0.5))
      const result = checkOverflow({ tokens: 10_000, modelId: 'small-context-model' })

      expect(result.isOverflow).toBe(false) // 10000 < 14400
      expect(result.thresholdTokens).toBe(Math.floor(availableWindow * DEFAULT_COMPACTION_THRESHOLD))
    })

    it('should correctly compute threshold at boundary', () => {
      // gpt-4o: threshold = 57600
      const threshold = Math.floor((128_000 - OUTPUT_RESERVE_TOKENS) * DEFAULT_COMPACTION_THRESHOLD)

      const atThreshold = checkOverflow({ tokens: threshold, modelId: 'gpt-4o' })
      const aboveThreshold = checkOverflow({ tokens: threshold + 1, modelId: 'gpt-4o' })

      expect(atThreshold.isOverflow).toBe(false)
      expect(aboveThreshold.isOverflow).toBe(true)
    })
  })

  describe('Tool Cleanup Modes (shared buildContext)', () => {
    const attachmentResolver = { read: async () => null }

    function toolConversation(toolCallPart: MessageContentParts[number]) {
      return [
        createTestMessage('user', 'Q1'),
        createTestMessage('assistant', 'Text', {
          contentParts: [{ type: 'text', text: 'Text' }, toolCallPart],
        }),
        createTestMessage('user', 'Q2'),
        createTestMessage('assistant', 'A2'),
      ]
    }

    it('keeps everything intact in mode none', async () => {
      const messages = toolConversation(createToolCallPart('tool1'))

      const result = await buildContext(messages, { attachmentResolver, toolCleanupMode: 'none' })

      expect(result[1].contentParts.some((p) => p.type === 'tool-call')).toBe(true)
      expect(result[1].contentParts.find((p) => p.type === 'tool-call')).toMatchObject({
        result: { success: true },
      })
    })

    it('stubs old results but keeps the call in stub mode', async () => {
      const toolCallPart = createToolCallPart('tool1', { query: 'X' })
      const messages = toolConversation(toolCallPart)

      const result = await buildContext(messages, {
        attachmentResolver,
        toolCleanupMode: 'stub-old-results',
        keepToolCallRounds: 1,
      })

      const stubbed = result[1].contentParts.find((p) => p.type === 'tool-call')
      expect(stubbed).toMatchObject({
        toolName: 'tool1',
        args: { query: 'X' },
        state: 'result',
        result: { _cleared: true },
      })
      // Original message must not be mutated
      expect(toolCallPart).toMatchObject({ result: { success: true } })
      // Recent round keeps its parts untouched
      expect(result[3].contentParts.some((p) => p.type === 'tool-call')).toBe(false)
    })
  })

  describe('End-to-End Context Flow', () => {
    it('should correctly build context through multiple compactions', () => {
      // Simulate a conversation with multiple compaction cycles
      const msg1 = createTestMessage('user', 'Round 1 Q')
      const msg2 = createTestMessage('assistant', 'Round 1 A')
      const summary1 = createTestMessage('assistant', 'Summary after round 1', { isSummary: true })

      const msg3 = createTestMessage('user', 'Round 2 Q')
      const msg4 = createTestMessage('assistant', 'Round 2 A')
      const summary2 = createTestMessage('assistant', 'Summary after round 2', { isSummary: true })

      const msg5 = createTestMessage('user', 'Round 3 Q')
      const msg6 = createTestMessage('assistant', 'Round 3 A')

      const messages = [msg1, msg2, summary1, msg3, msg4, summary2, msg5, msg6]

      // Two compaction points
      const compactionPoints = [
        createCompactionPoint(summary1.id, msg2.id, Date.now() - 20000),
        createCompactionPoint(summary2.id, msg4.id, Date.now() - 10000), // Latest
      ]

      const result = buildContextForAI({ messages, compactionPoints })

      // Should use latest compaction point (summary2), include msg5, msg6
      expect(result).toHaveLength(3)
      expect(result[0].contentParts[0]).toEqual({ type: 'text', text: 'Summary after round 2' })
      expect(result[1].contentParts[0]).toEqual({ type: 'text', text: 'Round 3 Q' })
      expect(result[2].contentParts[0]).toEqual({ type: 'text', text: 'Round 3 A' })
    })

    it('should work with session containing both threads and main messages', () => {
      const mainMsg1 = createTestMessage('user', 'Main Q')
      const mainMsg2 = createTestMessage('assistant', 'Main A')
      const mainSummary = createTestMessage('assistant', 'Main summary', { isSummary: true })

      const threadMsg1 = createTestMessage('user', 'Thread Q')
      const threadMsg2 = createTestMessage('assistant', 'Thread A')

      const thread = createTestThread([threadMsg1, threadMsg2], { id: 'thread-1' })

      const session = createTestSession([mainMsg1, mainMsg2, mainSummary], {
        compactionPoints: [createCompactionPoint(mainSummary.id, mainMsg1.id)],
        threads: [thread],
      })

      // Get main session context
      const mainResult = buildContextForSession(session)
      expect(mainResult).toHaveLength(2) // summary + mainMsg2

      // Get thread context
      const threadResult = buildContextForSession(session, { threadId: 'thread-1' })
      expect(threadResult).toHaveLength(2) // threadMsg1 + threadMsg2 (no compaction in thread)
    })
  })
})
