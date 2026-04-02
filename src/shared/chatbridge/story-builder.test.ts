import { describe, expect, it } from 'vitest'
import {
  getChatBridgeStoryBuilderModeLabel,
  getChatBridgeStoryBuilderState,
  getChatBridgeStoryBuilderSummaryForModel,
  isChatBridgeStoryBuilderAppId,
} from './story-builder'

function createState(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    mode: 'active',
    drive: {
      provider: 'google-drive',
      status: 'connected',
      statusLabel: 'Drive connected',
      detail: 'Host-issued access is active for the classroom writing folder.',
      connectedAs: 'student.writer@example.edu',
      folderLabel: 'Creative Writing / Chapter 4',
    },
    draft: {
      title: 'Storm Lantern',
      chapterLabel: 'Chapter 4',
      summary: 'Mara hides the storm lantern before the flood siren starts.',
      excerpt:
        'Mara tucked the lantern beneath the library desk and counted the sirens again before she dared to breathe.',
      wordCount: 812,
      saveState: 'saved',
      saveLabel: 'Saved to Drive 2 minutes ago',
      userGoal: 'Finish chapter four and keep the latest checkpoint in Drive.',
    },
    checkpoints: [
      {
        checkpointId: 'draft-42',
        label: 'Checkpoint 42',
        description: 'Latest draft with the lantern reveal and flood siren beat.',
        savedAtLabel: '2 minutes ago',
        status: 'latest',
        locationLabel: 'Creative Writing / Chapter 4',
      },
    ],
    callout: {
      eyebrow: 'Host guidance',
      title: 'Resume stays explicit',
      description: 'The host can reopen this checkpoint without exposing a raw Drive token to the app runtime.',
    },
    ...overrides,
  }
}

describe('chatbridge story builder state', () => {
  it('parses a valid Story Builder state payload', () => {
    const state = getChatBridgeStoryBuilderState(createState())

    expect(state).toMatchObject({
      mode: 'active',
      drive: {
        status: 'connected',
      },
      draft: {
        chapterLabel: 'Chapter 4',
      },
    })
  })

  it('fails closed when the checkpoint payload is malformed', () => {
    const state = getChatBridgeStoryBuilderState(
      createState({
        checkpoints: [
          {
            checkpointId: 'draft-42',
            label: 'Broken checkpoint',
            status: 'latest',
          },
        ],
      })
    )

    expect(state).toBeNull()
  })

  it('builds a host-owned summary that stays focused on draft continuity', () => {
    const summary = getChatBridgeStoryBuilderSummaryForModel(
      {
        appId: 'story-builder',
        appName: 'Story Builder',
      },
      getChatBridgeStoryBuilderState(createState())!
    )

    expect(summary).toContain('Story Builder is actively drafting Chapter 4.')
    expect(summary).toContain('Drive connected')
    expect(summary).toContain('Checkpoint 42')
    expect(summary).toContain('Mara hides the storm lantern')
  })

  it('exposes stable mode labels and app-id detection', () => {
    expect(getChatBridgeStoryBuilderModeLabel('resume-ready')).toBe('Resume ready')
    expect(isChatBridgeStoryBuilderAppId('story-builder')).toBe(true)
    expect(isChatBridgeStoryBuilderAppId('debate-arena')).toBe(false)
  })
})
