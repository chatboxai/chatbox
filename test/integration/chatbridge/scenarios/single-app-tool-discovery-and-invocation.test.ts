import '../setup'

import type { ToolExecutionOptions } from 'ai'
import { describe, expect, it } from 'vitest'
import { createMessage } from '@shared/types'
import { prepareToolsForExecution } from '@/packages/model-calls/stream-text'
import { createReviewedSingleAppToolSet } from '@/packages/chatbridge/single-app-tools'

function getExecutionOptions(toolCallId: string): ToolExecutionOptions {
  return {
    toolCallId,
    messages: [],
  }
}

describe('ChatBridge single-app tool discovery and invocation', () => {
  it('routes an explicit Chess request into the approved host-managed tool path', async () => {
    const { selection, tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Please open Chess and analyze this FEN for me.')],
    })

    expect(selection).toMatchObject({
      status: 'matched',
      appId: 'chess',
      toolName: 'chess_prepare_session',
    })

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-300-integration')
    const result = await preparedTools.chess_prepare_session.execute?.(
      {
        request: 'Open Chess and analyze this position.',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      },
      getExecutionOptions('tool-chess-integration')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      appId: 'chess',
      toolName: 'chess_prepare_session',
      sessionId: 'session-cb-300-integration',
      outcome: {
        status: 'success',
      },
    })
  })

  it('keeps unrelated prompts chat-only and refuses ambiguous board-game prompts', () => {
    const unrelated = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Explain why the sales forecast changed last week.')],
    })
    expect(unrelated.selection).toMatchObject({
      status: 'chat-only',
    })
    expect(unrelated.tools).toEqual({})

    const ambiguous = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Set up a board game and tell me the next move.')],
    })
    expect(ambiguous.selection).toMatchObject({
      status: 'ambiguous',
      reason: 'generic_board_game_request',
    })
    expect(ambiguous.tools).toEqual({})
  })
})
