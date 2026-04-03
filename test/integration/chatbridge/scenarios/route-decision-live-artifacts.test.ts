import '../setup'

import type { ModelMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import type { Message, StreamTextResult } from '@shared/types'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

const langsmithMocks = vi.hoisted(() => ({
  end: vi.fn(async () => undefined),
  startRun: vi.fn(async () => ({
    runId: 'renderer-run-route-artifacts-1',
    end: langsmithMocks.end,
  })),
  recordEvent: vi.fn(async () => undefined),
}))

const routeDecisionMocks = vi.hoisted(() => ({
  createReviewedSingleAppToolSet: vi.fn(),
}))

vi.mock('@/adapters/langsmith', () => ({
  langsmith: {
    startRun: langsmithMocks.startRun,
    recordEvent: langsmithMocks.recordEvent,
  },
}))

vi.mock('@/packages/chatbridge/single-app-tools', () => ({
  createReviewedSingleAppToolSet: routeDecisionMocks.createReviewedSingleAppToolSet,
}))

import { streamText } from '@/packages/model-calls/stream-text'

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
      contentParts: [{ type: 'text', text: 'host response' }],
    })
  )

  const model: ModelInterface = {
    name: 'Route Artifact Scenario Model',
    modelId: 'route-artifact-scenario-model',
    isSupportVision: () => true,
    isSupportToolUse: () => true,
    isSupportSystemMessage: () => true,
    chat,
    chatStream: vi.fn(async function* () {}),
    paint: vi.fn(async () => []),
  }

  return { chat, model }
}

function createRouteDecision(kind: 'clarify' | 'refuse', overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 2,
    hostRuntime: 'desktop-electron',
    kind,
    reasonCode: kind === 'clarify' ? 'ambiguous-match' : 'no-confident-match',
    prompt: 'Help me with this request.',
    summary:
      kind === 'clarify'
        ? 'This request could fit Drawing Kit or Weather Dashboard, so the host is asking before launching anything.'
        : 'No reviewed app is a confident fit, so the host will keep helping in chat instead.',
    selectedAppId: kind === 'clarify' ? 'drawing-kit' : undefined,
    matches:
      kind === 'clarify'
        ? [
            {
              appId: 'drawing-kit',
              appName: 'Drawing Kit',
              matchedContexts: [],
              matchedTerms: ['draw'],
              score: 6,
              exactAppMatch: false,
              exactToolMatch: false,
            },
            {
              appId: 'weather-dashboard',
              appName: 'Weather Dashboard',
              matchedContexts: [],
              matchedTerms: ['forecast'],
              score: 4,
              exactAppMatch: false,
              exactToolMatch: false,
            },
          ]
        : [],
    ...overrides,
  }
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-route-decision-live-artifacts',
      primaryFamily: 'routing',
      storyId: 'CB-507',
    },
    testCase,
    execute
  )
}

describe('ChatBridge live route decision artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injects a live clarify artifact into the assistant timeline when the reviewed route needs confirmation', () =>
    traceScenario('injects a live clarify artifact into the assistant timeline when the reviewed route needs confirmation', async () => {
      routeDecisionMocks.createReviewedSingleAppToolSet.mockReturnValue({
        routeDecision: createRouteDecision('clarify'),
        selection: {
          status: 'chat-only',
          promptText: 'Help me with this request.',
        },
        selectionSource: 'none',
        tools: {},
      })
      const { chat, model } = createModelStub()

      const result = await streamText(model, {
        sessionId: 'session-cb-507-clarify',
        messages: [createTextMessage('user-clarify', 'user', 'Help me with this request.', 1)],
        onResultChangeWithCancel: vi.fn(),
      })

      expect(chat).toHaveBeenCalledOnce()
      expect(result.result.contentParts[0]).toMatchObject({
        type: 'app',
        title: 'Choose the next step',
        values: {
          chatbridgeRouteDecision: {
            kind: 'clarify',
          },
        },
      })
    }))

  it('injects a live refusal artifact into the assistant timeline when the reviewed route stays in chat', () =>
    traceScenario('injects a live refusal artifact into the assistant timeline when the reviewed route stays in chat', async () => {
      routeDecisionMocks.createReviewedSingleAppToolSet.mockReturnValue({
        routeDecision: createRouteDecision('refuse', {
          prompt: 'What should I cook for dinner tonight?',
        }),
        selection: {
          status: 'chat-only',
          promptText: 'What should I cook for dinner tonight?',
        },
        selectionSource: 'none',
        tools: {},
      })
      const { chat, model } = createModelStub()

      const result = await streamText(model, {
        sessionId: 'session-cb-507-refuse',
        messages: [createTextMessage('user-refuse', 'user', 'What should I cook for dinner tonight?', 1)],
        onResultChangeWithCancel: vi.fn(),
      })

      expect(chat).toHaveBeenCalledOnce()
      expect(result.result.contentParts[0]).toMatchObject({
        type: 'app',
        title: 'Keep this in chat',
        values: {
          chatbridgeRouteDecision: {
            kind: 'refuse',
          },
        },
      })
    }))
})
