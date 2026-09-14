import type { BackupProgress } from './types'

/** No timers or payload retention; transitions are immediate and byte updates are bounded. */
export function createBackupProgressReporter(onProgress?: (progress: BackupProgress) => void, now = Date.now) {
  let lastTime = -Infinity
  let lastPhase: BackupProgress['phase'] | undefined
  return (progress: BackupProgress, force = false) => {
    if (!onProgress) return
    const time = now()
    const complete = progress.total > 0 && progress.current === progress.total
    if (!force && !complete && progress.phase === lastPhase && time - lastTime < 500) return
    lastPhase = progress.phase
    lastTime = time
    onProgress(progress)
  }
}
