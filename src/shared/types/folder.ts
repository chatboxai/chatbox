import { z } from 'zod'

/**
 * A folder is a classification container that groups chat sessions (and other
 * folders) into a hierarchical tree. It is NOT a chat session and holds no
 * message data — only structural metadata.
 *
 * Storage strategy: Option B (separate table/store). Folders live in their own
 * repository (`FolderRepositoryPort`) alongside `SessionMetaStorage`, and the
 * sidebar joins both datasets in memory.
 */
export const FolderSchema = z.object({
  id: z.string(),
  /** Discriminator that distinguishes folder rows from session rows in union types. */
  type: z.literal('folder'),
  name: z.string(),
  /**
   * Parent folder id. `null` (or `undefined`) means the folder is a top-level
   * (root) item in the sidebar tree.
   */
  parentId: z.string().nullable(),
  /**
   * Sort key within the parent group. Higher values render first (descending),
   * matching the `sortOrder` convention used by `SessionMetaRecord`.
   */
  sortOrder: z.number(),
  createdAt: z.number(),
})

export const FolderArraySchema = z.array(FolderSchema)

export type Folder = z.infer<typeof FolderSchema>
