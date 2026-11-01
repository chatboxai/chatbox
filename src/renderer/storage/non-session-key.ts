export function nonSessionStorageKey(key: string): string {
  if (key.startsWith('session:')) {
    throw new Error('Session storage keys must be persisted through CurrentSessionRepository.')
  }
  return key
}
