import { describe, it } from 'vitest'
import { createSessionRowStoreContract } from '../ports/testing/session-row-store-contract'
import { InMemorySessionRowStore } from './InMemorySessionRowStore'

describe('InMemorySessionRowStore shared contract', () => {
  for (const contractCase of createSessionRowStoreContract(() => new InMemorySessionRowStore())) {
    it(contractCase.name, contractCase.run)
  }
})
