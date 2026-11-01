import type { SessionFolderStorePort } from '@chatbox/core/ports'
import { SessionFolderSchema } from '@shared/types'
import { z } from 'zod'
import storage, { nonSessionStorageKey, StorageKey } from '@/storage'

// Loose so fields written by newer versions survive a load/save round trip here.
const SessionFoldersSchema = z.array(SessionFolderSchema.loose())

/** Persists folder definitions in the key-value store. */
export const rendererSessionFolderStore: SessionFolderStorePort = {
  async load() {
    const parsed = SessionFoldersSchema.safeParse(await storage.getItemRaw<unknown>(StorageKey.SessionFolders))
    return parsed.success ? parsed.data : []
  },
  async save(folders) {
    await storage.setItemNow(nonSessionStorageKey(StorageKey.SessionFolders), folders)
  },
}
