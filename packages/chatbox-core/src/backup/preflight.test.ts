import { expect, it } from 'vitest'
import { prepareBackupExport } from './preflight'
import { exportBackupArchive } from './export-backup'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { decodeSessionTree } from '../session/session-tree/decode'
import { prepareSessionForBackup } from './resources'
import { BackupStorageKey } from './storage-keys'
import type { Settings } from '@shared/types'

it('uses each prepared v2 JSON byte size at the exact threshold and reclassifies selection', async () => {
  const database = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(database)
    const snapshot = contextSnapshot({
      id: 's',
      name: 'S',
      messages: [
        {
          id: 'm',
          role: 'user',
          contentParts: [{ type: 'text', text: '中🙂\\"\n'.repeat(5000) }],
          files: [
            {
              id: 'f',
              name: 'file',
              fileType: 'text/plain',
              storageKey: 'text',
              localPath: '/private/file',
              ragMode: 'session-retrieval',
              sessionAttachmentId: 9,
            },
          ],
        },
      ],
    })
    Object.assign(snapshot.rows.messages[0].message.contentParts[0], { futureTextMetadata: { preserved: true } })
    await rows.writeRows(snapshot)
    const decoded = decodeSessionTree({
      session: snapshot.record,
      threads: snapshot.rows.threads,
      messages: snapshot.rows.messages,
    })
    if (!decoded.ok) throw new Error(decoded.reason)
    const expected = new TextEncoder().encode(JSON.stringify(prepareSessionForBackup(decoded.session))).length
    const options = {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sessionStore: rows,
      exportItems: ['conversations'] as ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    }
    const exact = await prepareBackupExport(options, { singleSessionBytes: expected })
    expect(exact.formatVersion).toBe(2)
    expect(exact.sessions[0].size).toBe(expected)
    expect((await prepareBackupExport(options, { singleSessionBytes: expected - 1 })).formatVersion).toBe(3)
    expect(
      (await prepareBackupExport({ ...options, selectedSessionIds: [] }, { singleSessionBytes: expected - 1 })).sessions
    ).toEqual([])
    let archive = new Blob()
    const exported = await exportBackupArchive({
      ...options,
      prepared: exact,
      writeArchive: async (stream) => {
        const parts: Uint8Array<ArrayBuffer>[] = []
        for await (const part of stream()) parts.push(new Uint8Array(part))
        archive = new Blob(parts)
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.formatVersion).toBe(2)
    expect(exported.manifest.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'external-resource-skipped' })])
    )
    expect(exported.manifest.sessions[0].size).toBe(expected)
    expect(archive.size).toBeGreaterThan(0)
    await rows.writeRows(contextSnapshot({ id: 'second', name: 'Second', messages: [] }))
    const multiple = await prepareBackupExport(options, { singleSessionBytes: expected })
    expect(multiple.sessionBytes).toBeGreaterThan(expected)
    expect(multiple.formatVersion).toBe(2)
  } finally {
    database.close()
  }
})

