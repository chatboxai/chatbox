export interface TaskProgress {
  phase: string
  current: number
  total?: number
  label?: string
  processedBytes?: number
}

/** Phase transitions and completed counts are immediate; intermediate updates are throttled. */
export function createProgressReporter<T extends TaskProgress>(
  onProgress?: (progress: T) => void,
  now = Date.now,
  intervalMs = 500
) {
  let lastTime = -Infinity
  let lastPhase: string | undefined
  return (progress: T, force = false) => {
    if (!onProgress) return
    const time = now()
    const complete = progress.total !== undefined && progress.total > 0 && progress.current === progress.total
    if (!force && !complete && progress.phase === lastPhase && time - lastTime < intervalMs) return
    lastPhase = progress.phase
    lastTime = time
    onProgress(progress)
  }
}
