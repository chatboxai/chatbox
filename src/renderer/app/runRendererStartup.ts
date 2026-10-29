interface RendererStartupOptions {
  initialize: () => Promise<void>
  reportInitializationError: (error: unknown) => void
  bootstrap: () => Promise<void>
  showStartupError: (error: unknown) => void
  finalize: () => void
}

export async function runRendererStartup({
  initialize,
  reportInitializationError,
  bootstrap,
  showStartupError,
  finalize,
}: RendererStartupOptions): Promise<void> {
  try {
    try {
      await initialize()
    } catch (error) {
      reportInitializationError(error)
      throw error
    }

    await bootstrap()
  } catch (error) {
    showStartupError(error)
  } finally {
    finalize()
  }
}
