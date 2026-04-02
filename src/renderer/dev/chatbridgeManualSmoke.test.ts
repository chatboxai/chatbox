/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  endRun: vi.fn(async () => undefined),
  startRun: vi.fn(async () => ({
    runId: 'manual-run-1',
    end: mocks.endRun,
  })),
  invoke: vi.fn(async (channel: string) => {
    if (channel === 'langsmith:get-status') {
      return {
        enabled: true,
        projectName: 'chatbox-chatbridge',
        reason: 'enabled',
      }
    }

    throw new Error(`Unexpected channel: ${channel}`)
  }),
}))

vi.mock('@/adapters/langsmith', () => ({
  langsmith: {
    startRun: mocks.startRun,
  },
}))

import { getChatBridgeLiveSeedFixtures } from '@shared/chatbridge/live-seeds'
import {
  finishChatBridgeManualSmokeTrace,
  getChatBridgeManualSmokeFixtureMode,
  getChatBridgeManualSmokeTraceSupport,
  startChatBridgeManualSmokeTrace,
} from './chatbridgeManualSmoke'

describe('chatbridge manual smoke tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'electronAPI', {
      value: {
        invoke: mocks.invoke,
      },
      configurable: true,
      writable: true,
    })
  })

  it('reports desktop tracing as unsupported when the Electron bridge is unavailable', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    await expect(getChatBridgeManualSmokeTraceSupport()).resolves.toMatchObject({
      enabled: false,
      reasonCode: 'renderer-ipc-unavailable',
      runtimeTarget: 'desktop-electron',
      supportState: 'supported',
    })
  })

  it('marks the Story Builder preview fixture as a legacy reference instead of active smoke coverage', () => {
    expect(getChatBridgeManualSmokeFixtureMode('history-and-preview')).toMatchObject({
      support: 'legacy',
      reasonCode: 'legacy-reference',
    })
  })

  it('starts and finishes a traced smoke run for supported Chess fixtures', async () => {
    const fixture = getChatBridgeLiveSeedFixtures().find((candidate) => candidate.id === 'chess-runtime')
    expect(fixture).toBeTruthy()
    if (!fixture) {
      return
    }

    const started = await startChatBridgeManualSmokeTrace(fixture, 'seeded-session-42')

    expect(started).toMatchObject({
      status: 'started',
      traceId: 'manual-run-1',
      traceLabel: expect.stringContaining('chatbridge.manual_smoke.chatbridge-chess-runtime'),
      support: {
        enabled: true,
        runtimeTarget: 'desktop-electron',
        supportState: 'supported',
      },
      run: {
        fixtureId: 'chess-runtime',
        runId: 'manual-run-1',
        projectName: 'chatbox-chatbridge',
      },
    })
    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining('chatbridge.manual_smoke.chatbridge-chess-runtime'),
        runType: 'chain',
        inputs: expect.objectContaining({
          fixtureId: 'chess-runtime',
          sessionId: 'seeded-session-42',
        }),
        metadata: expect.objectContaining({
          runtimeTarget: 'desktop-electron',
          smokeSupport: 'supported',
        }),
        tags: expect.arrayContaining(['runtime-target:desktop-electron', 'smoke-support:supported']),
      })
    )

    await expect(finishChatBridgeManualSmokeTrace('manual-run-1', 'passed')).resolves.toBe(true)
    expect(mocks.endRun).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: expect.objectContaining({
          outcome: 'passed',
          fixtureId: 'chess-runtime',
        }),
      })
    )
  })

  it('returns an explicit unsupported smoke result for legacy reference fixtures', async () => {
    const fixture = getChatBridgeLiveSeedFixtures().find((candidate) => candidate.id === 'history-and-preview')
    expect(fixture).toBeTruthy()
    if (!fixture) {
      return
    }

    await expect(startChatBridgeManualSmokeTrace(fixture, 'seeded-session-legacy')).resolves.toMatchObject({
      status: 'unsupported',
      traceId: null,
      traceLabel: null,
      support: {
        enabled: false,
        runtimeTarget: 'desktop-electron',
        supportState: 'legacy-reference',
        reasonCode: 'legacy-reference',
      },
    })
    expect(mocks.startRun).not.toHaveBeenCalled()
  })
})
