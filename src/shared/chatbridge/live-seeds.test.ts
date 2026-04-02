import { describe, expect, it } from 'vitest'
import {
  buildAppAwareSessionFixture,
  buildChatBridgeChessMidGameSessionFixture,
  buildChatBridgeDegradedCompletionRecoverySessionFixture,
  buildChatBridgePlatformRecoverySessionFixture,
  buildChatBridgeChessRuntimeSessionFixture,
  buildChatBridgeHistoryAndPreviewSessionFixture,
  buildChatBridgeLifecycleTourSessionFixture,
  buildPartialLifecycleSessionFixture,
  getChatBridgeLiveSeedFixtures,
} from './live-seeds'

describe('chatbridge live seed fixtures', () => {
  it('keeps the app-aware fixture thread history and active checkpoint explicit', () => {
    const fixture = buildAppAwareSessionFixture()

    expect(fixture.sessionInput.threads).toHaveLength(1)
    expect(fixture.sessionInput.messages.at(-1)?.contentParts.some((part) => part.type === 'app')).toBe(true)
    expect(fixture.historyThread.messages.at(-1)?.contentParts.some((part) => part.type === 'app')).toBe(true)
  })

  it('keeps the partial lifecycle fixture stale and intentionally incomplete', () => {
    const fixture = buildPartialLifecycleSessionFixture()
    const assistantMessage = fixture.messages.at(-1)
    const appPart = assistantMessage?.contentParts.find((part) => part.type === 'app')
    const toolCallPart = assistantMessage?.contentParts.find((part) => part.type === 'tool-call')

    expect(appPart && appPart.type === 'app' ? appPart.lifecycle : undefined).toBe('stale')
    expect(toolCallPart && toolCallPart.type === 'tool-call' ? toolCallPart.state : undefined).toBe('call')
    expect(toolCallPart && toolCallPart.type === 'tool-call' ? toolCallPart.result : undefined).toBeUndefined()
  })

  it('builds a lifecycle tour that covers every host shell state', () => {
    const fixture = buildChatBridgeLifecycleTourSessionFixture()
    const lifecycles = fixture.messages
      .flatMap((message) => message.contentParts)
      .filter((part) => part.type === 'app')
      .map((part) => part.lifecycle)

    expect(lifecycles).toEqual(['launching', 'ready', 'active', 'complete', 'stale', 'error'])
  })

  it('builds a degraded recovery fixture with explicit recovery metadata for each state', () => {
    const fixture = buildChatBridgeDegradedCompletionRecoverySessionFixture()
    const appParts = fixture.messages
      .flatMap((message) => message.contentParts)
      .filter((part) => part.type === 'app')

    expect(appParts).toHaveLength(3)
    expect(appParts.map((part) => part.statusText)).toEqual([
      'Partial completion',
      'Missing completion',
      'Invalid completion',
    ])
    expect(
      appParts.map((part) => part.values?.chatbridgeDegradedCompletion && typeof part.values?.chatbridgeDegradedCompletion === 'object')
    ).toEqual([true, true, true])
  })

  it('builds a platform recovery fixture with explicit host-owned failure contracts', () => {
    const fixture = buildChatBridgePlatformRecoverySessionFixture()
    const appParts = fixture.messages
      .flatMap((message) => message.contentParts)
      .filter((part) => part.type === 'app')

    expect(appParts).toHaveLength(5)
    expect(appParts.map((part) => part.statusText)).toEqual([
      'Timed out',
      'Runtime crash',
      'Invalid tool call',
      'Malformed event',
      'Bridge rejected',
    ])
    expect(
      appParts.map(
        (part) => part.values?.chatbridgeRecoveryContract && typeof part.values?.chatbridgeRecoveryContract === 'object'
      )
    ).toEqual([true, true, true, true, true])
  })

  it('builds a history plus preview fixture with renderable HTML and stored blobs', () => {
    const fixture = buildChatBridgeHistoryAndPreviewSessionFixture()
    const assistantMessage = fixture.sessionInput.messages.at(-1)
    const previewText =
      assistantMessage?.contentParts.find((part) => part.type === 'text' && part.text.includes('```html')) || null

    expect(fixture.sessionInput.threads).toHaveLength(1)
    expect(previewText).toBeTruthy()
    expect(fixture.blobEntries).toHaveLength(1)
    expect(fixture.blobEntries[0].key).toContain('fixture:msg-current-assistant:attachment')
  })

  it('builds a chess mid-game fixture with a validated host-owned board summary', () => {
    const fixture = buildChatBridgeChessMidGameSessionFixture()
    const assistantMessage = fixture.messages.find((message) => message.id === 'msg-chess-assistant-board')

    const appPart = assistantMessage?.contentParts.find((part) => part.type === 'app')

    expect(appPart && appPart.type === 'app' ? appPart.appId : undefined).toBe('chess')
    expect(appPart && appPart.type === 'app' ? appPart.lifecycle : undefined).toBe('active')
    expect(appPart && appPart.type === 'app' ? appPart.snapshot : undefined).toMatchObject({
      route: '/apps/chess',
      boardContext: {
        schemaVersion: 1,
        sideToMove: 'white',
        fullmoveNumber: 6,
      },
    })
  })

  it('builds a chess runtime fixture with a live board snapshot and seeded app records', () => {
    const fixture = buildChatBridgeChessRuntimeSessionFixture()
    const assistantMessage = fixture.messages.at(-1)
    const appPart = assistantMessage?.contentParts.find((part) => part.type === 'app')

    expect(appPart && appPart.type === 'app' ? appPart.appId : undefined).toBe('chess')
    expect(appPart && appPart.type === 'app' ? appPart.lifecycle : undefined).toBe('active')
    expect(fixture.chatBridgeAppRecords?.instances[0]).toMatchObject({
      appId: 'chess',
      status: 'active',
    })
    expect(fixture.chatBridgeAppRecords?.events).toHaveLength(3)
  })

  it('publishes the live seed catalog with stable scenario ids', () => {
    const fixtures = getChatBridgeLiveSeedFixtures()

    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      'lifecycle-tour',
      'degraded-completion-recovery',
      'platform-recovery',
      'chess-mid-game-board-context',
      'chess-runtime',
      'history-and-preview',
    ])
    expect(fixtures.find((fixture) => fixture.id === 'chess-runtime')).toMatchObject({
      fixtureRole: 'active-flagship',
      smokeSupport: 'supported',
    })
    expect(fixtures.find((fixture) => fixture.id === 'history-and-preview')).toMatchObject({
      fixtureRole: 'legacy-reference',
      smokeSupport: 'legacy-reference',
    })
  })
})
