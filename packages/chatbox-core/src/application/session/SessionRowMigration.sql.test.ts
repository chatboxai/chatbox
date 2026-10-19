import { it } from 'vitest'
import { openNodeSessionRowDatabase } from '../../persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../../persistence/session-row-sql'
import {
  verifyPublishedFormatUpgrade,
  verifyCandidateFormatUpgrade,
} from '../../ports/testing/session-row-migration-contract'
it('upgrades published SQL format2 rows and keeps format3 opens bounded', async () => {
  const database = openNodeSessionRowDatabase()
  try {
    await verifyPublishedFormatUpgrade(() => new SqlSessionRowStore(database))
    await verifyCandidateFormatUpgrade(new SqlSessionRowStore(database))
  } finally {
    database.close()
  }
})
