import type { Session } from '@shared/types'
import { exportBackupArchive, type BackupExportOptions } from './export-backup'
import { importedRows } from './import.test-support'
import { legacyBackupSource } from './legacy-source'
import { prepareMessageForBackup } from './resources'

/** Models a host supplying its row store and external legacy input parser. */
export function exportBackupArchiveWithRows(options: BackupExportOptions) {
  if (options.sessionStore || options.sharded || !options.exportItems.includes('conversations'))
    return exportBackupArchive(options)
  return exportBackupArchive({
    ...options,
    sessionStore: legacyBackupSource(importedRows(options.storage), {
      listSessionIds: async () => [
        ...new Set([
          ...((await options.listSessionIds?.()) ?? []),
          ...(await (await options.metaStorage).getAllIncludingHidden()).map((meta) => meta.id),
          ...(await options.storage.getAllKeys())
            .filter((key) => key.startsWith('session:'))
            .map((key) => key.slice(8)),
        ]),
      ],
      readValue: (id) => options.storage.getItem<Session | null>(`session:${id}`, null),
    }),
  })
}

/** Expected external JSON for backup size assertions. */
export function preparedSessionFixture(session: Session): Session {
  const prepared = structuredClone(session)
  prepared.messages = prepared.messages.map(prepareMessageForBackup)
  for (const thread of prepared.threads ?? []) thread.messages = thread.messages.map(prepareMessageForBackup)
  for (const fork of Object.values(prepared.messageForksHash ?? {}))
    for (const list of fork.lists) list.messages = list.messages.map(prepareMessageForBackup)
  return prepared
}
