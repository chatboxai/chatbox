import type { MessageRow, SessionRecordV2, ThreadRow } from '../../session/session-tree/types'
import type {
  SessionRowCommit,
  SessionRowSnapshot,
  SessionRowStorePort,
  SessionRows,
  SessionRowsDiff,
} from '../session-row-store'
import { SessionRowConflictError } from '../session-row-store'
import { contextSnapshot, expectedContextMessage } from '../../persistence/session-context-read.test-support'

export type SessionRowStoreContractFactory = () => SessionRowStorePort | Promise<SessionRowStorePort>

export interface SessionRowStoreContractCase {
  name: string
  run: () => Promise<void>
}

function threadRow(sessionId: string, threadId: string, overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    sessionId,
    threadId,
    seq: -1,
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
    seq: 0,
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
  } satisfies SessionRecordV2
  return { record, revision }
}

function rowSnapshot(rows: SessionRows, revision: number): SessionRowSnapshot {
  return { rows, ...rowCommit(rows.sessionId, revision, rows.threads.find((thread) => thread.seq === -1)?.threadId) }
}

function windowSnapshot(): SessionRowSnapshot {
  const messages = Array.from({ length: 5 }, (_, index) =>
    messageRow('session-window', 'thread-active', `m${index}`, {
      seq: index * 2,
      parentMessageId: index === 0 ? null : `m${index - 1}`,
      activeChildId: index === 4 ? null : `m${index + 1}`,
      kind: index === 2 ? 'summary' : 'message',
    })
  )
  messages.push(
    messageRow('session-window', 'thread-active', 'inactive', {
      seq: 7,
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
          seq: 0,
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
    threads: [...rows.threads].sort((left, right) => left.threadId.localeCompare(right.threadId)),
    messages: [...rows.messages].sort((left, right) => left.messageId.localeCompare(right.messageId)),
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
        const compacted = await store.readContext({ sessionId: snapshot.record.id, targetMessageId: 'target' })
        assertEqual(compacted?.mode, 'compacted', 'Valid checkpoint must bound the context read')
        assertDeepEqual(
          compacted?.messages.map((row) => row.messageId),
          ['system', 'boundary', 'summary', 'question'],
          'Context must preserve real system and boundary rows'
        )
        assertDeepEqual(
          compacted?.messages,
          snapshot.rows.messages
            .filter((row) => ['system', 'boundary', 'summary', 'question'].includes(row.messageId))
            .map(expectedContextMessage),
          'Context must expose causal identity and complete message content'
        )
        const older = await store.readContext({ sessionId: snapshot.record.id, targetMessageId: 'prefix-2' })
        assertEqual(older?.mode, 'full-path', 'A future point must not prune an older request')
        assertDeepEqual(
          older?.messages.map((row) => row.messageId),
          ['system', 'prefix-0', 'prefix-1'],
          'Older target must keep its own causal prefix'
        )
        assertDeepEqual(
          older?.messages,
          snapshot.rows.messages.slice(0, 3).map(expectedContextMessage),
          'Full-path fallback must use the same context message shape'
        )
        const append = await store.readContext({
          sessionId: snapshot.record.id,
          targetMessageId: 'target',
          includeTarget: true,
        })
        assertEqual(append?.messages.at(-1)?.messageId, 'target', 'Append must include its target')
        assertDeepEqual(
          append?.beforeTarget,
          compacted?.beforeTarget,
          'Append facts must still describe the strict target prefix'
        )
        await assertRejects(
          () => store.readContext({ sessionId: snapshot.record.id, expectedRevision: 2 }),
          'Stale context revisions must fail'
        )
      },
    },
    {
      name: 'paginates only the active parent path, including summaries, without gaps or duplicate anchors',
      run: async () => {
        const store = await prepareStore(createStore)
        const snapshot = windowSnapshot()
        await store.writeRows(snapshot)
        const tail = await store.readMessageWindow({ sessionId: 'session-window', limit: 2 })
        assertDeepEqual(
          tail?.messages.map((row) => row.messageId),
          ['m3', 'm4'],
          'tail must exclude inactive forks'
        )
        assertDeepEqual(tail?.record, snapshot.record, 'window includes committed record')
        assertDeepEqual(tail?.thread, snapshot.rows.threads[0], 'window includes selected thread')
        assertEqual(tail?.revision, 1, 'window includes committed revision')
        if (!tail?.older) throw new Error('tail must have an older cursor')
        const middle = await store.readMessageWindow({ sessionId: 'session-window', limit: 2, cursor: tail.older })
        assertDeepEqual(
          middle?.messages.map((row) => row.messageId),
          ['m1', 'm2'],
          'middle must exclude cursor anchor'
        )
        assertEqual(middle?.messages[1].kind, 'summary', 'summary remains in path')
        if (!middle?.older) throw new Error('middle must have an older cursor')
        const head = await store.readMessageWindow({ sessionId: 'session-window', limit: 2, cursor: middle.older })
        assertDeepEqual(
          head?.messages.map((row) => row.messageId),
          ['m0'],
          'short final page reaches root'
        )
        assertEqual(head?.older, null, 'root ends pagination')
        const archived = await store.readMessageWindow({
          sessionId: 'session-window',
          threadId: 'thread-archived',
          limit: 2,
        })
        assertDeepEqual(
          archived?.messages.map((row) => row.messageId),
          ['archived'],
          'archived tree stays isolated'
        )
        assertEqual(archived?.older, null, 'archived root ends pagination')
      },
    },
    {
      name: 'opens at the root and pages in both directions along the active path',
      run: async () => {
        const store = await prepareStore(createStore)
        await store.writeRows(windowSnapshot())
        const head = await store.readMessageWindow({ sessionId: 'session-window', edge: 'head', limit: 2 })
        assertDeepEqual(
          head?.messages.map((row) => row.messageId),
          ['m0', 'm1'],
          'head starts at root'
        )
        assertEqual(head?.older, null, 'head has no older messages')
        if (!head?.newer) throw new Error('head must have a newer cursor')
        const middle = await store.readMessageWindow({ sessionId: 'session-window', cursor: head.newer, limit: 2 })
        assertDeepEqual(
          middle?.messages.map((row) => row.messageId),
          ['m2', 'm3'],
          'forward excludes anchor and inactive forks'
        )
        if (!middle?.older || !middle.newer) throw new Error('middle requires both cursors')
        const previous = await store.readMessageWindow({ sessionId: 'session-window', cursor: middle.older, limit: 2 })
        assertDeepEqual(previous?.messages, head.messages, 'backward returns the same head')
        const tail = await store.readMessageWindow({ sessionId: 'session-window', cursor: middle.newer, limit: 2 })
        assertDeepEqual(
          tail?.messages.map((row) => row.messageId),
          ['m4'],
          'forward reaches leaf'
        )
        assertEqual(tail?.newer, null, 'leaf ends forward pagination')
        await store.writeRows({ ...windowSnapshot(), revision: 2 }, 1)
        await assertRejects(
          () => store.readMessageWindow({ sessionId: 'session-window', cursor: head.newer ?? undefined, limit: 2 }),
          'forward cursors are revision-bound'
        )
        await assertRejects(
          () =>
            store.readMessageWindow({
              sessionId: 'session-window',
              cursor: head.newer ?? undefined,
              edge: 'head',
              limit: 2,
            }),
          'a cursor cannot be combined with an edge'
        )
      },
    },
    {
      name: 'fences the first window of another thread to the same committed revision',
      run: async () => {
        const store = await prepareStore(createStore)
        const snapshot = windowSnapshot()
        await store.writeRows(snapshot)
        const active = await store.readMessageWindow({ sessionId: snapshot.record.id, limit: 2 })
        if (!active) throw new Error('expected active window')
        await store.writeRows({ ...snapshot, revision: 2 }, 1)
        try {
          await store.readMessageWindow({
            sessionId: snapshot.record.id,
            threadId: 'thread-archived',
            limit: 2,
            expectedRevision: active.revision,
          })
        } catch (error) {
          if (!(error instanceof SessionRowConflictError)) throw error
          assertEqual(error.expectedRevision, 1, 'cross-thread fence identifies expected revision')
          assertEqual(error.actualRevision, 2, 'cross-thread fence identifies actual revision')
          return
        }
        throw new Error('a first window cannot silently advance its search revision')
      },
    },
    {
      name: 'distinguishes a missing session, an empty thread, and an unknown thread',
      run: async () => {
        const store = await prepareStore(createStore)
        assertEqual(await store.readMessageWindow({ sessionId: 'missing', limit: 1 }), null, 'missing session')
        await store.writeRows(
          rowSnapshot({ sessionId: 'empty', threads: [threadRow('empty', 'empty')], messages: [] }, 1)
        )
        const empty = await store.readMessageWindow({ sessionId: 'empty', limit: 1 })
        assertDeepEqual(empty?.messages, [], 'empty thread has an empty page')
        assertEqual(empty?.older, null, 'empty thread has no cursor')
        await assertRejects(
          () => store.readMessageWindow({ sessionId: 'empty', threadId: 'unknown', limit: 1 }),
          'unknown thread must reject'
        )
      },
    },
    {
      name: 'rejects window cursors after checkpoint, branch mutation, deletion, and recreation',
      run: async () => {
        for (const mutation of ['checkpoint', 'commit', 'delete', 'recreate']) {
          const store = await prepareStore(createStore)
          const snapshot = windowSnapshot()
          await store.writeRows(snapshot)
          const tail = await store.readMessageWindow({ sessionId: snapshot.rows.sessionId, limit: 1 })
          if (!tail?.older) throw new Error('expected cursor')
          if (mutation === 'checkpoint')
            await store.applyDiff(
              {
                ...emptyDiff(snapshot.rows.sessionId),
                messages: { upsert: [{ ...snapshot.rows.messages[4], updatedAt: 2000 }], delete: [] },
              },
              { record: snapshot.record, revision: 2 },
              1
            )
          if (mutation === 'commit') await store.writeRows({ ...snapshot, revision: 2 }, 1)
          if (mutation === 'delete' || mutation === 'recreate') await store.deleteRows(snapshot.rows.sessionId, 1)
          if (mutation === 'recreate') await store.writeRows({ ...snapshot, revision: 3 }, 2)
          try {
            await store.readMessageWindow({ sessionId: snapshot.rows.sessionId, limit: 1, cursor: tail.older })
          } catch (error) {
            if (!(error instanceof SessionRowConflictError)) throw error
            assertEqual(error.expectedRevision, 1, 'stale cursor identifies expected revision')
            continue
          }
          throw new Error(`${mutation} must invalidate the cursor`)
        }
      },
    },
    {
      name: 'validates window limits and cursor identity before reading',
      run: async () => {
        const store = await prepareStore(createStore)
        for (const limit of [0, -1, 201, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
          await assertRejects(
            () => store.readMessageWindow({ sessionId: 'missing', limit }),
            'invalid limit must reject'
          )
        }
        await store.writeRows(windowSnapshot())
        const tail = await store.readMessageWindow({ sessionId: 'session-window', limit: 1 })
        if (!tail?.older) throw new Error('expected cursor')
        const cursor = tail.older
        await assertRejects(
          () => store.readMessageWindow({ sessionId: 'other', limit: 1, cursor }),
          'cross-session cursor must reject'
        )
        await assertRejects(
          () => store.readMessageWindow({ sessionId: 'session-window', threadId: 'thread-archived', limit: 1, cursor }),
          'cross-thread cursor must reject'
        )
      },
    },
    {
      name: 'rejects broken, cross-thread, cyclic, and inconsistent parent paths',
      run: async () => {
        const overrides: Partial<MessageRow>[] = [
          { parentMessageId: 'missing' },
          { parentMessageId: 'archived' },
          { parentMessageId: 'm4' },
          { seq: 0 },
        ]
        for (const override of overrides) {
          const store = await prepareStore(createStore)
          const snapshot = windowSnapshot()
          snapshot.rows.messages[4] = { ...snapshot.rows.messages[4], ...override }
          await store.writeRows(snapshot)
          await assertRejects(
            () => store.readMessageWindow({ sessionId: 'session-window', limit: 10 }),
            'corrupt path must reject'
          )
        }
        const store = await prepareStore(createStore)
        const snapshot = windowSnapshot()
        snapshot.rows.messages[3].activeChildId = 'inactive'
        await store.writeRows(snapshot)
        const tail = await store.readMessageWindow({ sessionId: 'session-window', limit: 1 })
        if (!tail?.older) throw new Error('expected cursor')
        await assertRejects(
          () => store.readMessageWindow({ sessionId: 'session-window', limit: 1, cursor: tail.older ?? undefined }),
          'page boundary must validate parent-child consistency'
        )
      },
    },
    {
      name: 'returns detached window values that cannot mutate persisted data',
      run: async () => {
        const store = await prepareStore(createStore)
        await store.writeRows(windowSnapshot())
        const window = await store.readMessageWindow({ sessionId: 'session-window', limit: 1 })
        if (!window) throw new Error('expected window')
        window.record.name = 'changed'
        window.thread.name = 'changed'
        window.messages[0].message.contentParts.push({ type: 'text', text: 'changed' })
        const next = await store.readMessageWindow({ sessionId: 'session-window', limit: 1 })
        assertEqual(next?.record.name, 'session-window', 'record remains unchanged')
        assertEqual(next?.thread.name, 'thread-active', 'thread remains unchanged')
        assertDeepEqual(next?.messages[0].message.contentParts, [], 'payload remains unchanged')
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
            threadRow('session-1', 'thread-old', { seq: 0, createdAt: 500 }),
          ],
          messages: [
            messageRow('session-1', 'thread-active', 'm1', { activeChildId: 'm2' }),
            messageRow('session-1', 'thread-active', 'm2', { parentMessageId: 'm1', seq: 1 }),
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
              threads: [threadRow('session-1', 'thread-active'), threadRow('session-1', 'thread-old', { seq: 0 })],
              messages: [
                messageRow('session-1', 'thread-active', 'm1'),
                messageRow('session-1', 'thread-old', 'm2', { seq: 1 }),
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
                messageRow('session-1', 'thread-active', 'm2', { parentMessageId: 'm1', seq: 1 }),
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

        const renamedThread = threadRow('session-1', 'thread-active', { name: 'Renamed' })
        const updatedRoot = messageRow('session-1', 'thread-active', 'm1', { activeChildId: 'm3' })
        const insertedRow = messageRow('session-1', 'thread-active', 'm3', { parentMessageId: 'm1', seq: 2 })
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
                threads: { upsert: [threadRow('session-1', 'thread-added', { seq: 0 })], delete: [] },
                messages: {
                  upsert: [
                    messageRow('session-1', 'thread-active', 'm2', { seq: 1 }),
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

        const inserted = messageRow('session-1', 'thread-active', 'm2', { parentMessageId: 'm1', seq: 1 })
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
                messageRow('session-1', 'thread-active', 'm2', { seq: 1, status: 'generating' }),
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

        await store.applyDiff(
          {
            sessionId: 'session-1',
            threads: { upsert: [], delete: ['thread-active'] },
            messages: { upsert: [], delete: ['m1'] },
          },
          rowCommit('session-1', 2),
          1
        )

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
