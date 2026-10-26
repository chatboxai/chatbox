import type {
  BackupBusinessRecord,
  BackupMessage,
  BackupSession,
  BackupThread,
  BackupWorkspace,
} from '../backup-v3/types'
import { type ByteSink, readFileBytes } from '../io'
import type { Message } from '../types/session'
import { throwIfAborted } from '../utils/abort'

type Row = Omit<BackupMessage, 'message'> & { offset: number; length: number }
type Path = { threadId: string; head: string | null; messages: Row[] }
type Fork = { position: number; createdAt: number; lists: Array<{ id: string; path: Path }> }
type LegacyPicture = { storageKey?: string; url?: string; loading?: boolean }
const CHUNK_BYTES = 64 * 1024

/** Remote images use the image field understood by V2 readers. */
function legacyMessage(message: Message): Message & { pictures?: LegacyPicture[] } {
  const existing = (message as Message & { pictures?: LegacyPicture[] }).pictures
  const pictures = existing ? [...existing] : []
  let changed = false
  const contentParts = message.contentParts.filter((part) => {
    if (part.type !== 'image' || part.storageKey || !part.url) return true
    changed = true
    if (!pictures.some((picture) => picture.url === part.url && !picture.storageKey)) pictures.push({ url: part.url })
    return false
  })
  return changed ? { ...message, contentParts, pictures } : message
}

function planSession(session: BackupSession, threads: Map<string, BackupThread>, rows: Map<string, Row>) {
  const active = threads.get(session.activeThreadId)
  if (!active || active.threadOrder !== -1) throw new Error('The active conversation thread is invalid')
  const history = [...threads.values()]
    .filter((thread) => thread !== active)
    .sort((a, b) => a.threadOrder - b.threadOrder)
  if (history.some((thread) => thread.threadOrder < 0 || thread.name === null))
    throw new Error('An archived thread is invalid')
  const children = new Map<string, Row[]>()
  for (const row of rows.values()) {
    if (!threads.has(row.threadId)) throw new Error('A message references a missing thread')
    if (row.parentMessageId === null) continue
    const parent = rows.get(row.parentMessageId)
    if (!parent || parent.threadId !== row.threadId) throw new Error('A message references an invalid parent')
    const siblings = children.get(parent.messageId) ?? []
    siblings.push(row)
    children.set(parent.messageId, siblings)
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (a, b) => a.siblingOrder - b.siblingOrder || (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0)
    )
  }
  const paths = new Map<string, Path>()
  const pending: Path[] = []
  for (const thread of [active, ...history]) {
    const root = thread.rootMessageId === null ? undefined : rows.get(thread.rootMessageId)
    if (thread.rootMessageId !== null && (!root || root.parentMessageId !== null || root.threadId !== thread.threadId))
      throw new Error('A conversation thread has an invalid root')
    const path: Path = { threadId: thread.threadId, head: thread.rootMessageId, messages: [] }
    paths.set(thread.threadId, path)
    pending.push(path)
  }
  const visited = new Set<string>()
  const forks = new Map<string, Fork>()
  for (let pathIndex = 0; pathIndex < pending.length; pathIndex++) {
    const path = pending[pathIndex]
    let cursor = path.head
    while (cursor !== null) {
      if (visited.has(cursor)) throw new Error('A conversation contains a cycle or repeated message')
      const row = rows.get(cursor)
      if (!row || row.threadId !== path.threadId) throw new Error('A selected branch references an invalid message')
      visited.add(cursor)
      path.messages.push(row)
      const siblings = children.get(cursor) ?? []
      if (!siblings.length) {
        if (row.activeChildId !== null) throw new Error('A leaf message references an active child')
        break
      }
      if (siblings.length === 1 && siblings[0].messageId === row.activeChildId) {
        cursor = row.activeChildId
        continue
      }
      let pivot = row
      const ancestors = new Set<string>()
      while (pivot.kind === 'summary') {
        if (ancestors.has(pivot.messageId)) throw new Error('A summary chain contains a cycle')
        ancestors.add(pivot.messageId)
        const parent = pivot.parentMessageId === null ? undefined : rows.get(pivot.parentMessageId)
        if (!parent) throw new Error('A branch point has no message ancestor')
        pivot = parent
      }
      if (row.forkPivotId !== undefined && row.forkPivotId !== pivot.messageId)
        throw new Error('A branch pivot cannot be represented in V2')
      if (forks.has(pivot.messageId)) throw new Error('Multiple branch points use the same conversation pivot')
      const fork: Fork = {
        position: -1,
        createdAt: pivot.forkCreatedAt ?? siblings.reduce((time, child) => Math.min(time, child.createdAt), Infinity),
        lists: [],
      }
      for (const child of siblings) {
        const selected = child.messageId === row.activeChildId
        const branch: Path = { threadId: path.threadId, head: selected ? null : child.messageId, messages: [] }
        if (selected) fork.position = fork.lists.length
        else pending.push(branch)
        fork.lists.push({ id: child.branchId ?? `fork_list_${child.messageId}`, path: branch })
      }
      if (row.activeChildId === null) {
        const next =
          row.pendingBranchOrder === undefined
            ? -1
            : siblings.findIndex((child) => child.siblingOrder > row.pendingBranchOrder!)
        fork.position = next < 0 ? fork.lists.length : next
        fork.lists.splice(fork.position, 0, {
          id: row.pendingBranchId ?? `fork_list_empty_${pivot.messageId}`,
          path: { threadId: path.threadId, head: null, messages: [] },
        })
      } else if (fork.position < 0) throw new Error('A selected branch is not a child of its branch point')
      forks.set(pivot.messageId, fork)
      cursor = row.activeChildId
    }
  }
  if (visited.size !== rows.size) throw new Error('A conversation contains unreachable messages')
  return { active, history, paths, forks }
}

