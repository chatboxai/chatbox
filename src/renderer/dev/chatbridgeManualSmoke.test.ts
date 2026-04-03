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

  it('marks the Drawing Kit doodle fixture as a supported CB-509 smoke path', async () => {
    expect(getChatBridgeManualSmokeFixtureMode('drawing-kit-doodle-dare')).toMatchObject({
      support: 'supported',
      descriptor: expect.objectContaining({
        slug: 'chatbridge-drawing-kit-doodle-dare',
        storyId: 'CB-509',
      }),
    })

    const fixture = getChatBridgeLiveSeedFixtures().find((candidate) => candidate.id === 'drawing-kit-doodle-dare')
    expect(fixture).toBeTruthy()
    if (!fixture) {
      return
    }

    await expect(startChatBridgeManualSmokeTrace(fixture, 'seeded-session-drawing')).resolves.toMatchObject({
      status: 'started',
      traceId: 'manual-run-1',
      traceLabel: expect.stringContaining('chatbridge.manual_smoke.chatbridge-drawing-kit-doodle-dare'),
      run: {
        fixtureId: 'drawing-kit-doodle-dare',
      },
    })

    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          fixtureId: 'drawing-kit-doodle-dare',
          storyId: 'CB-509',
        }),
        tags: expect.arrayContaining(['cb-509', 'seed-lab']),
      })
    )

    await expect(finishChatBridgeManualSmokeTrace('manual-run-1', 'passed')).resolves.toBe(true)
  })

  it('marks the Weather Dashboard fixture as a supported CB-510 smoke path', async () => {
    expect(getChatBridgeManualSmokeFixtureMode('weather-dashboard')).toMatchObject({
      support: 'supported',
      descriptor: expect.objectContaining({
        slug: 'chatbridge-weather-dashboard',
        storyId: 'CB-510',
      }),
    })

    const fixture = getChatBridgeLiveSeedFixtures().find((candidate) => candidate.id === 'weather-dashboard')
    expect(fixture).toBeTruthy()
    if (!fixture) {
      return
    }

    await expect(startChatBridgeManualSmokeTrace(fixture, 'seeded-session-weather')).resolves.toMatchObject({
      status: 'started',
      traceId: 'manual-run-1',
      traceLabel: expect.stringContaining('chatbridge.manual_smoke.chatbridge-weather-dashboard'),
      run: {
        fixtureId: 'weather-dashboard',
      },
    })

    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          fixtureId: 'weather-dashboard',
          storyId: 'CB-510',
        }),
        tags: expect.arrayContaining(['cb-510', 'seed-lab']),
      })
    )

    await expect(finishChatBridgeManualSmokeTrace('manual-run-1', 'passed')).resolves.toBe(true)
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
