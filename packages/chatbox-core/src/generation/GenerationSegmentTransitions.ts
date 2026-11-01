/**
 * Tracks the one structural write at a provider-step boundary. This is not a
 * session lock: the existing generation/streaming write coordinators still own
 * serialization. Cancellation joins this work before deriving its terminal
 * message so it cannot finalize the old target during an ownership transfer.
 */
export class GenerationSegmentTransitions {
  private pending: Promise<boolean> | undefined

  constructor(private readonly signal: AbortSignal) {}

  run(write: () => Promise<boolean>, adopt: () => void): Promise<boolean> {
    if (this.pending) throw new Error('A generation segment transition is already in progress')
    // Install pending before invoking a host callback, including synchronous ones.
    const task = Promise.resolve().then(async () => {
      if (this.signal.aborted) return false
      const committed = await write()
      // A durable split must be adopted even when Stop arrived during I/O.
      // settle() makes the cancellation path finish the continuation, not its
      // already-finalized predecessor. There is no await inside this handoff.
      if (committed) adopt()
      return committed
    })
    this.pending = task
    const clear = () => {
      if (this.pending === task) this.pending = undefined
    }
    void task.then(clear, clear)
    return task
  }

  async settle(): Promise<void> {
    // A failed atomic write leaves the old target intact. Its error belongs to
    // the caller; it must not prevent Stop from persisting that target.
    await this.pending?.catch(() => undefined)
  }
}
