import { describe, expect, it } from 'vitest'
import { ChatBridgeCompletionPayloadSchema } from './completion'

describe('chatbridge completion payload contract', () => {
  it('accepts success payloads with structured outcome data and a suggested summary', () => {
    const payload = ChatBridgeCompletionPayloadSchema.parse({
      schemaVersion: 1,
      status: 'success',
      outcomeData: {
        winner: 'white',
        moveCount: 42,
      },
      suggestedSummary: {
        title: 'Chess match complete',
        text: 'White checkmated black after 42 moves.',
        bullets: ['Opening: Queen pawn', 'Outcome: checkmate'],
      },
    })

    expect(payload).toMatchObject({
      status: 'success',
      outcomeData: {
        winner: 'white',
        moveCount: 42,
      },
      suggestedSummary: {
        title: 'Chess match complete',
      },
    })
  })

  it('accepts interrupted payloads only when resumability is explicit', () => {
    const payload = ChatBridgeCompletionPayloadSchema.parse({
      schemaVersion: 1,
      status: 'interrupted',
      reason: 'awaiting-user-auth',
      resumability: {
        resumable: true,
        checkpointId: 'draft-42',
        resumeHint: 'Reconnect Google Drive to continue the draft export.',
      },
      suggestedSummary: {
        text: 'Story Builder paused after saving a resumable checkpoint.',
      },
    })

    expect(payload).toMatchObject({
      status: 'interrupted',
      resumability: {
        resumable: true,
        checkpointId: 'draft-42',
      },
    })
  })

  it('rejects failed payloads that omit structured error details', () => {
    expect(() =>
      ChatBridgeCompletionPayloadSchema.parse({
        schemaVersion: 1,
        status: 'failed',
        suggestedSummary: {
          text: 'The export failed before the draft could be uploaded.',
        },
      })
    ).toThrow(/error/i)
  })
})
