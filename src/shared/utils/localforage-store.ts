import localforage from 'localforage'

const stores = new Map<string, ReturnType<typeof localforage.createInstance>>()

export function getLocalforageStore(name: string): ReturnType<typeof localforage.createInstance> {
  const existingStore = stores.get(name)
  if (existingStore) {
    return existingStore
  }

  const store = localforage.createInstance({ name })
  stores.set(name, store)
  return store
}
