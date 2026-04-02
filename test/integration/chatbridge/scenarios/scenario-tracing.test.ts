import '../setup'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  end: vi.fn(async () => undefined),
  startRun: vi.fn(async () => ({
    runId: 'scenario-run-1',
    end: mocks.end,
  })),
}))

vi.mock('src/main/adapters/langsmith', () => ({
  createMainLangSmithAdapter: () => ({
    enabled: true,
    startRun: mocks.startRun,
  }),
}))

import { runChatBridgeScenarioTrace } from './scenario-tracing'

describe('chatbridge scenario tracing helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps a scenario in a named LangSmith eval run', async () => {
    await runChatBridgeScenarioTrace(
      {
        slug: 'chatbridge-routing-artifacts',
        primaryFamily: 'routing',
        evidenceFamilies: ['routing'],
      },
      'clarify artifact remains explainable',
      async () => {
        expect(true).toBe(true)
      }
    )

    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'chatbridge.eval.chatbridge-routing-artifacts',
        runType: 'chain',
        metadata: expect.objectContaining({
          primaryFamily: 'routing',
        }),
      })
    )
    expect(mocks.end).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: expect.objectContaining({
          status: 'passed',
        }),
      })
    )
  })
})
