import type { KeyValueStoragePort } from '../ports'

export class InMemoryKeyValueStorage implements KeyValueStoragePort {
  readonly values = new Map<string, unknown>()

  get<T = unknown>(key: string): Promise<T | null> {
    return Promise.resolve((this.values.get(key) as T | undefined) ?? null)
  }

  set<T = unknown>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }

  remove(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.values.keys()])
  }
}
