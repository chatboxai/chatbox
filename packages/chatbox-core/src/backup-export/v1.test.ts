import { describe, expect, it } from 'vitest'
import { convertLegacyTreeToRowFormat } from '../application/session/compatibility/row-format'
import { toBackupMessage, toBackupSession, toBackupThread } from '../backup-v3/schema'
import type { BackupBusinessRecord, BackupExportSource, BackupSelection, BackupWorkspace } from '../backup-v3/types'
import type { ByteSink } from '../io'
import { encodeSessionTree } from '../session/session-tree'
import type { Message, Session } from '../types/session'
import { exportBackup } from './index'
import type { BackupExportOptions } from './types'

const decoder = new TextDecoder()
function combine(parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
function output() {
  const parts: Uint8Array[] = []
  const state = { closed: false, aborted: false }
  const sink: ByteSink = {
    write: async (bytes) => {
      parts.push(bytes.slice())
    },
    close: async () => {
      state.closed = true
    },
    abort: async () => {
      state.aborted = true
      parts.length = 0
    },
  }
  return { sink, state, bytes: () => combine(parts) }
}
class Workspace implements BackupWorkspace {
  files = new Map<string, Uint8Array>()
  disposed = false
  abortedFiles = 0
  openedFiles = 0
  closedFiles = 0
  async createFile(name: string): Promise<ByteSink> {
    const file = output()
    return {
      ...file.sink,
      close: async () => {
        this.files.set(name, file.bytes())
      },
      abort: async () => {
        this.abortedFiles++
        await file.sink.abort()
      },
    }
  }
  async openFile(name: string) {
    const bytes = this.files.get(name)
    if (!bytes) throw new Error('Missing temporary file')
    this.openedFiles++
    return {
      size: bytes.length,
      readBytes: async (offset: number, length: number) => bytes.slice(offset, offset + length),
      close: async () => {
        this.closedFiles++
      },
    }
  }
  async put(): Promise<boolean> {
    throw new Error('The V1 exporter does not need an index')
  }
  async get(): Promise<string | null> {
    throw new Error('The V1 exporter does not need an index')
  }
  entries(): AsyncIterable<{ key: string; value: string }> {
    throw new Error('The V1 exporter does not need an index')
  }
  async dispose() {
    this.disposed = true
    this.files.clear()
  }
}
function message(id: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [{ type: 'text', text: `你好 😀 ${id}` }] }
}
function rows(session: Session): BackupBusinessRecord[] {
  const encoded = encodeSessionTree(session, { activeThreadId: `${session.id}-active`, now: 1 })
  if (!encoded.ok) throw new Error(encoded.reason)
  const tree = convertLegacyTreeToRowFormat(encoded.tree, encoded.normalized.messageForksHash)
  return [
    { type: 'session', session: toBackupSession(tree.session) },
    ...tree.threads.map((thread) => ({ type: 'thread' as const, thread: toBackupThread(thread) })),
    ...tree.messages.map((row) => ({ type: 'message' as const, message: toBackupMessage(row) })),
  ]
}
function fixture(): Session {
  return {
    id: 'conversation',
    name: 'V1 对话 😀',
    type: 'chat',
    starred: true,
    threadName: 'Current thread',
    messages: [message('pivot'), { ...message('summary', 'assistant'), isSummary: true }, message('selected')],
    compactionPoints: [{ summaryMessageId: 'summary', boundaryMessageId: 'pivot', createdAt: 9 }],
    threads: [{ id: 'history', name: 'History', createdAt: 2, messages: [message('old-message')] }],
    messageForksHash: {
      pivot: {
        position: 1,
        createdAt: 7,
        lists: [
          { id: 'alternative', messages: [message('alternative-message')] },
          { id: 'selected-branch', messages: [] },
        ],
      },
    },
  }
}
type V1Document = {
  configVersion: number
  __exported_items: string[]
  __exported_at: string
  'chat-sessions-list': Array<{ id: string; name: string }>
  [key: `session:${string}`]: Session
}
function setup(sessions: Session[] = [fixture()], overrides: Partial<BackupExportOptions> = {}) {
  const workspace = new Workspace()
  const file = output()
  const selections: BackupSelection[] = []
  const source: BackupExportSource = {
    async *records(selection) {
      selections.push(selection)
      for (const session of sessions) {
        if (!selection.sessionIds || selection.sessionIds.includes(session.id)) yield* rows(session)
      }
    },
    async openResource() {
      throw new Error('V1 must not read attachments')
    },
  }
  const options: BackupExportOptions = {
    format: 'v1',
    archiveId: 'v1-export',
    createdAt: '2026-10-23T00:00:00.000Z',
    producer: 'test',
    selection: { sessions: true, settings: false, copilots: false, credentials: false },
    output: file.sink,
    workspace,
    source,
    ...overrides,
  }
  return {
    options,
    workspace,
    file,
    selections,
    read: () => JSON.parse(decoder.decode(file.bytes())) as V1Document,
  }
}

