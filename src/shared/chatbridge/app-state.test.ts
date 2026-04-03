import { describe, expect, it } from 'vitest'
import type { MessageAppPart } from '../types/session'
import {
  appendChatBridgeAppScreenshot,
  buildChatBridgeAppStateDigest,
  CHATBRIDGE_APP_MEDIA_VALUES_KEY,
  formatChatBridgeAppStateDigest,
  getLatestChatBridgeAppScreenshot,
} from './app-state'
import { createInitialChessAppSnapshot } from './apps/chess'
import { createDrawingKitAppSnapshot } from './apps/drawing-kit'

function createPart(overrides: Partial<MessageAppPart> = {}): MessageAppPart {
  return {
    type: 'app',
    appId: overrides.appId ?? 'chess',
    appName: overrides.appName ?? 'Chess',
    appInstanceId: overrides.appInstanceId ?? 'instance-1',
    lifecycle: overrides.lifecycle ?? 'active',
    snapshot: overrides.snapshot,
    values: overrides.values,
  }
}

describe('chatbridge app state helpers', () => {
  it('builds a bounded digest for chess app snapshots', () => {
    const digest = buildChatBridgeAppStateDigest(
      createPart({
        appId: 'chess',
        snapshot: createInitialChessAppSnapshot(1_000),
      })
    )

    expect(digest).toMatchObject({
      kind: 'chess',
    })
    expect(formatChatBridgeAppStateDigest(digest)).toContain('Turn: white')
    expect(formatChatBridgeAppStateDigest(digest)).toContain('FEN:')
  })

  it('builds a bounded digest for drawing kit snapshots', () => {
    const digest = buildChatBridgeAppStateDigest(
      createPart({
        appId: 'drawing-kit',
        appName: 'Drawing Kit',
        snapshot: createDrawingKitAppSnapshot({
          roundLabel: 'Dare 11',
          roundPrompt: 'Draw a moon pizza.',
          selectedTool: 'spray',
          status: 'checkpointed',
          caption: 'Moon pizza',
        }),
      })
    )

    expect(digest).toMatchObject({
      kind: 'drawing-kit',
    })
    expect(formatChatBridgeAppStateDigest(digest)).toContain('Prompt: Draw a moon pizza.')
    expect(formatChatBridgeAppStateDigest(digest)).toContain('Tool: spray')
  })

  it('stores only the latest bounded set of app-linked screenshots', () => {
    const first = appendChatBridgeAppScreenshot(undefined, {
      kind: 'app-screenshot',
      appId: 'chess',
      appInstanceId: 'instance-1',
      storageKey: 'shot-1',
      capturedAt: 1,
      source: 'host-rendered',
    })
    const second = appendChatBridgeAppScreenshot(first, {
      kind: 'app-screenshot',
      appId: 'chess',
      appInstanceId: 'instance-1',
      storageKey: 'shot-2',
      capturedAt: 2,
      source: 'host-rendered',
    })
    const third = appendChatBridgeAppScreenshot(second, {
      kind: 'app-screenshot',
      appId: 'chess',
      appInstanceId: 'instance-1',
      storageKey: 'shot-3',
      capturedAt: 3,
      source: 'host-rendered',
    })
    const fourth = appendChatBridgeAppScreenshot(third, {
      kind: 'app-screenshot',
      appId: 'chess',
      appInstanceId: 'instance-1',
      storageKey: 'shot-4',
      capturedAt: 4,
      source: 'host-rendered',
    })

    expect((fourth[CHATBRIDGE_APP_MEDIA_VALUES_KEY] as { screenshots: Array<{ storageKey: string }> }).screenshots).toEqual([
      { kind: 'app-screenshot', appId: 'chess', appInstanceId: 'instance-1', storageKey: 'shot-2', capturedAt: 2, source: 'host-rendered' },
      { kind: 'app-screenshot', appId: 'chess', appInstanceId: 'instance-1', storageKey: 'shot-3', capturedAt: 3, source: 'host-rendered' },
      { kind: 'app-screenshot', appId: 'chess', appInstanceId: 'instance-1', storageKey: 'shot-4', capturedAt: 4, source: 'host-rendered' },
    ])
    expect(getLatestChatBridgeAppScreenshot(fourth)?.storageKey).toBe('shot-4')
  })
})
