/** One application owner serializes commands, migration, projection repair and deletion for each session. */
export class SessionRowWriteQueue {
  private readonly tails = new Map<string, Promise<void>>()

  constructor(
    private readonly serializeStorageOperation: <T>(sessionId: string, operation: () => Promise<T>) => Promise<T>
  ) {}

  run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(sessionId) ?? Promise.resolve()).then(() =>
      this.serializeStorageOperation(sessionId, operation)
    )
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(sessionId, tail)
    void tail.then(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId)
    })
    return result
  }
}
