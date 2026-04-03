import '../setup'

import type { ModelMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import type { Message, MessageAppPart, MessageContentParts, StreamTextResult } from '@shared/types'

const langsmithMocks = vi.hoisted(() => ({
  end: vi.fn(async () => undefined),
  startRun: vi.fn(async () => ({
    runId: 'renderer-run-governor-1',
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

function createActiveChessMessage(id: string, timestamp: number): Message {
  return {
    id,
    role: 'assistant',
    timestamp,
    contentParts: [
      {
        type: 'app',
        appId: 'chess',
        appName: 'Chess',
        appInstanceId: 'chess-runtime-1',
        lifecycle: 'active',
        title: 'Chess board',
        description: 'The live Chess runtime stays pinned in the tray while chat continues.',
        summary: 'Updated to Ng5. Black to move from the current board.',
        summaryForModel: 'Updated to Ng5. Black to move from the current board.',
        statusText: 'Black to move',
        snapshot: {
          boardContext: {
            schemaVersion: 1,
            fen: 'r1bqk2r/ppp2ppp/2np4/4p1N1/2B1P3/2NP4/PPP2PPP/R1BQK2R b KQkq - 1 7',
            sideToMove: 'black',
            fullmoveNumber: 7,
            legalMovesCount: 32,
            positionStatus: 'in_progress',
            lastMove: {
              san: 'Ng5',
            },
            summary: 'Black to move after Ng5 from the active host-owned board.',
          },
        },
      },
    ],
  }
}

function getLatestUserPrompt(messages: ModelMessage[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  if (!latestUserMessage) {
    return ''
  }

  return typeof latestUserMessage.content === 'string'
    ? latestUserMessage.content
    : JSON.stringify(latestUserMessage.content)
}

function createToolCallingModelStub(
  selectTool: (prompt: string) => { toolName: string; args: Record<string, unknown> }
) {
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
            state: 'result',
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
    name: 'Execution Governor Tool Calling Model',
    modelId: 'execution-governor-tool-calling-model',
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

function createChatOnlyModelStub() {
  const chat = vi.fn(
    async (_messages: ModelMessage[], _options: CallChatCompletionOptions): Promise<StreamTextResult> => ({
      contentParts: [{ type: 'text', text: 'host response' }],
    })
  )

  const model: ModelInterface = {
    name: 'Execution Governor Chat Model',
    modelId: 'execution-governor-chat-model',
    isSupportVision: () => true,
    isSupportToolUse: () => true,
    isSupportSystemMessage: () => true,
    chat,
    chatStream: vi.fn(async function* () {}),
    paint: vi.fn(async () => []),
  }

  return { chat, model }
}

function findAppPart(contentParts: MessageContentParts): MessageAppPart | undefined {
  return contentParts.find((part): part is MessageAppPart => part.type === 'app')
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-execution-governor-entrypoint',
      primaryFamily: 'routing',
      evidenceFamilies: ['reviewed-app-launch'],
      storyId: 'I001-01',
    },
    testCase,
    execute
  )
}

describe('ChatBridge execution governor entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes an explicit Drawing Kit launch through the live governor seam', () =>
    traceScenario('routes an explicit Drawing Kit launch through the live governor seam', async () => {
      const prompt = 'Open Drawing Kit and start a sticky-note doodle dare.'
      const { chat, model } = createToolCallingModelStub(() => ({
        toolName: 'drawing_kit_open',
        args: {
          request: prompt,
        },
      }))

      const result = await streamText(model, {
        sessionId: 'session-i001-01-drawing',
        messages: [createTextMessage('msg-drawing-user', 'user', prompt, 1)],
        onResultChangeWithCancel: vi.fn(),
      })

      expect(chat).toHaveBeenCalledOnce()
      expect(findAppPart(result.result.contentParts)).toMatchObject({
        appId: 'drawing-kit',
        appName: 'Drawing Kit',
        lifecycle: 'launching',
      })
      expect(langsmithMocks.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'chatbridge.routing.reviewed-app-decision',
          outputs: expect.objectContaining({
            decisionKind: 'invoke',
            selectedAppId: 'drawing-kit',
            selectionSource: 'route-decision',
            toolNames: ['drawing_kit_open'],
          }),
        })
      )
    }))

  it('keeps natural Chess prompts on the live governor path', () =>
    traceScenario('keeps natural Chess prompts on the live governor path', async () => {
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
        sessionId: 'session-i001-01-chess',
        messages: [createTextMessage('msg-chess-user', 'user', prompt, 1)],
        onResultChangeWithCancel: vi.fn(),
      })

      expect(chat).toHaveBeenCalledOnce()
      expect(findAppPart(result.result.contentParts)).toMatchObject({
        appId: 'chess',
        appName: 'Chess',
        lifecycle: 'active',
      })
      expect(langsmithMocks.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'chatbridge.routing.reviewed-app-decision',
          outputs: expect.objectContaining({
            decisionKind: 'clarify',
            selectedAppId: 'chess',
            selectionSource: 'natural-chess-fallback',
            toolNames: ['chess_prepare_session'],
          }),
        })
      )
    }))

  it('keeps active Chess follow-ups in chat instead of surfacing a confirmation artifact', () =>
    traceScenario('keeps active Chess follow-ups in chat instead of surfacing a confirmation artifact', async () => {
      const prompt = 'The board updated to Ng5. What move should Black play next?'
      const { chat, model } = createChatOnlyModelStub()

      const result = await streamText(model, {
        sessionId: 'session-i001-01-active-chess-follow-up',
        messages: [
          createActiveChessMessage('msg-chess-active', 1),
          createTextMessage('msg-follow-up-user', 'user', prompt, 2),
        ],
        onResultChangeWithCancel: vi.fn(),
      })

      expect(chat).toHaveBeenCalledOnce()
      expect(result.result.contentParts).toEqual([{ type: 'text', text: 'host response' }])
      expect(langsmithMocks.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'chatbridge.routing.reviewed-app-decision',
          outputs: expect.objectContaining({
            decisionKind: 'clarify',
            selectedAppId: 'chess',
            selectionSource: 'none',
            toolNames: [],
            artifactInserted: false,
          }),
        })
      )
    }))

  it('injects a live clarify artifact through the governor seam', () =>
    traceScenario('injects a live clarify artifact through the governor seam', async () => {
      const prompt = 'Help me sketch a weather-themed poster.'
      const { chat, model } = createChatOnlyModelStub()

      const result = await streamText(model, {
        sessionId: 'session-i001-01-clarify',
        messages: [createTextMessage('msg-clarify-user', 'user', prompt, 1)],
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
      expect(langsmithMocks.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'chatbridge.routing.reviewed-app-decision',
          outputs: expect.objectContaining({
            decisionKind: 'clarify',
            artifactInserted: true,
            artifactKind: 'clarify',
          }),
        })
      )
    }))

  it('injects a live refuse artifact through the governor seam', () =>
    traceScenario('injects a live refuse artifact through the governor seam', async () => {
      const prompt = 'What should I cook for dinner tonight?'
      const { chat, model } = createChatOnlyModelStub()

      const result = await streamText(model, {
        sessionId: 'session-i001-01-refuse',
        messages: [createTextMessage('msg-refuse-user', 'user', prompt, 1)],
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
      expect(langsmithMocks.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'chatbridge.routing.reviewed-app-decision',
          outputs: expect.objectContaining({
            decisionKind: 'refuse',
            artifactInserted: true,
            artifactKind: 'refuse',
          }),
        })
      )
    }))
})
