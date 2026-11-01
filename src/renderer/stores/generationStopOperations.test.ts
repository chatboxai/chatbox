import { describe, expect, it, vi } from 'vitest'
import {
  clearMessageGenerationStopOperation,
  clearSessionGenerationStopOperations,
  getGenerationStopStatus,
  messageStopOperationKey,
  sessionStopOperationKey,
  startGenerationStop,
} from './generationStopOperations'

describe('generationStopOperations', () => {
  it('clears a failed message operation when the message reaches terminal state', async () => {
    const key = messageStopOperationKey('terminal-session', 'terminal-message')
    await expect(startGenerationStop(key, () => Promise.reject(new Error('storage unavailable')))).rejects.toThrow(
      'storage unavailable'
    )
    expect(getGenerationStopStatus(key)).toBe('failed')

    clearMessageGenerationStopOperation('terminal-session', 'terminal-message')

    expect(getGenerationStopStatus(key)).toBe('idle')
  })

  it('clears every retained operation when its Session no longer exists', async () => {
    const sessionKey = sessionStopOperationKey('deleted-session')
    const messageKey = messageStopOperationKey('deleted-session', 'deleted-message')
    const stop = vi.fn(() => Promise.reject(new Error('storage unavailable')))
    await expect(startGenerationStop(sessionKey, stop)).rejects.toThrow('storage unavailable')
    await expect(startGenerationStop(messageKey, stop)).rejects.toThrow('storage unavailable')

    clearSessionGenerationStopOperations('deleted-session')

    expect(getGenerationStopStatus(sessionKey)).toBe('idle')
    expect(getGenerationStopStatus(messageKey)).toBe('idle')
  })
})
