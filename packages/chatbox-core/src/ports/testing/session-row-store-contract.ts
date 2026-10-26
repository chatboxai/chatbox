import { projectRowFixture } from './session-row-fixtures'
import { readRowContextSource } from '../../application/session/row-context'
import { createSessionTranscriptContract } from './session-transcript-contract'
import type { MessageRow, SessionRecordV2, ThreadRow } from '../../session/session-tree/types'
import type {
  SessionRowCommit,
  SessionRowSnapshot,
  SessionRowStorePort,
  SessionRows,
  SessionRowsDiff,
} from '../session-row-store'
import { SessionRowConflictError } from '../session-row-store'
import { contextSnapshot } from '../../persistence/session-context-read.test-support'

export type SessionRowStoreContractFactory = () => SessionRowStorePort | Promise<SessionRowStorePort>

export interface SessionRowStoreContractCase {
  name: string
  run: () => Promise<void>
}

function threadRow(sessionId: string, threadId: string, overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    sessionId,
    threadId,
    threadOrder: -1,
    name: threadId,
    createdAt: 1_000,
    rootMessageId: null,
    activeLeafMessageId: null,
    compactionPoints: [],
    ...overrides,
  }
}

function messageRow(
  sessionId: string,
  threadId: string,
  messageId: string,
  overrides: Partial<MessageRow> = {}
): MessageRow {
  return {
    sessionId,
    threadId,
    messageId,
    parentMessageId: null,
    activeChildId: null,
    siblingOrder: 0,
    kind: 'message',
    status: 'settled',
    createdAt: 1_000,
    updatedAt: 1_000,
    branchId: null,
    message: { id: messageId, role: 'user', contentParts: [] },
    ...overrides,
  }
}

function emptyDiff(sessionId: string): SessionRowsDiff {
  return {
    sessionId,
    threads: { upsert: [], delete: [] },
    messages: { upsert: [], delete: [] },
  }
}

function rowCommit(sessionId: string, revision: number, activeThreadId = 'thread-active'): SessionRowCommit {
  const record = {
    id: sessionId,
    type: 'chat',
    name: sessionId,
    activeThreadId,
    storageFormat: 'rows',
    rowFormatVersion: 3,
    rowAuthority: 1,
  } satisfies SessionRecordV2
  return { record, revision }
}

function rowSnapshot(rows: SessionRows, revision: number): SessionRowSnapshot {
  return projectRowFixture({
    rows,
    ...rowCommit(rows.sessionId, revision, rows.threads.find((thread) => thread.threadOrder === -1)?.threadId),
  })
}

function windowSnapshot(): SessionRowSnapshot {
  const messages = Array.from({ length: 5 }, (_, index) =>
    messageRow('session-window', 'thread-active', `m${index}`, {
      siblingOrder: index * 2,
      parentMessageId: index === 0 ? null : `m${index - 1}`,
      activeChildId: index === 4 ? null : `m${index + 1}`,
      kind: index === 2 ? 'summary' : 'message',
    })
  )
  messages.push(
    messageRow('session-window', 'thread-active', 'inactive', {
      siblingOrder: 7,
      parentMessageId: 'm1',
      branchId: 'fork-inactive',
    })
  )
  messages.push(messageRow('session-window', 'thread-archived', 'archived'))
  return rowSnapshot(
    {
      sessionId: 'session-window',
      threads: [
        threadRow('session-window', 'thread-active', { rootMessageId: 'm0', activeLeafMessageId: 'm4' }),
        threadRow('session-window', 'thread-archived', {
          threadOrder: 0,
          rootMessageId: 'archived',
          activeLeafMessageId: 'archived',
        }),
      ],
      messages,
    },
    1
  )
}

async function readRows(store: SessionRowStorePort, sessionId: string): Promise<SessionRows | null> {
  return (await store.readSnapshot(sessionId))?.rows ?? null
}

