import type { SessionFolder } from '@shared/types'

function folderEntries(value: unknown): SessionFolder[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is SessionFolder =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as SessionFolder).id === 'string' &&
      typeof (entry as SessionFolder).name === 'string'
  )
}

/**
 * Folder list after restoring `imported` over `local`: local folders keep their
 * order and names, and imported folders with new ids follow them. Restored
 * sessions keep their `folderId`, so both local and imported sessions stay filed.
 * Entries are kept whole, including fields this version does not know.
 */
export function mergeRestoredSessionFolders(local: unknown, imported: unknown): SessionFolder[] {
  const merged = folderEntries(local)
  const ids = new Set(merged.map((folder) => folder.id))
  for (const folder of folderEntries(imported)) {
    if (ids.has(folder.id)) continue
    ids.add(folder.id)
    merged.push(folder)
  }
  return merged
}
