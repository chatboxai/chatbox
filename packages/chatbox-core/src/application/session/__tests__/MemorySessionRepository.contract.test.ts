import { describe, test } from 'vitest'
import { createSessionRepositoryContract } from '../../../ports/testing/session-repository-contract'
import { MemorySessionRepository } from './memory-session-repository'

describe('MemorySessionRepository SessionRepositoryPort contract', () => {
  for (const contractCase of createSessionRepositoryContract(() => new MemorySessionRepository())) {
    test(contractCase.name, contractCase.run)
  }
})
