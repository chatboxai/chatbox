import { describe, expect, it } from 'vitest'
import { normalizeChatBridgeCompletionSummaryForModel } from './summary'

describe('chatbridge summary normalization', () => {
  it('uses host-approved summary text and redacts sensitive outcome fields', () => {
    const result = normalizeChatBridgeCompletionSummaryForModel({
      appId: 'story-builder',
      appName: 'Story Builder',
      payload: {
        schemaVersion: 1,
        status: 'success',
        suggestedSummary: {
          text: 'Saved the latest Story Builder draft for follow-up writing.',
        },
        outcomeData: {
          chapterCount: 3,
          accessToken: 'secret-token',
        },
      },
    })

    expect(result.summaryForModel).toContain('Saved the latest Story Builder draft for follow-up writing.')
    expect(result.summaryForModel).toContain('chapterCount: 3')
    expect(result.summaryForModel).not.toContain('secret-token')
    expect(result.redactedKeys).toEqual(['accessToken'])
  })

  it('adds resumability context for interrupted completions', () => {
    const result = normalizeChatBridgeCompletionSummaryForModel({
      appId: 'story-builder',
      appName: 'Story Builder',
      payload: {
        schemaVersion: 1,
        status: 'interrupted',
        reason: 'awaiting-user-auth',
        resumability: {
          resumable: true,
          checkpointId: 'draft-42',
          resumeHint: 'Reconnect Google Drive to finish the export.',
        },
      },
    })

    expect(result.summaryForModel).toContain('Story Builder')
    expect(result.summaryForModel).toContain('awaiting-user-auth')
    expect(result.summaryForModel).toContain('Reconnect Google Drive to finish the export.')
  })
})
