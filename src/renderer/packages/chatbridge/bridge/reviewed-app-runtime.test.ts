import { describe, expect, it } from 'vitest'
import { createDrawingKitAppSnapshot } from '@shared/chatbridge'
import { createReviewedAppLaunchRuntimeMarkup } from './reviewed-app-runtime'

describe('createReviewedAppLaunchRuntimeMarkup', () => {
  it('builds a local reviewed app runtime that handshakes over the bridge and emits initial state', () => {
    const markup = createReviewedAppLaunchRuntimeMarkup({
      schemaVersion: 1,
      appId: 'chess',
      appName: 'Chess',
      appVersion: '0.1.0',
      toolName: 'chess_prepare_session',
      capability: 'prepare-session',
      summary: 'Prepared the reviewed Chess session request for the host-owned launch path.',
      request: 'Open Chess and analyze this FEN.',
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      uiEntry: 'https://apps.example.com/chess',
      origin: 'https://apps.example.com',
    })

    expect(markup).toContain('Reviewed app bridge launch')
    expect(markup).toContain('host.bootstrap')
    expect(markup).toContain('app.ready')
    expect(markup).toContain('app.state')
    expect(markup).toContain('Open Chess and analyze this FEN.')
    expect(markup).toContain('Chess runtime')
  })

  it('builds a Drawing Kit doodle runtime with checkpoint and completion hooks', () => {
    const markup = createReviewedAppLaunchRuntimeMarkup(
      {
        schemaVersion: 1,
        appId: 'drawing-kit',
        appName: 'Drawing Kit',
        appVersion: '0.1.0',
        toolName: 'drawing_kit_open',
        capability: 'open',
        summary: 'Prepared the reviewed Drawing Kit request for the host-owned launch path.',
        request: 'Open Drawing Kit and start a sticky-note doodle dare.',
        uiEntry: 'https://apps.example.com/drawing-kit',
        origin: 'https://apps.example.com',
      },
      createDrawingKitAppSnapshot({
        request: 'Open Drawing Kit and start a sticky-note doodle dare.',
        roundLabel: 'Dare 05',
        roundPrompt: 'Draw the weirdest sandwich.',
        rewardLabel: 'Llama sticker',
        status: 'checkpointed',
        caption: 'Triple pickle sandwich',
        selectedTool: 'spray',
        strokeCount: 5,
        stickerCount: 2,
        checkpointId: 'drawing-kit-5',
        lastUpdatedAt: 5,
      })
    )

    expect(markup).toContain('data-drawing-kit-runtime="true"')
    expect(markup).toContain('Draw the weirdest sandwich.')
    expect(markup).toContain('Bank this round')
    expect(markup).toContain('Lock this round')
    expect(markup).toContain('Add squiggle')
    expect(markup).toContain('app.complete')
    expect(markup).toContain('checkpointed')
  })
})
