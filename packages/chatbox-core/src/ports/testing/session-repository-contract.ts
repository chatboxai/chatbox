import type { Session, SessionMetaRecord } from '../../types'
import type { SessionRepositoryPort } from '../session-repository'

export type SessionRepositoryContractFactory = () => SessionRepositoryPort | Promise<SessionRepositoryPort>

export interface SessionRepositoryContractCase {
  name: string
  run: () => Promise<void>
}

function createSession(id: string): Session {
  return {
    id,
    name: id,
    type: 'chat',
    messages: [],
    settings: { temperature: undefined },
    threads: undefined,
    messageForksHash: {},
  }
}

function createRecord(id: string, sortOrder: number, overrides: Partial<SessionMetaRecord> = {}): SessionMetaRecord {
  return {
    id,
    name: id,
    type: 'chat',
    sortOrder,
    createdAt: sortOrder,
    ...overrides,
  }
}

function stableSerialize(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      )
    }) ?? String(value)
  )
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualValue = stableSerialize(actual)
  const expectedValue = stableSerialize(expected)
  if (actualValue !== expectedValue) {
    throw new Error(`${message}\nExpected: ${expectedValue}\nReceived: ${actualValue}`)
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nReceived: ${String(actual)}`)
  }
}

async function prepareRepository(createRepository: SessionRepositoryContractFactory): Promise<SessionRepositoryPort> {
  const repository = await createRepository()
  await repository.initialize()
  await repository.meta.clear()
  return repository
}

/**
 * Creates framework-independent behavioral cases required from every
 * `SessionRepositoryPort` implementation. Vitest, Jest, and native smoke hosts
 * can register or execute the same cases without importing one another.
 */
export function createSessionRepositoryContract(
  createRepository: SessionRepositoryContractFactory
): SessionRepositoryContractCase[] {
  return [
    {
      name: 'stores, reads, lists, and deletes full sessions with null for missing data',
      run: async () => {
        const repository = await prepareRepository(createRepository)
        const first = createSession('session-1')
        const second = createSession('session-2')

        assertEqual(await repository.getSession('missing'), null, 'Missing sessions must resolve to null')
        await repository.setSession(first)
        await repository.setSession(second)

        assertDeepEqual(await repository.getSession(first.id), first, 'Stored sessions must round-trip')
        assertDeepEqual(
          (await repository.getAllSessionIds()).sort(),
          [first.id, second.id],
          'Session id listing must contain every stored session'
        )

        await repository.deleteSession(first.id)
        assertEqual(await repository.getSession(first.id), null, 'Deleted sessions must resolve to null')
        await repository.deleteSession('missing')
      },
    },
    {
      name: 'supports meta create, update, batch delete, and clear semantics',
      run: async () => {
        const repository = await prepareRepository(createRepository)
        const first = createRecord('first', 100)
        const second = createRecord('second', 200)
        const third = createRecord('third', 300)

        assertEqual(await repository.meta.getById('missing'), null, 'Missing meta must resolve to null')
        await repository.meta.create(first)
        assertDeepEqual(await repository.meta.getById(first.id), first, 'Created meta must be readable')

        assertDeepEqual(
          await repository.meta.update(first.id, { name: 'Updated' }),
          { ...first, name: 'Updated' },
          'Meta updates must return the updated record'
        )
        assertEqual(
          await repository.meta.update('missing', { name: 'Missing' }),
          null,
          'Updating missing meta must resolve to null'
        )

        await repository.meta.createMany([second, third])
        await repository.meta.deleteMany([first.id, second.id])
        assertEqual(await repository.meta.getById(first.id), null, 'Batch delete must remove the first record')
        assertEqual(await repository.meta.getById(second.id), null, 'Batch delete must remove the second record')
        assertDeepEqual(await repository.meta.getById(third.id), third, 'Batch delete must preserve other records')

        await repository.meta.clear()
        assertDeepEqual(await repository.meta.getAllIncludingHidden(), [], 'Clear must remove every meta record')
      },
    },
    {
      name: 'keeps visible, hidden, starred, and archived ordering and counts consistent',
      run: async () => {
        const repository = await prepareRepository(createRepository)
        await repository.meta.createMany([
          createRecord('regular-new', 300),
          createRecord('pinned', 100, { starred: true }),
          createRecord('regular-old', 200),
          createRecord('hidden-system', 400, { hidden: true }),
          createRecord('archived-old', 500, { hidden: true, archivedAt: 1_000 }),
          createRecord('archived-new', 50, { hidden: true, archivedAt: 2_000 }),
        ])

        assertDeepEqual(
          (await repository.meta.getAll()).map(({ id }) => id),
          ['pinned', 'regular-new', 'regular-old'],
          'Visible meta must be pinned first and then sorted by sortOrder descending'
        )
        assertDeepEqual(
          (await repository.meta.getAllIncludingHidden()).map(({ id }) => id),
          ['archived-old', 'hidden-system', 'regular-new', 'regular-old', 'pinned', 'archived-new'],
          'All meta must include hidden records sorted by sortOrder descending'
        )
        assertDeepEqual(
          (await repository.meta.getArchived()).map(({ id }) => id),
          ['archived-new', 'archived-old'],
          'Archived meta must be sorted by archivedAt descending'
        )
        assertEqual(await repository.meta.getTotal(), 3, 'Visible count must exclude hidden records')
        assertEqual(await repository.meta.getAllTotal(), 6, 'All count must include hidden records')
        assertEqual(await repository.meta.getArchivedTotal(), 2, 'Archived count must only include archived records')
      },
    },
    {
      name: 'returns stable cursor pages for visible and archived records',
      run: async () => {
        const repository = await prepareRepository(createRepository)
        const regularNew = createRecord('regular-new', 300)
        const pinned = createRecord('pinned', 100, { starred: true })
        const regularOld = createRecord('regular-old', 200)
        const archivedOld = createRecord('archived-old', 500, { hidden: true, archivedAt: 1_000 })
        const archivedNew = createRecord('archived-new', 50, { hidden: true, archivedAt: 2_000 })
        await repository.meta.createMany([
          regularNew,
          pinned,
          regularOld,
          createRecord('hidden', 400, { hidden: true }),
          archivedOld,
          archivedNew,
        ])

        assertDeepEqual(
          await repository.meta.getPage(0, 2),
          { items: [pinned, regularNew], nextCursor: 2, total: 3 },
          'Visible first page must preserve ordering and expose the next cursor'
        )
        assertDeepEqual(
          await repository.meta.getPage(2, 2),
          { items: [regularOld], nextCursor: null, total: 3 },
          'Visible last page must terminate pagination'
        )
        assertDeepEqual(
          await repository.meta.getArchivedPage(0, 1),
          { items: [archivedNew], nextCursor: 1, total: 2 },
          'Archived first page must preserve archivedAt ordering'
        )
        assertDeepEqual(
          await repository.meta.getArchivedPage(1, 1),
          { items: [archivedOld], nextCursor: null, total: 2 },
          'Archived last page must terminate pagination'
        )
      },
    },
  ]
}

/** Runs every shared contract case sequentially in headless smoke hosts. */
export async function runSessionRepositoryContract(createRepository: SessionRepositoryContractFactory): Promise<void> {
  for (const contractCase of createSessionRepositoryContract(createRepository)) {
    try {
      await contractCase.run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`SessionRepositoryPort contract failed: ${contractCase.name}\n${message}`)
    }
  }
}
