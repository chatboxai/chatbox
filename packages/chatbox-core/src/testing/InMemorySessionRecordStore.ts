import type { SessionRecordStorePort, StoredSessionRecord } from '../ports/session-record-store'

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item))
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  const source = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    copy[key] = cloneValue(source[key])
  }
  return copy
}

function clone<Value>(value: Value): Value {
  return cloneValue(value) as Value
}

/**
 * Reference `SessionRecordStorePort` for tests. Records are copied in and out
 * so callers cannot reach into stored state the way they could not through a
 * serializing store.
 */
export class InMemorySessionRecordStore implements SessionRecordStorePort {
  private readonly records = new Map<string, StoredSessionRecord>()
  initializeCount = 0

  initialize(): Promise<void> {
    this.initializeCount += 1
    return Promise.resolve()
  }

  getRecord(id: string): Promise<StoredSessionRecord | null> {
    const record = this.records.get(id)
    return Promise.resolve(record ? clone(record) : null)
  }

  setRecord(record: StoredSessionRecord): Promise<void> {
    if (!record.id) {
      return Promise.reject(new Error('record is missing an id'))
    }
    this.records.set(record.id, clone(record))
    return Promise.resolve()
  }

  removeRecord(id: string): Promise<void> {
    this.records.delete(id)
    return Promise.resolve()
  }

  listIds(): Promise<string[]> {
    return Promise.resolve([...this.records.keys()])
  }

  clear(): void {
    this.records.clear()
  }

  snapshot(): StoredSessionRecord[] {
    return [...this.records.values()].map((record) => clone(record))
  }
}
