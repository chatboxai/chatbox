import { describe, test } from 'vitest'
import { createSessionRepositoryContract } from '../ports/testing/session-repository-contract'
import { InMemorySessionRepository } from './InMemorySessionRepository'

describe('InMemorySessionRepository SessionRepositoryPort contract', () => {
  for (const contractCase of createSessionRepositoryContract(() => new InMemorySessionRepository())) {
    test(contractCase.name, contractCase.run)
  }
})
