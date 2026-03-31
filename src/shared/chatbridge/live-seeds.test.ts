import { describe, expect, it } from 'vitest'
import {
  buildAppAwareSessionFixture,
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

  it('publishes the live seed catalog with stable scenario ids', () => {
    const fixtures = getChatBridgeLiveSeedFixtures()

    expect(fixtures.map((fixture) => fixture.id)).toEqual(['lifecycle-tour', 'history-and-preview'])
  })
})
