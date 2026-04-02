import { describe, expect, it } from 'vitest'
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
})
