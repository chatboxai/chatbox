import { describe, expect, it } from 'vitest'
import type { MessageAppPart } from '../types/session'
import { getChatBridgeRecoveryState, hasChatBridgeDegradedRecovery } from './recovery'
import {
  createChatBridgeTimeoutRecoveryContract,
  writeChatBridgeRecoveryContractValues,
} from './recovery-contract'

function createPart(partial: Partial<MessageAppPart>): MessageAppPart {
  return {
    type: 'app',
    appId: 'story-builder',
    appName: 'Story Builder',
    appInstanceId: 'story-builder-instance-1',
    lifecycle: 'active',
    ...partial,
  }
}

describe('chatbridge recovery normalization', () => {
  it('derives a calm recovery checkpoint from degraded completion payloads', () => {
    const recovery = getChatBridgeRecoveryState(
      createPart({
        lifecycle: 'error',
        summaryForModel: 'Saved the latest outline and export checkpoint.',
        values: {
          chatbridgeUserGoal: 'Keep writing chapter four, then save the draft back to Drive.',
          chatbridgeCompletion: {
            schemaVersion: 1,
            status: 'interrupted',
            reason: 'Drive auth expired before export finished.',
            resumability: {
              resumable: true,
              checkpointId: 'draft-42',
              resumeHint: 'Reconnect Google Drive before resuming export.',
            },
          },
        },
      })
    )

    expect(recovery).not.toBeNull()
    expect(recovery).toMatchObject({
      label: 'Host-owned recovery',
      tone: 'calm',
      userGoal: 'Keep writing chapter four, then save the draft back to Drive.',
    })
    expect(recovery?.summary).toContain('Saved the latest outline and export checkpoint.')
    expect(recovery?.summary).toContain('Reconnect Google Drive before resuming export.')
    expect(recovery?.actions?.map((action) => action.label)).toEqual(['Resume app', 'Ask follow-up'])
    expect(recovery?.actions?.[0].prompt).toContain('Resume the previous Story Builder session')
  })

  it('uses explicit host-authored recovery state when present', () => {
    const recovery = getChatBridgeRecoveryState(
      createPart({
        lifecycle: 'stale',
        values: {
          chatbridgeRecovery: {
            schemaVersion: 1,
            tone: 'calm',
            label: 'Recovery checkpoint',
            userGoal: 'Finish the opening scene.',
            summary: 'The host kept the draft checkpoint and can continue in chat.',
            actions: [
              {
                kind: 'continue_in_chat',
                label: 'Continue in chat',
                prompt: 'Continue in chat from the saved checkpoint.',
              },
            ],
          },
        },
      })
    )

    expect(recovery).toEqual({
      schemaVersion: 1,
      tone: 'calm',
      label: 'Recovery checkpoint',
      userGoal: 'Finish the opening scene.',
      summary: 'The host kept the draft checkpoint and can continue in chat.',
      actions: [
        {
          kind: 'continue_in_chat',
          label: 'Continue in chat',
          prompt: 'Continue in chat from the saved checkpoint.',
        },
      ],
    })
  })

  it('does not treat successful completion as degraded recovery', () => {
    const part = createPart({
      lifecycle: 'complete',
      values: {
        chatbridgeCompletion: {
          schemaVersion: 1,
          status: 'success',
          resumability: {
            resumable: false,
          },
        },
      },
    })

    expect(getChatBridgeRecoveryState(part)).toBeNull()
    expect(hasChatBridgeDegradedRecovery(part)).toBe(false)
  })

  it('derives explainable follow-up prompts from explicit recovery contracts', () => {
    const recovery = getChatBridgeRecoveryState(
      createPart({
        lifecycle: 'error',
        values: writeChatBridgeRecoveryContractValues(
          undefined,
          createChatBridgeTimeoutRecoveryContract({
            appId: 'story-builder',
            appName: 'Story Builder',
            appInstanceId: 'story-builder-1',
            bridgeSessionId: 'bridge-timeout',
            waitedMs: 10_000,
          })
        ),
      })
    )

    expect(recovery).toMatchObject({
      label: 'Host-owned recovery',
      summary: 'Story Builder timed out before the host could trust a live response, so recovery stays explicit in the thread.',
      actions: [
        {
          label: 'Continue safely',
        },
        {
          label: 'Ask for explanation',
        },
      ],
    })
    expect(recovery?.actions?.[1].prompt).toContain('Explain what interrupted the previous Story Builder run')
  })
})
