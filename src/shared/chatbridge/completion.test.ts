import { describe, expect, it } from 'vitest'
import {
  CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
  ChatBridgeCompletionPayloadSchema,
} from './completion'

describe('ChatBridge completion payload contract', () => {
  it('parses reusable success, interruption, and failure payloads across app types', () => {
    const payloads = [
      {
        appId: 'chess',
        payload: {
          schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
          status: 'success' as const,
          outcome: {
            code: 'checkmate',
            label: 'Game over',
            data: {
              winner: 'white',
              moveCount: 32,
            },
          },
          suggestedSummary: 'White won by checkmate after 32 moves.',
          resumability: {
            mode: 'restartable' as const,
            reason: 'Completed games can be replayed from a fresh board.',
          },
        },
      },
      {
        appId: 'story-builder',
        payload: {
          schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
          status: 'interrupted' as const,
          outcome: {
            code: 'draft_saved',
            label: 'Draft saved for later',
            data: {
              draftId: 'draft-17',
              sceneCount: 4,
            },
          },
          suggestedSummary: 'The student paused with a saved four-scene draft.',
          resumability: {
            mode: 'resumable' as const,
            resumeKey: 'draft-17',
            reason: 'Resume from the latest draft checkpoint.',
          },
        },
      },
      {
        appId: 'debate-arena',
        payload: {
          schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
          status: 'failure' as const,
          outcome: {
            code: 'round_aborted',
            label: 'Round aborted',
            data: {
              round: 2,
              topic: 'School uniforms',
            },
          },
          resumability: {
            mode: 'restartable' as const,
            reason: 'Start the debate flow again from the host.',
          },
          error: {
            code: 'policy_fetch_failed',
            message: 'Unable to load the rubric for this round.',
            recoverable: true,
          },
        },
      },
    ]

    for (const { appId, payload } of payloads) {
      expect(ChatBridgeCompletionPayloadSchema.parse(payload)).toMatchObject({
        schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
        outcome: payload.outcome,
      })
      expect(appId).toBeTypeOf('string')
    }
  })

  it('fails closed when a failure payload omits structured error context', () => {
    expect(() =>
      ChatBridgeCompletionPayloadSchema.parse({
        schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
        status: 'failure',
        outcome: {
          code: 'round_aborted',
        },
      })
    ).toThrow(/error/i)
  })
})
