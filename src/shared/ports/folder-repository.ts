import type { Folder } from '../types/folder'

/**
 * Repository port for folder records.
 *
 * Folders are stored separately from session metadata (Option B) so that
 * chat-session queries never have to filter out folder rows. The sidebar tree
 * joins `Folder[]` with `SessionMetaRecord[]` in memory.
 */
export interface FolderRepositoryPort {
  create(record: Folder): Promise<void>
  createMany(records: Folder[]): Promise<void>
  update(id: string, updates: Partial<Folder>): Promise<Folder | null>
  delete(id: string): Promise<void>
  deleteMany(ids: string[]): Promise<void>
  getById(id: string): Promise<Folder | null>
  getAll(): Promise<Folder[]>
  /** Return all folders whose `parentId` equals the given value. */
  getChildren(parentId: string | null): Promise<Folder[]>
  clear(): Promise<void>
}
