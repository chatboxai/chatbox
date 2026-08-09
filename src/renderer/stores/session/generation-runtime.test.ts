import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginSessionGeneration,
  generationRuntimeStore,
  isSessionGenerating,
  resetSessionGenerationRuntime,
  settleSessionGeneration,
} from './generation-runtime'

describe('generation runtime', () => {
  beforeEach(() => resetSessionGenerationRuntime())

  it('keeps a session generating until all concurrent replies settle', () => {
    beginSessionGeneration('session-1')
    beginSessionGeneration('session-1')

    settleSessionGeneration('session-1')
    expect(isSessionGenerating(generationRuntimeStore.getState(), 'session-1')).toBe(true)

    settleSessionGeneration('session-1')
    expect(isSessionGenerating(generationRuntimeStore.getState(), 'session-1')).toBe(false)
  })

  it('tracks sessions independently', () => {
    beginSessionGeneration('session-1')
    beginSessionGeneration('session-2')
    settleSessionGeneration('session-1')

    expect(isSessionGenerating(generationRuntimeStore.getState(), 'session-1')).toBe(false)
    expect(isSessionGenerating(generationRuntimeStore.getState(), 'session-2')).toBe(true)
  })
})
