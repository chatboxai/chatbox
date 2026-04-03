import type { ToolExecutionOptions } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDrawingKitAppSnapshot,
  createInitialChessAppSnapshot,
  type DrawingKitAppSnapshot,
} from '@shared/chatbridge'
import type { MessageAppPart, Session } from '@shared/types'
import { prepareToolsForExecution } from '../model-calls/stream-text'
import { createActiveChatBridgeToolSet, upsertChatBridgeActiveAppArtifacts } from './active-app-tools'

const mocks = vi.hoisted(() => {
  const state = {
    session: null as Session | null,
  }

  return {
    state,
    saveImage: vi.fn(async () => 'storage://app-shot-1'),
    getSession: vi.fn(async () => state.session),
    updateSessionWithMessages: vi.fn(async (_sessionId: string, updater: (session: Session | null) => Session) => {
      state.session = updater(state.session)
      return state.session
    }),
  }
})

vi.mock('@/stores/chatStore', () => ({
  getSession: mocks.getSession,
  updateSessionWithMessages: mocks.updateSessionWithMessages,
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(async () => ({
    storage: {
      saveImage: mocks.saveImage,
      getImage: vi.fn(async () => ''),
    },
  })),
}))

function getExecutionOptions(toolCallId: string): ToolExecutionOptions {
  return {
    toolCallId,
    messages: [],
  }
}

function createSession(part: MessageAppPart): Session {
  return {
    id: 'session-active-app-1',
    name: 'Active app session',
    type: 'chat',
    messages: [
      {
        id: 'assistant-app-1',
        role: 'assistant',
        contentParts: [part],
      },
    ],
    settings: {},
  }
}

function createChessPart(): MessageAppPart {
  return {
    type: 'app',
    appId: 'chess',
    appName: 'Chess',
    appInstanceId: 'chess-instance-1',
    lifecycle: 'active',
    summary: 'Chess board ready.',
    summaryForModel: 'Chess board ready.',
    snapshot: createInitialChessAppSnapshot(1_000),
  }
}

function createDrawingKitPart(snapshot?: DrawingKitAppSnapshot): MessageAppPart {
  return {
    type: 'app',
    appId: 'drawing-kit',
    appName: 'Drawing Kit',
    appInstanceId: 'drawing-kit-instance-1',
    lifecycle: 'active',
    summary: snapshot?.summary ?? 'Drawing Kit ready.',
    summaryForModel: snapshot?.summary ?? 'Drawing Kit ready.',
    snapshot:
      snapshot ??
      createDrawingKitAppSnapshot({
        roundLabel: 'Dare 09',
        roundPrompt: 'Draw a comet sandwich.',
        status: 'blank',
        lastUpdatedAt: 1_000,
      }),
  }
}

describe('createActiveChatBridgeToolSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.session = null
  })

  it('moves the active chess board from chat and persists the updated host snapshot', async () => {
    mocks.state.session = createSession(createChessPart())

    const { tools } = createActiveChatBridgeToolSet({
      messages: mocks.state.session.messages,
      sessionId: mocks.state.session.id,
    })
    const preparedTools = prepareToolsForExecution(tools, mocks.state.session.id)

    const result = await preparedTools.chess_move_active_game.execute?.(
      {
        from: 'e2',
        to: 'e4',
      },
      getExecutionOptions('tool-chess-move-1')
    )

    expect(result).toMatchObject({
      outcome: {
        status: 'success',
        result: {
          accepted: true,
          move: 'e4',
        },
      },
    })

    const updatedPart = mocks.state.session?.messages[0].contentParts[0]
    expect(updatedPart && updatedPart.type === 'app' ? updatedPart.snapshot : undefined).toMatchObject({
      turn: 'black',
      lastAction: {
        kind: 'accepted',
      },
    })
  })

  it('applies bounded Drawing Kit host commands and persists the synced snapshot', async () => {
    mocks.state.session = createSession(createDrawingKitPart())

    const { tools } = createActiveChatBridgeToolSet({
      messages: mocks.state.session.messages,
      sessionId: mocks.state.session.id,
    })
    const preparedTools = prepareToolsForExecution(tools, mocks.state.session.id)

    const result = await preparedTools.drawing_kit_control_active_canvas.execute?.(
      {
        action: 'draw_shape',
        shape: 'circle',
        caption: 'Moon pizza',
      },
      getExecutionOptions('tool-drawing-kit-1')
    )

    expect(result).toMatchObject({
      outcome: {
        status: 'success',
        result: {
          accepted: true,
          action: 'draw_shape',
        },
      },
    })

    const updatedPart = mocks.state.session?.messages[0].contentParts[0]
    expect(updatedPart && updatedPart.type === 'app' ? updatedPart.snapshot : undefined).toMatchObject({
      status: 'drawing',
    })
    expect(updatedPart && updatedPart.type === 'app' ? updatedPart.summaryForModel : undefined).toContain(
      'Drawing Kit round in progress'
    )
  })

  it('captures a bounded screenshot artifact and hydrates it into an image part', async () => {
    mocks.state.session = createSession(createChessPart())

    const { tools } = createActiveChatBridgeToolSet({
      messages: mocks.state.session.messages,
      sessionId: mocks.state.session.id,
    })
    const preparedTools = prepareToolsForExecution(tools, mocks.state.session.id)

    const result = await preparedTools.capture_active_app_screenshot.execute?.({}, getExecutionOptions('tool-shot-1'))

    expect(result).toMatchObject({
      outcome: {
        status: 'success',
        result: {
          artifact: {
            kind: 'app-screenshot',
            storageKey: 'storage://app-shot-1',
          },
        },
      },
    })

    const updatedPart = mocks.state.session?.messages[0].contentParts[0]
    expect(updatedPart && updatedPart.type === 'app' ? updatedPart.values?.chatbridgeAppMedia : undefined).toMatchObject({
      screenshots: [expect.objectContaining({ storageKey: 'storage://app-shot-1' })],
    })

    const hydrated = upsertChatBridgeActiveAppArtifacts([
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'tool-shot-1',
        toolName: 'capture_active_app_screenshot',
        args: {},
        result,
      },
    ])

    expect(hydrated).toEqual([
      expect.objectContaining({
        type: 'tool-call',
      }),
      {
        type: 'image',
        storageKey: 'storage://app-shot-1',
      },
    ])
  })
})
