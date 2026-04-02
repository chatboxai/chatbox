/**
 * @vitest-environment jsdom
 */

import '../setup'

import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION } from '@shared/chatbridge/tools'
import { readChatBridgeReviewedAppLaunch } from '@/packages/chatbridge/reviewed-app-launch'
import { ChatBridgeMessagePart } from '@/components/chatbridge/ChatBridgeMessagePart'
import type { MessageAppPart, MessageToolCallPart } from '@shared/types'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { runChatBridgeScenarioTrace } from './scenario-tracing'
import { upsertReviewedAppLaunchParts } from '@/packages/chatbridge/reviewed-app-launch'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

function createChessToolCallPart(): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'tool-reviewed-launch-chess-runtime-1',
    toolName: 'chess_prepare_session',
    args: {
      request: 'No, I mean use the Chess app tool and show me the board.',
      fen: 'startpos',
    },
    result: {
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'chess_prepare_session',
      appId: 'chess',
      sessionId: 'session-reviewed-runtime-1',
      schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
      executionAuthority: 'host',
      effect: 'read',
      retryClassification: 'safe',
      invocation: {
        args: {
          request: 'No, I mean use the Chess app tool and show me the board.',
          fen: 'startpos',
        },
      },
      outcome: {
        status: 'success',
        result: {
          appId: 'chess',
          appName: 'Chess',
          capability: 'prepare-session',
          launchReady: true,
          summary: 'Prepared the reviewed Chess session request for the host-owned launch path.',
          request: 'No, I mean use the Chess app tool and show me the board.',
          fen: 'startpos',
        },
      },
    },
  }
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-chess-reviewed-runtime-handoff',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['chess-runtime', 'renderer'],
      storyId: 'CB-306',
    },
    testCase,
    execute
  )
}

describe('ChatBridge Chess reviewed runtime handoff', () => {
  it('renders a live Chess board instead of the generic reviewed-launch shell after a successful host tool result', () =>
    traceScenario(
      'renders a live Chess board instead of the generic reviewed-launch shell after a successful host tool result',
      () => {
        const derivedPart = upsertReviewedAppLaunchParts([createChessToolCallPart()]).find(
          (part): part is MessageAppPart => part.type === 'app'
        )

        if (!derivedPart) {
          throw new Error('Expected a Chess app part after normalizing the host tool result.')
        }

        expect(derivedPart.appId).toBe('chess')
        expect(readChatBridgeReviewedAppLaunch(derivedPart.values)).toBeNull()

        render(
          <MantineProvider>
            <ChatBridgeMessagePart part={derivedPart} />
          </MantineProvider>
        )

        expect(screen.getByTestId('chatbridge-shell').getAttribute('data-state')).toBe('active')
        expect(screen.getByRole('button', { name: /g1 white knight/i })).toBeTruthy()
        expect(
          screen.getByText('Select a piece, choose a destination square, and the host will validate the move before updating the live board.')
        ).toBeTruthy()
      }
    ))
})
