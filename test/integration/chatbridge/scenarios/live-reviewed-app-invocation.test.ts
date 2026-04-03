import '../setup'

import type { ModelMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import type { Message, MessageAppPart, MessageContentParts, StreamTextResult } from '@shared/types'
import { readChatBridgeReviewedAppLaunch } from '@/packages/chatbridge/reviewed-app-launch'

const langsmithMocks = vi.hoisted(() => ({
  end: vi.fn(async () => undefined),
  startRun: vi.fn(async () => ({
    runId: 'renderer-run-1',
    end: langsmithMocks.end,
  })),
  recordEvent: vi.fn(async () => undefined),
}))

vi.mock('@/adapters/langsmith', () => ({
  langsmith: {
    startRun: langsmithMocks.startRun,
    recordEvent: langsmithMocks.recordEvent,
  },
}))

import { streamText } from '@/packages/model-calls/stream-text'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

function createTextMessage(id: string, role: Message['role'], text: string, timestamp: number): Message {
  return {
    id,
    role,
    timestamp,
    contentParts: [{ type: 'text', text }],
  }
}

function getLatestUserPrompt(messages: ModelMessage[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  if (!latestUserMessage) {
    return ''
  }

  return typeof latestUserMessage.content === 'string' ? latestUserMessage.content : JSON.stringify(latestUserMessage.content)
}

function createToolCallingModelStub(selectTool: (prompt: string) => { toolName: string; args: Record<string, unknown> }) {
  const chat = vi.fn(
    async (messages: ModelMessage[], options: CallChatCompletionOptions): Promise<StreamTextResult> => {
      const prompt = getLatestUserPrompt(messages)
      const selectedTool = selectTool(prompt)
      const tool = options.tools?.[selectedTool.toolName]

      if (!tool?.execute) {
        return {
          contentParts: [{ type: 'text', text: `missing tool:${selectedTool.toolName}` }],
        }
      }

      const toolCallId = `tool-${selectedTool.toolName}`
      const toolResult = await tool.execute(selectedTool.args, {
        toolCallId,
        messages,
      })

      return {
        contentParts: [
          {
            type: 'tool-call',
            state:
              typeof toolResult === 'object' &&
              toolResult !== null &&
              'outcome' in toolResult &&
              typeof toolResult.outcome === 'object' &&
              toolResult.outcome !== null &&
              'status' in toolResult.outcome &&
              toolResult.outcome.status === 'success'
                ? 'result'
                : 'error',
            toolCallId,
            toolName: selectedTool.toolName,
            args: selectedTool.args,
            result: toolResult,
          },
        ],
      }
    }
  )

  const model: ModelInterface = {
    name: 'Tool Calling Test ChatBridge Model',
    modelId: 'test-chatbridge-tool-calling-model',
    isSupportVision: () => true,
    isSupportToolUse: () => true,
    isSupportSystemMessage: () => true,
    chat,
    chatStream: vi.fn(async function* () {}),
    paint: vi.fn(async () => []),
  }

  return {
    chat,
    model,
  }
}

function findAppPart(contentParts: MessageContentParts): MessageAppPart | undefined {
  return contentParts.find((part): part is MessageAppPart => part.type === 'app')
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-live-reviewed-app-invocation',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['routing'],
      storyId: 'CB-506',
    },
    testCase,
    execute
  )
}

describe('ChatBridge live reviewed app invocation path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('launches an eligible non-Chess reviewed app from the live prompt path', () =>
    traceScenario('launches an eligible non-Chess reviewed app from the live prompt path', async () => {
      const prompt = 'Open Drawing Kit and start a sticky-note doodle dare.'
      const { chat, model } = createToolCallingModelStub(() => ({
        toolName: 'drawing_kit_open',
        args: {
          request: prompt,
        },
      }))

      const result = await streamText(model, {
        sessionId: 'session-cb-506-drawing',
        messages: [createTextMessage('msg-drawing-user', 'user', prompt, 1)],
        onResultChangeWithCancel: vi.fn(),
      })

      expect(chat).toHaveBeenCalledOnce()
      expect(Object.keys(chat.mock.calls[0]?.[1]?.tools ?? {})).toEqual(['drawing_kit_open'])
      expect(findAppPart(result.result.contentParts)).toMatchObject({
        appId: 'drawing-kit',
        appName: 'Drawing Kit',
        lifecycle: 'launching',
      })
      expect(langsmithMocks.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'chatbridge.routing.reviewed-app-decision',
          parentRunId: 'renderer-run-1',
          outputs: expect.objectContaining({
            decisionKind: 'invoke',
            selectedAppId: 'drawing-kit',
            selectionSource: 'route-decision',
            toolNames: ['drawing_kit_open'],
          }),
        })
      )
    }))

  it('keeps natural Chess prompts on the live reviewed Chess launch path', () =>
    traceScenario('keeps natural Chess prompts on the live reviewed Chess launch path', async () => {
      const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
      const prompt = `${fen} What is the best move here?`
      const { chat, model } = createToolCallingModelStub(() => ({
        toolName: 'chess_prepare_session',
        args: {
          request: prompt,
          fen,
        },
      }))

      const result = await streamText(model, {
        sessionId: 'session-cb-506-chess-natural',
        messages: [createTextMessage('msg-chess-natural-user', 'user', prompt, 1)],
        onResultChangeWithCancel: vi.fn(),
      })

      expect(chat).toHaveBeenCalledOnce()
      expect(Object.keys(chat.mock.calls[0]?.[1]?.tools ?? {})).toEqual(['chess_prepare_session'])
      const chessPart = findAppPart(result.result.contentParts)
      expect(chessPart).toMatchObject({
        appId: 'chess',
        appName: 'Chess',
        lifecycle: 'active',
      })
      expect(chessPart ? readChatBridgeReviewedAppLaunch(chessPart.values) : null).toBeNull()
      expect(langsmithMocks.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'chatbridge.routing.reviewed-app-decision',
          parentRunId: 'renderer-run-1',
          outputs: expect.objectContaining({
            decisionKind: 'clarify',
            selectedAppId: 'chess',
            selectionSource: 'natural-chess-fallback',
            toolNames: ['chess_prepare_session'],
          }),
        })
      )
    }))
})
