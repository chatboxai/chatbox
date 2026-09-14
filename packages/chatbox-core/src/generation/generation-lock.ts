const sessionGenerationTails = new Map<string, Promise<void>>()

/**
 * Serializes message submission and background follow-up generation per session.
 * The queued tail is independent from the task result, so a failed generation
 * cannot poison later submissions.
 */
export async function withSessionGenerationLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionGenerationTails.get(sessionId) ?? Promise.resolve()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  sessionGenerationTails.set(sessionId, tail)

  await previous
  try {
    return await task()
  } finally {
    release()
    if (sessionGenerationTails.get(sessionId) === tail) {
      sessionGenerationTails.delete(sessionId)
    }
  }
}

export function resetSessionGenerationLocksForTests(): void {
  sessionGenerationTails.clear()
}

/** Includes accepted submission work before a generation runtime has been registered. */
export async function waitForSessionGenerations(signal?: AbortSignal): Promise<void> {
  while (sessionGenerationTails.size) {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        const error = new Error('Waiting for generation was canceled')
        error.name = 'AbortError'
        reject(signal?.reason ?? error)
      }
      if (signal?.aborted) {
        cancel()
        return
      }
      signal?.addEventListener('abort', cancel, { once: true })
      void Promise.all(sessionGenerationTails.values()).then(() => {
        signal?.removeEventListener('abort', cancel)
        resolve()
      })
    })
  }
}