function sortRows(rows: SessionRows | null): SessionRows | null {
  if (!rows) return null
  return {
    sessionId: rows.sessionId,
    threads: rows.threads
      .map(({ summary: _summary, control: _control, ...thread }) => thread)
      .sort((left, right) => left.threadId.localeCompare(right.threadId)),
    messages: rows.messages
      .map(({ selected: _selected, facts: _facts, ...row }) => row)
      .sort((left, right) => left.messageId.localeCompare(right.messageId)),
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

async function assertRejects(operation: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await operation()
  } catch {
    return
  }
  throw new Error(message)
}

async function prepareStore(createStore: SessionRowStoreContractFactory): Promise<SessionRowStorePort> {
  const store = await createStore()
  await store.initialize()
  for (const sessionId of await store.listSessionIds()) {
    await store.deleteRows(sessionId)
  }
  return store
}

/**
 * Creates framework-independent behavioral cases required from every
 * `SessionRowStorePort` implementation. Vitest, Jest, and native smoke hosts
 * can register or execute the same cases without importing one another.
 */
export function createSessionRowStoreContract(
  createStore: SessionRowStoreContractFactory
): SessionRowStoreContractCase[] {
  return [
    ...createSessionTranscriptContract(createStore),
    {
      name: 'reads selected ids in request order from one revision and skips missing ids',
      run: async () => {
        const store = await prepareStore(createStore)
        const snapshot = windowSnapshot()
        await store.writeRows(snapshot)
        const requested = [snapshot.rows.messages.at(-1)!.messageId, 'missing', 'm1', 'm1']
        const selected = await store.readMessages({
          sessionId: snapshot.record.id,
          messageIds: requested,
          expectedRevision: snapshot.revision,
        })
        assertEqual(selected?.revision, snapshot.revision, 'Selected rows must carry their committed revision')
        assertDeepEqual(
          selected?.messages.map((row) => row.messageId),
          [requested[0], 'm1'],
          'Read ids must be unique and ordered'
        )
        await assertRejects(
          () =>
            store.readMessages({
              sessionId: snapshot.record.id,
              messageIds: requested,
              expectedRevision: snapshot.revision + 1,
            }),
          'Stale selection revisions must fail'
        )
        assertDeepEqual(
          (await store.readMessages({ sessionId: snapshot.record.id, messageIds: [] }))?.messages,
          [],
          'Empty selection must not load bodies'
        )
      },
    },
    {
      name: 'hydrates context from the effective checkpoint and returns full-path fallback for older targets',
      run: async () => {
        const store = await prepareStore(createStore)
        const snapshot = contextSnapshot()
        await store.writeRows(snapshot)
        const compacted = await readRowContextSource(store, {
          sessionId: snapshot.record.id,
          targetMessageId: 'target',
        })
        assertEqual(compacted?.mode, 'compacted', 'Valid checkpoint must bound the context read')
        assertDeepEqual(
          compacted?.candidateMessages.map((message) => message.id),
          ['system', 'boundary', 'summary', 'question'],
          'Context must preserve real system and boundary rows'
        )
        assertDeepEqual(
          compacted?.candidateMessages,
          snapshot.rows.messages
            .filter((row) => ['system', 'boundary', 'summary', 'question'].includes(row.messageId))
            .map((row) => row.message),
          'Context must expose causal identity and complete message content'
        )
        const older = await readRowContextSource(store, { sessionId: snapshot.record.id, targetMessageId: 'prefix-2' })
        assertEqual(older?.mode, 'full-path', 'A future point must not prune an older request')
        assertDeepEqual(
          older?.candidateMessages.map((message) => message.id),
          ['system', 'prefix-0', 'prefix-1'],
          'Older target must keep its own causal prefix'
        )
        assertDeepEqual(
          older?.candidateMessages,
          snapshot.rows.messages.slice(0, 3).map((row) => row.message),
          'Full-path fallback must use the same context message shape'
        )
        const append = await readRowContextSource(store, {
          sessionId: snapshot.record.id,
          targetMessageId: 'target',
        })
        assertEqual(append?.targetMessage?.id, 'target', 'Context must return its target separately')
        assertDeepEqual(
          append?.beforeTarget,
          compacted?.beforeTarget,
          'Append facts must still describe the strict target prefix'
        )
        await assertRejects(
          () => readRowContextSource(store, { sessionId: snapshot.record.id, expectedRevision: 2 }),
          'Stale context revisions must fail'
        )
      },
    },
    {
      name: 'rejects corrupt transcript ancestry and returns detached payload values',
      run: async () => {
        for (const parentMessageId of ['missing', 'archived', 'm4']) {
          const store = await prepareStore(createStore)
          const snapshot = windowSnapshot()
          snapshot.rows.messages[4].parentMessageId = parentMessageId
          await assertRejects(async () => {
            await store.writeRows(snapshot)
            await store.readTranscriptWindow({ sessionId: 'session-window', limit: 10 })
          }, 'Corrupt transcript ancestry must reject')
        }
        const store = await prepareStore(createStore)
        await store.writeRows(windowSnapshot())
        const page = await store.readTranscriptWindow({ sessionId: 'session-window', limit: 1 })
        if (!page) throw new Error('Expected transcript')
        page.record.name = 'changed'
        page.threads[0].name = 'changed'
        page.messages[0].message.contentParts.push({ type: 'text', text: 'changed' })
        const next = await store.readTranscriptWindow({ sessionId: 'session-window', limit: 1 })
        assertEqual(next?.record.name, 'session-window', 'Record must remain unchanged')
        assertDeepEqual(next?.messages[0].message.contentParts, [], 'Payload must remain unchanged')
      },
    },
    {
      name: 'reports an empty store for sessions that hold no rows',
      run: async () => {
        const store = await prepareStore(createStore)

        assertEqual(await readRows(store, 'missing'), null, 'Sessions without rows must read back as null')
        assertEqual(await store.hasRows('missing'), false, 'Sessions without rows must not report rows')
        assertDeepEqual(await store.listSessionIds(), [], 'An empty store must list no session ids')
      },
    },
    {
      name: 'writes and reads back every row of a session',
      run: async () => {
        const store = await prepareStore(createStore)
        const rows: SessionRows = {
          sessionId: 'session-1',
          threads: [
            threadRow('session-1', 'thread-active', { rootMessageId: 'm1', activeLeafMessageId: 'm2' }),
            threadRow('session-1', 'thread-old', { threadOrder: 0, createdAt: 500 }),
          ],
          messages: [
            messageRow('session-1', 'thread-active', 'm1', { activeChildId: 'm2' }),
            messageRow('session-1', 'thread-active', 'm2', { parentMessageId: 'm1', siblingOrder: 1 }),
          ],
        }

        await store.writeRows(rowSnapshot(rows, 1))

        assertDeepEqual(sortRows(await readRows(store, 'session-1')), sortRows(rows), 'Stored rows must round-trip')
        assertEqual(await store.hasRows('session-1'), true, 'A session with rows must report rows')
        assertDeepEqual(await store.listSessionIds(), ['session-1'], 'Session id listing must contain the session')
      },
    },
    {
      name: 'replaces every existing row on a full write',
      run: async () => {
        const store = await prepareStore(createStore)
        await store.writeRows(
          rowSnapshot(
            {
              sessionId: 'session-1',
              threads: [
                threadRow('session-1', 'thread-active'),
                threadRow('session-1', 'thread-old', { threadOrder: 0 }),
              ],
              messages: [
                messageRow('session-1', 'thread-active', 'm1'),
                messageRow('session-1', 'thread-old', 'm2', { siblingOrder: 1 }),
              ],
            },
            1
          )
        )

        const replacement: SessionRows = {
          sessionId: 'session-1',
          threads: [threadRow('session-1', 'thread-active', { name: 'Renamed' })],
          messages: [messageRow('session-1', 'thread-active', 'm1')],
        }
        await store.writeRows(rowSnapshot(replacement, 2))

        assertDeepEqual(
          sortRows(await readRows(store, 'session-1')),
          sortRows(replacement),
          'A full write must delete the rows it does not carry'
        )
      },
    },
    {
      name: 'guards a full replacement with the expected revision',
      run: async () => {
        const store = await prepareStore(createStore)
        const initial: SessionRows = {
          sessionId: 'session-1',
          threads: [threadRow('session-1', 'thread-active', { name: 'Initial' })],
          messages: [],
        }
        const replacement: SessionRows = {
          sessionId: 'session-1',
          threads: [threadRow('session-1', 'thread-active', { name: 'Replacement' })],
          messages: [],
        }
        await store.writeRows(rowSnapshot(initial, 1), null)

        await assertRejects(
          () => store.writeRows(rowSnapshot(replacement, 2), null),
          'writeRows must reject an expected-absence replacement when rows already exist'
        )
        await assertRejects(
          () => store.writeRows(rowSnapshot(replacement, 2), 2),
          'writeRows must reject when the committed revision does not match'
        )
        assertEqual(await store.getRevision('session-1'), 1, 'Rejected replacements must preserve the old revision')

        await store.writeRows(rowSnapshot(replacement, 2), 1)
        assertEqual(await store.getRevision('session-1'), 2, 'A matching replacement must publish the new revision')
      },
    },
    {
      name: 'applies upserts and deletes from a diff and publishes metadata-only commits',
      run: async () => {
        const store = await prepareStore(createStore)
        await store.writeRows(
          rowSnapshot(
            {
              sessionId: 'session-1',
              threads: [threadRow('session-1', 'thread-active')],
              messages: [
                messageRow('session-1', 'thread-active', 'm1', { activeChildId: 'm2' }),
                messageRow('session-1', 'thread-active', 'm2', { parentMessageId: 'm1', siblingOrder: 1 }),
              ],
            },
            1
          )
        )

        await store.applyDiff(emptyDiff('session-1'), rowCommit('session-1', 2), 1)
        assertDeepEqual(
          sortRows(await readRows(store, 'session-1'))?.messages.map((row) => row.messageId),
          ['m1', 'm2'],
          'An empty diff must not change the stored rows'
        )

        const renamedThread = threadRow('session-1', 'thread-active', {
          name: 'Renamed',
          rootMessageId: 'm1',
          activeLeafMessageId: 'm3',
        })
        const updatedRoot = messageRow('session-1', 'thread-active', 'm1', { activeChildId: 'm3' })
        const insertedRow = messageRow('session-1', 'thread-active', 'm3', { parentMessageId: 'm1', siblingOrder: 2 })
        await store.applyDiff(
          {
            sessionId: 'session-1',
            threads: { upsert: [renamedThread], delete: [] },
            messages: { upsert: [updatedRoot, insertedRow], delete: ['m2'] },
          },
          rowCommit('session-1', 3),
          2
        )

        assertDeepEqual(
          sortRows(await readRows(store, 'session-1')),
          sortRows({
            sessionId: 'session-1',
            threads: [renamedThread],
            messages: [updatedRoot, insertedRow],
          }),
          'A diff must upsert its rows and delete the ids it names'
        )
      },
    },
    {
      name: 'leaves the stored rows untouched when a diff carries an invalid row',
      run: async () => {
        const store = await prepareStore(createStore)
        const rows: SessionRows = {
          sessionId: 'session-1',
          threads: [threadRow('session-1', 'thread-active')],
          messages: [messageRow('session-1', 'thread-active', 'm1')],
        }
        await store.writeRows(rowSnapshot(rows, 1))

        await assertRejects(
          () =>
            store.applyDiff(
              {
                sessionId: 'session-1',
                threads: { upsert: [threadRow('session-1', 'thread-added', { threadOrder: 0 })], delete: [] },
                messages: {
                  upsert: [
                    messageRow('session-1', 'thread-active', 'm2', { siblingOrder: 1 }),
                    messageRow('session-1', 'thread-active', ''),
                  ],
                  delete: ['m1'],
                },
              },
              rowCommit('session-1', 2),
              1
            ),
          'A diff carrying a row without a messageId must be rejected'
        )

        assertDeepEqual(
          sortRows(await readRows(store, 'session-1')),
          sortRows(rows),
          'A rejected diff must not apply any of its parts'
        )
      },
    },
    {
      name: 'inserts and updates a single message without touching the other rows',
      run: async () => {
        const store = await prepareStore(createStore)
        const thread = threadRow('session-1', 'thread-active')
        const first = messageRow('session-1', 'thread-active', 'm1')
        await store.writeRows(rowSnapshot({ sessionId: 'session-1', threads: [thread], messages: [first] }, 1))

        const inserted = messageRow('session-1', 'thread-active', 'm2', { parentMessageId: 'm1', siblingOrder: 1 })
        await store.applyDiff(
          { ...emptyDiff('session-1'), messages: { upsert: [inserted], delete: [] } },
          rowCommit('session-1', 2),
          1
        )
        const updated = { ...inserted, status: 'generating' as const, updatedAt: 2_000 }
        await store.applyDiff(
          { ...emptyDiff('session-1'), messages: { upsert: [updated], delete: [] } },
          rowCommit('session-1', 3),
          2
        )

        assertDeepEqual(
          sortRows(await readRows(store, 'session-1')),
          sortRows({ sessionId: 'session-1', threads: [thread], messages: [first, updated] }),
          'single-message commits must insert then update only their own row'
        )
      },
    },
    {
      name: 'removes every row of a session on delete',
      run: async () => {
        const store = await prepareStore(createStore)
        await store.writeRows(
          rowSnapshot(
            {
              sessionId: 'session-1',
              threads: [threadRow('session-1', 'thread-active')],
              messages: [messageRow('session-1', 'thread-active', 'm1')],
            },
            1
          )
        )

        await store.deleteRows('session-1')

        assertEqual(await readRows(store, 'session-1'), null, 'A deleted session must read back as null')
        assertEqual(await store.hasRows('session-1'), false, 'A deleted session must not report rows')
        assertDeepEqual(await store.listSessionIds(), [], 'A deleted session must leave the id listing')
        await store.deleteRows('missing')
      },
    },
    {
      name: 'rejects a conditional delete after another commit advances the revision',
      run: async () => {
        const store = await prepareStore(createStore)
        await store.writeRows(
          rowSnapshot(
            {
              sessionId: 'session-1',
              threads: [threadRow('session-1', 'thread-active')],
              messages: [],
            },
            1
          )
        )
        await store.applyDiff(
          {
            sessionId: 'session-1',
            threads: {
              upsert: [threadRow('session-1', 'thread-active', { name: 'Current' })],
              delete: [],
            },
            messages: { upsert: [], delete: [] },
          },
          rowCommit('session-1', 2),
          1
        )

        await assertRejects(
          () => store.deleteRows('session-1', 1),
          'deleteRows must reject when the committed revision no longer matches'
        )
        assertEqual(await store.getRevision('session-1'), 2, 'A rejected delete must preserve the newer revision')
        assertEqual(await store.hasRows('session-1'), true, 'A rejected delete must preserve the newer rows')

        await store.deleteRows('session-1', 2)
        assertEqual(await readRows(store, 'session-1'), null, 'A matching conditional delete must remove the rows')
        assertEqual(await store.getRevision('session-1'), 3, 'A delete must advance the durable CAS generation')
      },
    },
    {
      name: 'finds message references by status across sessions',
      run: async () => {
        const store = await prepareStore(createStore)
        await store.writeRows(
          rowSnapshot(
            {
              sessionId: 'session-1',
              threads: [threadRow('session-1', 'thread-active')],
              messages: [
                messageRow('session-1', 'thread-active', 'm1'),
                messageRow('session-1', 'thread-active', 'm2', { siblingOrder: 1, status: 'generating' }),
              ],
            },
            1
          )
        )
        await store.writeRows(
          rowSnapshot(
            {
              sessionId: 'session-2',
              threads: [threadRow('session-2', 'thread-active')],
              messages: [messageRow('session-2', 'thread-active', 'm3', { status: 'generating' })],
            },
            1
          )
        )

        const found = await store.findMessagesByStatus('generating')
        assertDeepEqual(
          [...found].sort((left, right) => left.messageId.localeCompare(right.messageId)),
          [
            { sessionId: 'session-1', threadId: 'thread-active', messageId: 'm2' },
            { sessionId: 'session-2', threadId: 'thread-active', messageId: 'm3' },
          ],
          'Status scans must return every matching row across sessions'
        )
      },
    },
    {
      name: 'keeps the rows of different sessions isolated',
      run: async () => {
        const store = await prepareStore(createStore)
        const first: SessionRows = {
          sessionId: 'session-1',
          threads: [threadRow('session-1', 'thread-active')],
          messages: [messageRow('session-1', 'thread-active', 'm1')],
        }
        const second: SessionRows = {
          sessionId: 'session-2',
          threads: [threadRow('session-2', 'thread-active')],
          messages: [messageRow('session-2', 'thread-active', 'm2')],
        }
        await store.writeRows(rowSnapshot(first, 1))
        await store.writeRows(rowSnapshot(second, 1))

        await store.deleteRows('session-1', 1)

        assertEqual(await readRows(store, 'session-1'), null, 'Clearing one session must empty only that session')
        assertDeepEqual(sortRows(await readRows(store, 'session-2')), sortRows(second), 'Other sessions must be intact')

        await store.deleteRows('session-2')
        assertDeepEqual(await store.listSessionIds(), [], 'Deleting the last session must empty the id listing')
      },
    },
    {
      name: 'accepts repeated initialization',
      run: async () => {
        const store = await prepareStore(createStore)
        await store.initialize()
        await store.initialize()

        const rows: SessionRows = {
          sessionId: 'session-1',
          threads: [threadRow('session-1', 'thread-active')],
          messages: [messageRow('session-1', 'thread-active', 'm1')],
        }
        await store.writeRows(rowSnapshot(rows, 1))
        await store.initialize()

        assertDeepEqual(
          sortRows(await readRows(store, 'session-1')),
          sortRows(rows),
          'Repeated initialization must preserve stored rows'
        )
      },
    },
  ]
}

/** Runs every shared contract case sequentially in headless smoke hosts. */
export async function runSessionRowStoreContract(createStore: SessionRowStoreContractFactory): Promise<void> {
  for (const contractCase of createSessionRowStoreContract(createStore)) {
    try {
      await contractCase.run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`SessionRowStorePort contract failed: ${contractCase.name}\n${message}`)
    }
  }
}
