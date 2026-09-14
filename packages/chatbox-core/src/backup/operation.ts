import { isAbortError, throwIfAborted } from './abort'

export type BackupOperationKind = 'export' | 'import'
export interface BackupOperationSnapshot {
  readonly kind: BackupOperationKind
  readonly phase: 'preparing' | 'running' | 'cancelling'
}

export interface BackupOperationParticipant {
  /** Stops admission synchronously, then waits for already accepted work. */
  pauseAndDrain(): Promise<void>
  resume(options: { rescan: boolean }): void | Promise<void>
}

export class BackupOperationBusyError extends Error {
  readonly name = 'BackupOperationBusyError'
  constructor() {
    super('A backup operation is already in progress')
  }
}

/** Host-owned task lifetime; cancellation includes draining and cleanup before navigation. */
export class BackupOperationCoordinator {
  private snapshot: BackupOperationSnapshot | null = null
  private controller: AbortController | null = null
  private completion: Promise<void> | null = null
  private readonly participants = new Set<BackupOperationParticipant>()
  private readonly background = new Set<Promise<void>>()
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): BackupOperationSnapshot | null => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  registerParticipant(participant: BackupOperationParticipant): () => void {
    if (this.snapshot) throw new BackupOperationBusyError()
    this.participants.add(participant)
    return () => {
      this.participants.delete(participant)
    }
  }

  /** Skips maintenance during backup; the host's normal scheduler can retry it. */
  runBackground<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (this.snapshot) return Promise.resolve(undefined)
    return this.runWrite(action)
  }

  /** Tracks accepted resource work and rejects new work until backup cleanup finishes. */
  runWrite<T>(action: () => Promise<T>): Promise<T> {
    if (this.snapshot) return Promise.reject(new BackupOperationBusyError())
    const result = Promise.resolve().then(action)
    const tail = result
      .then(
        () => {},
        () => {}
      )
      .then(() => {
        this.background.delete(tail)
      })
    this.background.add(tail)
    return result
  }

  run<T>(kind: BackupOperationKind, action: (signal: AbortSignal) => Promise<T>, hostSignal?: AbortSignal): Promise<T> {
    if (hostSignal && this.controller?.signal === hostSignal && this.snapshot?.kind === kind) {
      return Promise.resolve().then(() => {
        throwIfAborted(hostSignal)
        return action(hostSignal)
      })
    }
    if (this.snapshot) return Promise.reject(new BackupOperationBusyError())
    const controller = new AbortController()
    this.controller = controller
    this.snapshot = { kind, phase: 'preparing' }
    const cancelFromHost = () => {
      void this.cancelAndWait().catch(() => {})
    }
    hostSignal?.addEventListener('abort', cancelFromHost, { once: true })
    const participants = [...this.participants]
    const result = Promise.resolve().then(async () => {
      const failures: unknown[] = []
      let value: T | undefined
      try {
        const preparations = await Promise.allSettled([
          ...participants.map(async (participant) => participant.pauseAndDrain()),
          ...this.background,
        ])
        const failure = preparations.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        throwIfAborted(controller.signal)
        this.publish({ kind, phase: 'running' })
        value = await action(controller.signal)
      } catch (error) {
        failures.push(error)
      } finally {
        for (const participant of participants.reverse()) {
          try {
            await participant.resume({ rescan: kind === 'import' })
          } catch (error) {
            failures.push(error)
          }
        }
        this.controller = null
        hostSignal?.removeEventListener('abort', cancelFromHost)
        this.publish(null)
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'Backup operation and cleanup failed')
      return value as T
    })
    this.completion = result.then(
      () => {},
      (error: unknown) => {
        if (!isAbortError(error)) throw error
      }
    )
    void this.completion.catch(() => {})
    this.publish(this.snapshot)
    if (hostSignal?.aborted) cancelFromHost()
    return result
  }

  async cancelAndWait(): Promise<void> {
    if (!this.snapshot) return
    const completion = this.completion
    this.publish({ ...this.snapshot, phase: 'cancelling' })
    this.controller?.abort()
    await completion
  }

  private publish(snapshot: BackupOperationSnapshot | null): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
