import type { ToolExecutionOptions } from 'ai'
import { describe, expect, it } from 'vitest'
import { createMessage } from '@shared/types'
import { prepareToolsForExecution } from '@/packages/model-calls/stream-text'
import { createReviewedSingleAppToolSet } from './single-app-tools'

function getExecutionOptions(toolCallId: string): ToolExecutionOptions {
  return {
    toolCallId,
    messages: [],
  }
}

describe('ChatBridge reviewed single-app tools', () => {
  it('creates the approved Chess host tool and executes it through the host contract', async () => {
    const { selection, tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Open Chess and analyze this FEN for me.')],
    })

    expect(selection).toMatchObject({
      status: 'matched',
      appId: 'chess',
      toolName: 'chess_prepare_session',
    })
    expect(Object.keys(tools)).toEqual(['chess_prepare_session'])

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-300')
    const result = await preparedTools.chess_prepare_session.execute?.(
      {
        request: 'Analyze this chess position for me.',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      },
      getExecutionOptions('tool-chess-success')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      appId: 'chess',
      toolName: 'chess_prepare_session',
      executionAuthority: 'host',
      outcome: {
        status: 'success',
        result: {
          appId: 'chess',
          appName: 'Chess',
          capability: 'prepare-session',
          launchReady: true,
        },
      },
    })
  })

  it('fails closed when the Chess tool receives malformed args', async () => {
    const { tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Analyze this chess position.')],
    })

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-300')
    const result = await preparedTools.chess_prepare_session.execute?.(
      {
        fen: 42,
      } as never,
      getExecutionOptions('tool-chess-invalid-input')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      outcome: {
        status: 'rejected',
        error: {
          code: 'invalid_input',
        },
      },
    })
  })

  it('normalizes Chess invocation failures into host-visible errors', async () => {
    const { tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Analyze this chess position.')],
      executors: {
        chess_prepare_session: async () => {
          throw new Error('Chess backend unavailable')
        },
      },
    })

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-300')
    const result = await preparedTools.chess_prepare_session.execute?.(
      {
        request: 'Analyze this chess position.',
      },
      getExecutionOptions('tool-chess-failure')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      outcome: {
        status: 'error',
        error: {
          code: 'tool_execution_failed',
          details: {
            message: 'Chess backend unavailable',
          },
        },
      },
    })
  })
})