export interface LegacySessionWriter {
  append(record: Extract<BackupBusinessRecord, { type: 'thread' | 'message' }>): Promise<void>
  /** Writes JSON bytes; the caller owns the output sink and its size/hash checks. */
  write(output: ByteSink): Promise<void>
  abort(): Promise<void>
}

/** Retains topology only; each message body is stored once in the task workspace. */
export async function createLegacySessionWriter(options: {
  session: BackupSession
  workspace: BackupWorkspace
  fileName: string
  signal?: AbortSignal
  maxBytes?: number
}): Promise<LegacySessionWriter> {
  const { session, workspace, fileName, signal } = options
  throwIfAborted(signal)
  const payload = await workspace.createFile(fileName)
  const encoder = new TextEncoder()
  const rows = new Map<string, Row>()
  const threads = new Map<string, BackupThread>()
  let offset = 0
  let collecting = true
  let payloadClosed = false
  const abort = async () => {
    collecting = false
    if (!payloadClosed) {
      payloadClosed = true
      await payload.abort()
    }
  }
  return {
    abort,
    async append(record) {
      if (!collecting) throw new Error('The conversation export is already finished')
      try {
        throwIfAborted(signal)
        const row = record.type === 'thread' ? record.thread : record.message
        if (row.sessionId !== session.id) throw new Error('A conversation row has a different owner')
        if (record.type === 'thread') {
          if (threads.has(record.thread.threadId)) throw new Error('A conversation contains duplicate threads')
          threads.set(record.thread.threadId, record.thread)
        } else {
          const { message, ...metadata } = record.message
          if (rows.has(metadata.messageId) || metadata.messageId !== message.id)
            throw new Error('A conversation contains an invalid message identity')
          const bytes = encoder.encode(JSON.stringify(legacyMessage(message)))
          if (offset + bytes.length > (options.maxBytes ?? 128 * 1024 * 1024))
            throw new Error('Conversation JSON exceeds its byte budget')
          await payload.write(bytes)
          rows.set(metadata.messageId, { ...metadata, offset, length: bytes.length })
          offset += bytes.length
        }
      } catch (error) {
        await abort().catch(() => undefined)
        throw error
      }
    },
    async write(output) {
      if (!collecting) throw new Error('The conversation export is already finished')
      collecting = false
      try {
        throwIfAborted(signal)
        const plan = planSession(session, threads, rows)
        await payload.close()
        payloadClosed = true
        const source = await workspace.openFile(fileName)
        try {
          if (source.size !== offset) throw new Error('Conversation export staging is incomplete')
          let buffer = new Uint8Array(CHUNK_BYTES)
          let buffered = 0
          const bytes = async (data: Uint8Array) => {
            for (let at = 0; at < data.length; ) {
              throwIfAborted(signal)
              const count = Math.min(data.length - at, buffer.length - buffered)
              buffer.set(data.subarray(at, at + count), buffered)
              at += count
              buffered += count
              if (buffered === buffer.length) {
                await output.write(buffer)
                buffer = new Uint8Array(CHUNK_BYTES)
                buffered = 0
              }
            }
          }
          const text = (value: string) => bytes(encoder.encode(value))
          const json = (value: unknown) => text(JSON.stringify(value))
          const messages = async (path: Path) => {
            await text('[')
            for (let index = 0; index < path.messages.length; index++) {
              if (index) await text(',')
              const row = path.messages[index]
              for (let at = 0; at < row.length; at += CHUNK_BYTES) {
                throwIfAborted(signal)
                await bytes(await readFileBytes(source, row.offset + at, Math.min(CHUNK_BYTES, row.length - at)))
              }
            }
            await text(']')
          }
          const { activeThreadId: _activeThreadId, ...header } = session
          await text(JSON.stringify(header).slice(0, -1))
          await text(',"messages":')
          await messages(plan.paths.get(plan.active.threadId)!)
          if (plan.active.name !== null) {
            await text(',"threadName":')
            await json(plan.active.name)
          }
          if (plan.active.compactionPoints.length) {
            await text(',"compactionPoints":')
            await json(plan.active.compactionPoints)
          }
          if (plan.history.length) {
            await text(',"threads":[')
            for (let index = 0; index < plan.history.length; index++) {
              if (index) await text(',')
              const thread = plan.history[index]
              await text(
                JSON.stringify({
                  id: thread.threadId,
                  name: thread.name,
                  createdAt: thread.createdAt,
                  ...(thread.compactionPoints.length ? { compactionPoints: thread.compactionPoints } : {}),
                  ...(thread.sessionPromptContextSnapshot === undefined
                    ? {}
                    : { sessionPromptContextSnapshot: thread.sessionPromptContextSnapshot }),
                }).slice(0, -1)
              )
              await text(',"messages":')
              await messages(plan.paths.get(thread.threadId)!)
              await text('}')
            }
            await text(']')
          }
          if (plan.forks.size) {
            await text(',"messageForksHash":{')
            let first = true
            for (const [pivot, fork] of plan.forks) {
              if (!first) await text(',')
              first = false
              await json(pivot)
              await text(`:{"position":${fork.position},"createdAt":${fork.createdAt},"lists":[`)
              for (let index = 0; index < fork.lists.length; index++) {
                if (index) await text(',')
                const branch = fork.lists[index]
                await text('{"id":')
                await json(branch.id)
                await text(',"messages":')
                await messages(branch.path)
                await text('}')
              }
              await text(']}')
            }
            await text('}')
          }
          await text('}')
          throwIfAborted(signal)
          if (buffered) await output.write(buffer.slice(0, buffered))
        } finally {
          await source.close()
        }
      } catch (error) {
        await abort().catch(() => undefined)
        throw error
      }
    },
  }
}
