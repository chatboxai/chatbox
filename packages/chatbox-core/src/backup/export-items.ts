import type { BackupExportItem } from './types'

const BACKUP_EXPORT_ITEM_ORDER = ['setting', 'key', 'conversations', 'copilot'] as const

export function normalizeBackupExportItems(items: readonly BackupExportItem[]): BackupExportItem[] {
  const selected = new Set(items)
  if (selected.has('key')) selected.add('setting')
  return BACKUP_EXPORT_ITEM_ORDER.filter((item) => selected.has(item))
}

export function updateBackupExportItemSelection(
  items: readonly BackupExportItem[],
  item: BackupExportItem,
  selected: boolean
): BackupExportItem[] {
  const next = new Set(items)
  if (selected) next.add(item)
  else next.delete(item)
  if (!selected && item === 'setting') next.delete('key')
  return normalizeBackupExportItems(Array.from(next))
}
