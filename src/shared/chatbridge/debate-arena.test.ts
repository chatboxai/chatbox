import { describe, expect, it } from 'vitest'
import {
  getChatBridgeDebateArenaPhaseLabel,
  getChatBridgeDebateArenaState,
  getChatBridgeDebateArenaSummaryForModel,
  getChatBridgeDebateArenaWinnerLabel,
} from './debate-arena'

describe('chatbridge debate arena state', () => {
  it('derives host-approved model memory from active structured debate state', () => {
    const state = getChatBridgeDebateArenaState({
      schemaVersion: 1,
      phase: 'opening',
      motion: 'Schools should allow structured AI writing support in class.',
      teams: [
        {
          id: 'team-affirmative',
          name: 'Team Redwood',
          stance: 'affirmative',
          thesis: 'AI scaffolds revision and accessibility.',
        },
        {
          id: 'team-negative',
          name: 'Team Blue',
          stance: 'negative',
          thesis: 'Students should learn without AI dependence first.',
        },
      ],
      rubricFocus: ['evidence quality', 'counterargument clarity'],
      roundLabel: 'Round 2',
      currentSpeaker: {
        name: 'Maya',
        teamId: 'team-affirmative',
        roleLabel: 'evidence reply',
      },
      timerLabel: '01:30 left',
      coachNote: 'Ask for one concrete classroom example before conceding the claim.',
    })

    expect(state).not.toBeNull()
    expect(getChatBridgeDebateArenaPhaseLabel(state!.phase)).toBe('Opening round')

    const summary = getChatBridgeDebateArenaSummaryForModel(
      {
        appId: 'debate-arena',
        appName: 'Debate Arena',
      },
      state!
    )

    expect(summary).toContain('Debate Arena is running the opening round')
    expect(summary).toContain('Current speaker: Maya')
    expect(summary).toContain('Team Redwood (Affirmative)')
    expect(summary).toContain('Rubric focus: evidence quality, counterargument clarity.')
    expect(summary).toContain('Coach note: Ask for one concrete classroom example before conceding the claim.')
  })

  it('derives winner and next-step continuity from completed debate state', () => {
    const state = getChatBridgeDebateArenaState({
      schemaVersion: 1,
      phase: 'complete',
      motion: 'Uniforms improve classroom focus.',
      teams: [
        {
          id: 'team-affirmative',
          name: 'Team Cedar',
          stance: 'affirmative',
          score: 91,
        },
        {
          id: 'team-negative',
          name: 'Team River',
          stance: 'negative',
          score: 84,
        },
      ],
      rubricFocus: ['claim support', 'rebuttal discipline'],
      result: {
        winnerTeamId: 'team-affirmative',
        decision: 'The affirmative team supported each claim with classroom-specific evidence and cleaner rebuttals.',
        nextStep: 'Write a reflection comparing the strongest rebuttal from each side.',
      },
      highlights: ['Affirmative connected uniforms to reduced distraction during lab work.'],
    })

    expect(getChatBridgeDebateArenaWinnerLabel(state!)).toBe('Team Cedar (Affirmative)')

    const summary = getChatBridgeDebateArenaSummaryForModel(
      {
        appId: 'debate-arena',
        appName: 'Debate Arena',
      },
      state!
    )

    expect(summary).toContain('selected Team Cedar (Affirmative) as the winner')
    expect(summary).toContain('Decision: The affirmative team supported each claim')
    expect(summary).toContain('Next step: Write a reflection comparing the strongest rebuttal')
  })

  it('fails closed on malformed structured debate state', () => {
    expect(
      getChatBridgeDebateArenaState({
        schemaVersion: 1,
        phase: 'opening',
        motion: 'Too few teams should fail validation.',
        teams: [
          {
            id: 'team-affirmative',
            name: 'Team Solo',
            stance: 'affirmative',
          },
        ],
      })
    ).toBeNull()

    expect(
      getChatBridgeDebateArenaState({
        schemaVersion: 2,
        phase: 'opening',
        motion: 'Unsupported schema version.',
        teams: [
          {
            id: 'team-affirmative',
            name: 'Team A',
            stance: 'affirmative',
          },
          {
            id: 'team-negative',
            name: 'Team B',
            stance: 'negative',
          },
        ],
      })
    ).toBeNull()
  })
})