describe('V1 conversation JSON export', () => {
  it('writes the released key/value contract with direct session objects and selected sessions only', async () => {
    const test = setup([fixture(), { id: 'empty', name: 'Empty', messages: [] }], {
      selection: { sessions: true, sessionIds: ['conversation'], settings: true, copilots: true, credentials: true },
    })
    const result = await exportBackup(test.options)
    expect(test.read()).toEqual({
      configVersion: 15,
      __exported_items: ['conversations'],
      __exported_at: '2026-10-23T00:00:00.000Z',
      'chat-sessions-list': [
        { id: 'conversation', name: 'V1 对话 😀', type: 'chat', starred: true, sortOrder: 0, createdAt: 0 },
      ],
      'session:conversation': fixture(),
    })
    expect(test.selections).toEqual([
      { sessions: true, sessionIds: ['conversation'], settings: false, copilots: false, credentials: false },
    ])
    expect(result.manifest).toBeNull()
    expect(result.complete).toMatchObject({
      counts: { session: 1, thread: 2, message: 5, global: 0, resource: 0 },
      resourceBytes: 0,
      dataBytes: test.file.bytes().length,
    })
    expect(test.file.state).toEqual({ closed: true, aborted: false })
    expect(test.workspace.disposed).toBe(true)
    expect(test.workspace.closedFiles).toBe(test.workspace.openedFiles)
  })

  it('keeps empty sessions and an empty selected conversation list readable', async () => {
    const test = setup([{ id: 'empty', name: 'Empty', messages: [] }])
    await exportBackup(test.options)
    expect(test.read()['session:empty']).toEqual({ id: 'empty', name: 'Empty', messages: [] })
    const none = setup([fixture()], {
      selection: { sessions: true, sessionIds: [], settings: false, copilots: false, credentials: false },
    })
    await exportBackup(none.options)
    expect(none.read()['chat-sessions-list']).toEqual([])
    expect(Object.keys(none.read()).filter((key) => key.startsWith('session:'))).toEqual([])
  })

  it('preserves exported list order metadata and an empty selected branch', async () => {
    const session = fixture()
    session.messages.pop()
    const records = rows(session)
    const header = records[0]
    if (header.type !== 'session') throw new Error('Missing session')
    header.meta = { sortOrder: 42, createdAt: 123 }
    const test = setup()
    test.options.source.records = async function* () {
      yield* records
    }
    await exportBackup(test.options)
    expect(test.read()['chat-sessions-list'][0]).toMatchObject({ sortOrder: 42, createdAt: 123 })
    expect(test.read()['session:conversation'].messageForksHash?.pivot).toEqual(session.messageForksHash?.pivot)
    expect(test.read()['session:conversation'].messages.map((entry) => entry.id)).toEqual(['pivot', 'summary'])
  })

  it('projects only dialogue fields while retaining message identity and topology for attachment-only messages', async () => {
    const session = fixture()
    session.folderId = 'work-folder'
    session.copilotId = 'copilot'
    session.assistantAvatarKey = 'picture:avatar'
    session.backgroundImage = { type: 'storage-key', storageKey: 'picture:background' }
    session.settings = { temperature: 0.7 }
    session.threads![0].sessionPromptContextSnapshot = {
      version: 1,
      capturedAt: 1,
      soul: 'private soul',
      memories: [],
      workspaceInstructions: '',
      workspaceDirectories: [],
    }
    session.messages[0] = {
      ...message('pivot'),
      name: 'Speaker',
      timestamp: 100,
      updatedAt: 200,
      model: 'Chat model',
      aiProvider: 'test-provider',
      reasoningContent: 'Legacy reasoning',
      modelId: 'new-model-id',
      generating: false,
      tokenCount: 100,
      files: [{ id: 'file', name: 'file.txt', fileType: 'text/plain', storageKey: 'file:body' }],
      links: [{ id: 'link', url: 'https://example.test', title: 'Link', storageKey: 'link:body' }],
      compactedFiles: [{ id: 'compacted', name: 'old.txt', fileType: 'text/plain', storageKey: 'file:old' }],
      compactedLinks: [{ id: 'old-link', url: 'https://example.test/old', title: 'Old', storageKey: 'link:old' }],
      contentParts: [
        { type: 'text', text: 'Visible text', stepIndex: 1, providerMetadata: { provider: { signature: 'secret' } } },
        { type: 'text', text: 'Protocol text', protocolOnly: true },
        { type: 'reasoning', text: 'Visible reasoning', startTime: 10, duration: 2, stepIndex: 1 },
        { type: 'reasoning', text: 'Protocol reasoning', protocolOnly: true },
        { type: 'image', storageKey: 'picture:local' },
        { type: 'image', storageKey: '', url: 'https://example.test/remote.png' },
        { type: 'info', text: 'Work result' },
        { type: 'agent-mode-suggestion', reason: 'Suggested tool mode' },
      ],
    }
    session.messages[2] = {
      id: 'selected',
      role: 'user',
      contentParts: [{ type: 'image', storageKey: 'picture:only' }],
    }
    Object.assign(session, { futureHeader: 'unsupported header' })
    Object.assign(session.messages[0], { futureMessage: 'unsupported message' })
    const test = setup([session])
    await exportBackup(test.options)
    const exported = test.read()['session:conversation']
    expect(exported.messages[0]).toEqual({
      id: 'pivot',
      role: 'user',
      name: 'Speaker',
      timestamp: 100,
      updatedAt: 200,
      model: 'Chat model',
      aiProvider: 'test-provider',
      reasoningContent: 'Legacy reasoning',
      contentParts: [
        { type: 'text', text: 'Visible text' },
        { type: 'reasoning', text: 'Visible reasoning', startTime: 10, duration: 2 },
      ],
    })
    expect(exported.messages[2]).toEqual({ id: 'selected', role: 'user', contentParts: [] })
    expect(exported.messageForksHash).toEqual(session.messageForksHash)
    expect(exported.compactionPoints).toEqual(session.compactionPoints)
    expect(exported.threads).toEqual([
      { id: 'history', name: 'History', createdAt: 2, messages: [message('old-message')] },
    ])
    expect(Object.keys(exported).sort()).toEqual([
      'compactionPoints',
      'id',
      'messageForksHash',
      'messages',
      'name',
      'starred',
      'threadName',
      'threads',
      'type',
    ])
    const serialized = decoder.decode(test.file.bytes())
    for (const excluded of [
      'picture:',
      'file:',
      'link:',
      'private soul',
      'secret',
      'Protocol',
      'work-folder',
      'unsupported',
    ])
      expect(serialized).not.toContain(excluded)
  })

  it('ignores source global records even when the caller requests those categories', async () => {
    const test = setup([], { selection: { sessions: false, settings: true, copilots: true, credentials: true } })
    test.options.source.records = async function* (selection) {
      expect(selection).toEqual({ sessions: true, settings: false, copilots: false, credentials: false })
      yield { type: 'global', category: 'settings', id: 'settings', value: { apiKey: 'private-key' } }
      yield { type: 'global', category: 'copilot', id: 'myCopilots', value: [{ id: 'private-copilot' }] }
      yield* rows(fixture())
    }
    await exportBackup(test.options)
    expect(Object.keys(test.read()).sort()).toEqual([
      '__exported_at',
      '__exported_items',
      'chat-sessions-list',
      'configVersion',
      'session:conversation',
    ])
    expect(decoder.decode(test.file.bytes())).not.toContain('private-')
  })

  it.each(['duplicate-session', 'wrong-parent', 'duplicate-message', 'unselected-session'] as const)(
    'aborts the output and clears staging for %s',
    async (problem) => {
      const records = rows(fixture())
      if (problem === 'duplicate-session') records.push(...rows(fixture()))
      if (problem === 'wrong-parent' || problem === 'duplicate-message') {
        const record = records.find((entry) => entry.type === 'message')
        if (record?.type !== 'message') throw new Error('Missing message')
        if (problem === 'wrong-parent') record.message.parentMessageId = 'missing'
        else records.push(record)
      }
      const test = setup()
      if (problem === 'unselected-session') test.options.selection.sessionIds = ['different']
      test.options.source.records = async function* () {
        yield* records
      }
      await expect(exportBackup(test.options)).rejects.toThrow()
      expect(test.file.state).toEqual({ closed: false, aborted: true })
      expect(test.file.bytes()).toHaveLength(0)
      expect(test.workspace.disposed).toBe(true)
      expect(test.workspace.files.size).toBe(0)
    }
  )

  it('stops at cancellation and cleans the active conversation staging', async () => {
    const controller = new AbortController()
    const test = setup([], { signal: controller.signal })
    let reachedNextConversation = false
    test.options.source.records = async function* () {
      yield* rows(fixture())
      controller.abort()
      yield { type: 'session', session: { id: 'later', name: 'Later', activeThreadId: 'later-active' } }
      reachedNextConversation = true
    }
    await expect(exportBackup(test.options)).rejects.toThrow()
    expect(reachedNextConversation).toBe(false)
    expect(test.file.state).toEqual({ closed: false, aborted: true })
    expect(test.workspace.abortedFiles).toBe(1)
    expect(test.workspace.disposed).toBe(true)
  })

  it('propagates destination write failures and disposes open temporary readers', async () => {
    const test = setup()
    let writes = 0
    test.options.output.write = async () => {
      if (++writes === 5) throw new Error('Destination full')
    }
    await expect(exportBackup(test.options)).rejects.toThrow('Destination full')
    expect(test.file.state).toEqual({ closed: false, aborted: true })
    expect(test.workspace.disposed).toBe(true)
    expect(test.workspace.closedFiles).toBe(test.workspace.openedFiles)
  })

  it('enforces the output byte budget and reports incomplete cleanup after a completed export', async () => {
    const bounded = setup([], { limits: { maxDataBytes: 32 } })
    await expect(exportBackup(bounded.options)).rejects.toThrow('byte budget')
    expect(bounded.file.state.aborted).toBe(true)
    expect(bounded.workspace.disposed).toBe(true)
    const test = setup()
    test.workspace.dispose = async () => {
      throw new Error('Cleanup failed')
    }
    const result = await exportBackup(test.options)
    expect(result.cleanupPending).toBe(true)
    expect(test.file.state.closed).toBe(true)
    expect(test.read()['session:conversation'].id).toBe('conversation')
  })
})
