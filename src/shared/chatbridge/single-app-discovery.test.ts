import { describe, expect, it } from 'vitest'
import { createMessage } from '../types'
import { getDefaultReviewedAppCatalogEntries } from './reviewed-app-catalog'
import { resolveReviewedSingleAppSelection } from './single-app-discovery'

describe('ChatBridge single-app discovery', () => {
  it('matches the approved Chess capability for explicit chess requests', () => {
    const selection = resolveReviewedSingleAppSelection(
      [createMessage('user', 'Analyze this chess position from FEN r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')],
      getDefaultReviewedAppCatalogEntries()
    )

    expect(selection).toMatchObject({
      status: 'matched',
      appId: 'chess',
      toolName: 'chess_prepare_session',
    })
    expect(selection.status).toBe('matched')
    if (selection.status !== 'matched') {
      throw new Error('Expected a matched Chess selection.')
    }
    expect(selection.matchedTerms).toEqual(expect.arrayContaining(['chess', 'fen']))
  })

  it('keeps unrelated prompts on the normal chat path', () => {
    const selection = resolveReviewedSingleAppSelection(
      [createMessage('user', 'Summarize the last three product decisions from this thread.')],
      getDefaultReviewedAppCatalogEntries()
    )

    expect(selection).toMatchObject({
      status: 'chat-only',
    })
  })

  it('treats generic board-game prompts as ambiguous instead of routing to Chess', () => {
    const selection = resolveReviewedSingleAppSelection(
      [createMessage('user', 'Set up a board game position for me and explain the next move.')],
      getDefaultReviewedAppCatalogEntries()
    )

    expect(selection).toMatchObject({
      status: 'ambiguous',
      reason: 'generic_board_game_request',
    })
  })
})