it('round trips a mixed v3 archive with global settings and rolls both domains back on cancellation', async () => {
  const { importBackupArchive } = await import('./import-backup')
  const database = openNodeSessionRowDatabase()
  const destinationDb = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(database)
    const targetRows = new SqlSessionRowStore(destinationDb)
    await rows.writeRows(
      contextSnapshot({
        id: 'small',
        name: 'small',
        copilotId: 'copilot',
        settings: {
          sessionPromptContextSnapshot: {
            version: 1,
            soul: '',
            memories: [],
            memoryEnabled: true,
            memoryStateToken: 'source-copilot:source-global',
            workspaceInstructions: '',
            workspaceDirectories: [],
            capturedAt: 1,
            scope: 'chat',
          },
        },
        messages: [],
      })
    )
    await rows.writeRows(
      contextSnapshot({
        id: 'large',
        name: 'large',
        messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'text', text: 'text'.repeat(20_000) }] }],
      })
    )
    const storage = new MemoryStorage()
    storage.values.set('settings', { theme: 'dark', userAvatarKey: 'avatar', memoryStateToken: 'source-global' })
    storage.values.set(BackupStorageKey.CopilotMemoryTokens, [{ id: 'copilot', token: 'source-copilot' }])
    storage.blobs.set('avatar', 'data:image/png;base64,YWJj')
    const options = {
      storage,
      metaStorage: new MemoryMetaStorage(),
      sessionStore: rows,
      exportItems: ['conversations', 'setting', 'copilot'] as ['conversations', 'setting', 'copilot'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    }
    const prepared = await prepareBackupExport(options, { singleSessionBytes: 1024 })
    let archive = new Blob()
    const result = await exportBackupArchive({
      ...options,
      prepared,
      writeArchive: async (stream) => {
        const parts: Uint8Array<ArrayBuffer>[] = []
        for await (const part of stream()) parts.push(new Uint8Array(part))
        archive = new Blob(parts)
        return { boundedMemory: true }
      },
    })
    expect(result.manifest.formatVersion).toBe(3)
    expect(result.manifest.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'small', layout: 'single' }),
        expect.objectContaining({ id: 'large', layout: 'sharded' }),
      ])
    )
    const target = new MemoryStorage()
    target.values.set('settings', { theme: 'light' })
    await importBackupArchive(archive, {
      storage: target,
      metaStorage: new MemoryMetaStorage(),
      sharded: { store: targetRows },
    })
    expect((await targetRows.readSnapshot('large'))?.rows.messages[0].message.contentParts).toEqual([
      { type: 'text', text: 'text'.repeat(20_000) },
    ])
    expect((await targetRows.readSnapshot('small'))?.record.name).toBe('small')
    expect(target.values.get('settings')).toMatchObject({ theme: 'dark' })
    const token = (target.values.get('settings') as Settings).memoryStateToken
    const copilotTokens = target.values.get(BackupStorageKey.CopilotMemoryTokens) as { id: string; token: string }[]
    expect(token).not.toBe('source-global')
    expect(copilotTokens[0].token).not.toBe('source-copilot')
    expect(
      (await targetRows.readSnapshot('small'))?.record.settings?.sessionPromptContextSnapshot?.memoryStateToken
    ).toBe(`${copilotTokens[0].token}:${token}`)
    const before = await targetRows.readSnapshot('large')
    const previous = new Map(target.values)
    const abort = new AbortController()
    await expect(
      importBackupArchive(archive, {
        storage: target,
        metaStorage: new MemoryMetaStorage(),
        sharded: { store: targetRows },
        signal: abort.signal,
        onProgress: (progress) => {
          if (progress.phase === 'restoring') abort.abort()
        },
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(target.values).toEqual(previous)
    expect((await targetRows.readSnapshot('large'))?.rows).toEqual(before?.rows)
  } finally {
    database.close()
    destinationDb.close()
  }
})

it('measures escaped historical strings canonically and refuses a changed selection', async () => {
  const { legacyBackupSource } = await import('./legacy-source')
  const database = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(database)
    const raw =
      '{"id":"s","name":"S","messages":[{"id":"m","role":"user","contentParts":[{"type":"text","text":"\\u4e2d\\ud83d\\ude42\\/"}]}]}'
    const store = legacyBackupSource(rows, { listSessionIds: async () => ['s'], open: async () => new Blob([raw]) })
    const options = {
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sessionStore: store,
      exportItems: ['conversations'] as ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    }
    const prepared = await prepareBackupExport(options)
    expect(prepared.sessions[0].size).toBe(new TextEncoder().encode(JSON.stringify(JSON.parse(raw))).length)
    await expect(
      exportBackupArchive({
        ...options,
        selectedSessionIds: [],
        prepared,
        writeArchive: async () => {
          throw new Error('Should not write')
        },
      })
    ).rejects.toThrow(/selection changed/)
  } finally {
    database.close()
  }
})

it('keeps thousands of ordinary messages within the v2 budget', async () => {
  const database = openNodeSessionRowDatabase()
  try {
    const rows = new SqlSessionRowStore(database)
    const source = contextSnapshot({
      id: 'many',
      name: 'Many',
      messages: Array.from({ length: 4000 }, (_, i) => ({
        id: `m${i}`,
        role: 'user' as const,
        contentParts: [{ type: 'text' as const, text: 'x'.repeat(4096) }],
      })),
    })
    await rows.writeRows(source)
    const decoded = decodeSessionTree({ session: source.record, ...source.rows })
    if (!decoded.ok) throw new Error(decoded.reason)
    const plan = await prepareBackupExport({
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      sessionStore: rows,
      exportItems: ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
    })
    expect(plan.formatVersion).toBe(2)
    expect(plan.sessions[0].size).toBe(
      new TextEncoder().encode(JSON.stringify(prepareSessionForBackup(decoded.session))).length
    )
  } finally {
    database.close()
  }
}, 30000)
