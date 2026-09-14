import storage from '@/storage'

/** Waits for buffered and in-flight writes before reading a backup snapshot. */
export function flushRendererStorageWrites(): Promise<void> {
  return storage.flushPendingWrites()
}
