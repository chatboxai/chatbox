import { describe, expect, it, vi } from 'vitest'
import type { ModelInterface } from './types'
import { wrapModelWithLangSmith } from './tracing'

describe('wrapModelWithLangSmith', () => {
  it('wraps chat calls in llm runs and preserves parent correlation when provided', async () => {
    const end = vi.fn()
    const startRun = vi.fn(async (_input) => ({
      runId: 'llm-run-1',
      end,
    }))
    const model: ModelInterface = {
      name: 'Fake Model',
      modelId: 'fake-model',
      isSupportVision: () => true,
      isSupportToolUse: () => false,
      isSupportSystemMessage: () => true,
      chat: vi.fn(async () => ({
        contentParts: [{ type: 'text' as const, text: 'Hello there.' }],
      })),
      chatStream: async function* () {
        yield { type: 'text-delta', textDelta: 'Hello there.' } as never
      },
      paint: vi.fn(async () => ['data:image/png;base64,AAAA']),
    }

    const traced = wrapModelWithLangSmith(model, {
      enabled: true,
      startRun,
      recordEvent: vi.fn(),
    })

    await traced.chat(
      [{ role: 'user', content: 'Hi' }],
      {
        traceContext: {
          name: 'session.generate.llm',
          parentRunId: 'parent-run-1',
          metadata: {
            sessionId: 'session-1',
          },
        },
      }
    )

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'session.generate.llm',
        runType: 'llm',
        parentRunId: 'parent-run-1',
        metadata: expect.objectContaining({
          sessionId: 'session-1',
          modelId: 'fake-model',
        }),
      })
    )
    expect(end).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: expect.objectContaining({
          textPreview: 'Hello there.',
        }),
      })
    )
  })

  it('records errors on traced paint calls', async () => {
    const end = vi.fn()
    const startRun = vi.fn(async () => ({
      runId: 'paint-run-1',
      end,
    }))
    const model: ModelInterface = {
      name: 'Fake Model',
      modelId: 'fake-image-model',
      isSupportVision: () => true,
      isSupportToolUse: () => false,
      isSupportSystemMessage: () => true,
      chat: vi.fn(async () => ({ contentParts: [] })),
      chatStream: async function* () {},
      paint: vi.fn(async () => {
        throw new Error('paint failed')
      }),
    }

    const traced = wrapModelWithLangSmith(model, {
      enabled: true,
      startRun,
      recordEvent: vi.fn(),
    })

    await expect(
      traced.paint({
        prompt: 'Draw a castle',
        num: 1,
      })
    ).rejects.toThrow('paint failed')

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Fake Model.paint',
        runType: 'llm',
      })
    )
    expect(end).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'paint failed',
      })
    )
  })
})
