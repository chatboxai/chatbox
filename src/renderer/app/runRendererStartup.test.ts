import { describe, expect, test, vi } from 'vitest'
import { runRendererStartup } from './runRendererStartup'

describe('runRendererStartup', () => {
  test('shows the startup failure when renderer initialization rejects', async () => {
    const error = new Error('initialization failed')
    const reportInitializationError = vi.fn()
    const bootstrap = vi.fn().mockResolvedValue(undefined)
    const showStartupError = vi.fn()
    const finalize = vi.fn()

    await runRendererStartup({
      initialize: vi.fn().mockRejectedValue(error),
      reportInitializationError,
      bootstrap,
      showStartupError,
      finalize,
    })

    expect(reportInitializationError).toHaveBeenCalledWith(error)
    expect(bootstrap).not.toHaveBeenCalled()
    expect(showStartupError).toHaveBeenCalledWith(error)
    expect(finalize).toHaveBeenCalledOnce()
  })
})
