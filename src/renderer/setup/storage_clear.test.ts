import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionRepository } from '@/app/renderer-application'
import { inputBoxPreConstructedMessageFamily } from '@/stores/atoms/uiAtoms'

const {
  blobStore,
  sessionStore,
  sessionRecordIds,
  metaRecords,
  recentBlobKeys,
  lateTouchedBlobKeys,
  mockGetImageGenerationStorage,
} = vi.hoisted(() => {
  const blobs = new Map<string, string>()
  const sessions = new Map<string, unknown>()
  return {
    blobStore: blobs,
    sessionStore: sessions,
    sessionRecordIds: () =>
      [...sessions.keys()].filter((key) => key.startsWith('session:')).map((key) => key.slice('session:'.length)),
    metaRecords: [] as Array<{ id: string; hidden?: boolean }>,
    recentBlobKeys: [] as string[],
    lateTouchedBlobKeys: new Set<string>(),
    mockGetImageGenerationStorage: vi.fn(() => ({
      initialize: async () => undefined,
      getTotal: async () => 0,
      getPage: async () => ({ items: [], nextCursor: null }),
    })),
  }
})

vi.mock('@/platform', () => ({
  default: {
    // Keep isDesktopLike true so the module-level startup setTimeout is not scheduled.
    isDesktopLike: true,
    getImageGenerationStorage: mockGetImageGenerationStorage,
  },
}))

vi.mock('@/storage', () => ({
  default: {
    getAllKeys: vi.fn(async () => [...sessionStore.keys()]),
    getBlobKeys: vi.fn(async () => [...blobStore.keys()]),
    delBlob: vi.fn((key: string) => {
      blobStore.delete(key)
      return Promise.resolve()
    }),
    getItem: vi.fn(async (key: string, initialValue: unknown) => sessionStore.get(key) ?? initialValue),
  },
}))

vi.mock('../storage/blob-write-tracker', () => ({
  getRecentlyWrittenBlobKeys: vi.fn(() => recentBlobKeys),
  isBlobRecentlyWritten: vi.fn((key: string) => recentBlobKeys.includes(key) || lateTouchedBlobKeys.has(key)),
}))

vi.mock('@/app/renderer-application', async () => {
  const { collectHeaderResourceReferences, collectMessageReferences } = await import('@chatbox/core/resources')
  return {
    sessionRepository: {
      getAllSessionIds: vi.fn(async () => sessionRecordIds()),
      listSessionRecordIds: vi.fn(async () => sessionRecordIds()),
      requiresSessionMigration: vi.fn(async () => false),
      iterateSessionResourceReferences: vi.fn(async function* (id: string) {
        const session = sessionStore.get(`session:${id}`) as import('@shared/types').Session | undefined
        if (!session) throw new Error('Missing resource owner')
        yield* collectHeaderResourceReferences(session)
        const references: import('@chatbox/core/resources').ResourceReference[] = []
        for (const message of [...session.messages, ...(session.threads ?? []).flatMap((thread) => thread.messages)])
          collectMessageReferences(message, session.id, references)
        for (const fork of Object.values(session.messageForksHash ?? {}))
          for (const branch of fork.lists)
            for (const message of branch.messages) collectMessageReferences(message, session.id, references)
        yield* references
      }),
    },
  }
})

vi.mock('@/stores/sessionHelpers', () => ({
  getMetaStorage: async () => ({
    getAllIncludingHidden: async () => [...metaRecords],
    getById: async (id: string) => metaRecords.find((record) => record.id === id) ?? null,
  }),
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({}),
    }),
  },
}))

import { cleanupOrphanedBlobs, startStartupStorageCleanup } from './storage_clear'

function seedSession(id: string, options: { hidden?: boolean; fileStorageKeys?: string[] }) {
  metaRecords.push({ id, hidden: options.hidden })
  sessionStore.set(`session:${id}`, {
    id,
    messages: [
      {
        id: `${id}-msg`,
        role: 'user',
        contentParts: [],
        files: (options.fileStorageKeys ?? []).map((storageKey, i) => ({
          id: `${id}-file-${i}`,
          name: `${id}-file-${i}.pdf`,
          storageKey,
        })),
      },
    ],
  })
}

describe('cleanupOrphanedBlobs', () => {
  beforeEach(() => {
    blobStore.clear()
    sessionStore.clear()
    metaRecords.length = 0
    recentBlobKeys.length = 0
    lateTouchedBlobKeys.clear()
    vi.mocked(sessionRepository.getAllSessionIds)
      .mockReset()
      .mockImplementation(async () => sessionRecordIds())
    vi.mocked(sessionRepository.listSessionRecordIds)
      .mockReset()
      .mockImplementation(async () => sessionRecordIds())
    vi.mocked(sessionRepository.requiresSessionMigration)
      .mockReset()
      .mockImplementation(async () => false)
    vi.mocked(sessionRepository.iterateSessionResourceReferences).mockClear()
  })

  it('protects recently written in-flight blobs from deletion', async () => {
    // Simulates image generation: blob written, record update not yet persisted.
    blobStore.set('picture:image-gen:rec-1:uuid-1', 'x')
    blobStore.set('parseFile-in-flight', 'x')
    blobStore.set('picture:orphan', 'x')
    recentBlobKeys.push('picture:image-gen:rec-1:uuid-1', 'parseFile-in-flight')

    const deleted = await cleanupOrphanedBlobs()

    expect(deleted).toBe(1)
    expect(blobStore.has('picture:image-gen:rec-1:uuid-1')).toBe(true)
    expect(blobStore.has('parseFile-in-flight')).toBe(true)
    expect(blobStore.has('picture:orphan')).toBe(false)
  })

  it('defers startup cleanup until the row migration has finished', async () => {
    let finishMigration: () => void = () => {}
    const migrationDone = new Promise<void>((resolve) => {
      finishMigration = resolve
    })
    let scheduledRun: (() => void) | undefined
    const cleanup = vi.fn(async () => undefined)
    const handle = startStartupStorageCleanup({
      sessionMigrationReady: migrationDone.then(() => true),
      schedule: (run) => {
        scheduledRun = run
        return () => {
          scheduledRun = undefined
        }
      },
      cleanup,
    })

    await Promise.resolve()
    expect(scheduledRun).toBeUndefined()

    finishMigration()
    await migrationDone
    await vi.waitFor(() => expect(scheduledRun).toBeTypeOf('function'))

    scheduledRun?.()
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce())
    handle.stop()
  })

  it('skips startup cleanup when the row migration did not finish safely', async () => {
    const schedule = vi.fn(() => () => undefined)

    startStartupStorageCleanup({ sessionMigrationReady: Promise.resolve(false), schedule })
    await Promise.resolve()
    await Promise.resolve()

    expect(schedule).not.toHaveBeenCalled()
  })

  it('honors a blob touched after the scan via the pre-delete recheck', async () => {
    const key = `generation-request:${'d'.repeat(64)}`
    blobStore.set(key, '{}')
    lateTouchedBlobKeys.add(key)

    const deleted = await cleanupOrphanedBlobs()

    expect(deleted).toBe(0)
    expect(blobStore.has(key)).toBe(true)
  })

  it('reclaims orphaned link caches and tool results while keeping referenced ones', async () => {
    blobStore.set('link:https://kept.example', 'x')
    blobStore.set('link:https://orphan.example', 'x')
    blobStore.set('tool-result:kept-session:call-1', 'x')
    blobStore.set('tool-result:deleted-session:call-2', 'x')
    metaRecords.push({ id: 'kept-session' })
    sessionStore.set('session:kept-session', {
      id: 'kept-session',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          links: [{ storageKey: 'link:https://kept.example' }],
          contentParts: [
            { type: 'tool-call', toolCallId: 'call-1', resultStorageKey: 'tool-result:kept-session:call-1' },
          ],
        },
      ],
    })

    const deleted = await cleanupOrphanedBlobs()

    expect(deleted).toBe(2)
    expect(blobStore.has('link:https://kept.example')).toBe(true)
    expect(blobStore.has('tool-result:kept-session:call-1')).toBe(true)
    expect(blobStore.has('link:https://orphan.example')).toBe(false)
    expect(blobStore.has('tool-result:deleted-session:call-2')).toBe(false)
  })

  it('reclaims legacy request-snapshot definition blobs (nothing references them anymore)', async () => {
    const legacyKeyA = `generation-request:${'a'.repeat(64)}`
    const legacyKeyB = `generation-request:${'b'.repeat(64)}`
    blobStore.set(legacyKeyA, '{}')
    blobStore.set(legacyKeyB, '{}')

    const deleted = await cleanupOrphanedBlobs()

    expect(deleted).toBe(2)
    expect(blobStore.has(legacyKeyA)).toBe(false)
    expect(blobStore.has(legacyKeyB)).toBe(false)
  })

  it('aborts without deleting when the reference scan exceeds its time budget', async () => {
    blobStore.set('file:orphan', 'x')
    blobStore.set('file:referenced', 'x')
    seedSession('visible', { fileStorageKeys: ['file:referenced'] })

    // Already-expired deadline: the session scan must abort before deleting anything.
    const deleted = await cleanupOrphanedBlobs({ deadlineMs: -1 })

    expect(deleted).toBe(0)
    expect(blobStore.has('file:orphan')).toBe(true)
    expect(blobStore.has('file:referenced')).toBe(true)
  })

  it('aborts without deleting or reading references while a listed session has no row commit', async () => {
    blobStore.set('file:migrated', 'x')
    blobStore.set('file:unmigrated', 'x')
    blobStore.set('file:orphan', 'x')
    seedSession('migrated', { fileStorageKeys: ['file:migrated'] })
    seedSession('unmigrated', { fileStorageKeys: ['file:unmigrated'] })
    vi.mocked(sessionRepository.requiresSessionMigration).mockImplementation(
      async (candidate) => candidate.id === 'unmigrated'
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const deleted = await cleanupOrphanedBlobs()

    expect(deleted).toBe(0)
    expect([...blobStore.keys()].sort()).toEqual(['file:migrated', 'file:orphan', 'file:unmigrated'])
    expect(sessionRepository.iterateSessionResourceReferences).toHaveBeenCalledWith('migrated')
    expect(sessionRepository.iterateSessionResourceReferences).not.toHaveBeenCalledWith('unmigrated')
    expect(warn).toHaveBeenCalledWith(
      'storage_clear: session unmigrated has no row commit (unmigrated or missing), aborting without deleting'
    )
    warn.mockRestore()
  })

  it('keeps every blob when a session without metadata still has a legacy record', async () => {
    blobStore.set('file:lost', 'x')
    blobStore.set('file:orphan', 'x')
    sessionStore.set('session:lost', { id: 'lost', messages: [] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await cleanupOrphanedBlobs()).toBe(0)
    expect([...blobStore.keys()].sort()).toEqual(['file:lost', 'file:orphan'])
    expect(sessionRepository.iterateSessionResourceReferences).not.toHaveBeenCalled()
    expect(sessionRepository.requiresSessionMigration).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'storage_clear: session lost is outside the metadata snapshot and needs a fresh scan, aborting without deleting'
    )
    warn.mockRestore()
  })

  it('does not block cleanup for a session with rows only and no metadata', async () => {
    blobStore.set('file:orphan', 'x')
    vi.mocked(sessionRepository.getAllSessionIds).mockResolvedValue(['remnant'])

    expect(await cleanupOrphanedBlobs()).toBe(1)
    expect(blobStore.size).toBe(0)
    expect(sessionRepository.iterateSessionResourceReferences).not.toHaveBeenCalled()
  })

  it('aborts if migration publishes metadata after the scan snapshot', async () => {
    blobStore.set('file:lost', 'x')
    vi.mocked(sessionRepository.getAllSessionIds).mockImplementationOnce(() => {
      metaRecords.push({ id: 'lost' })
      return Promise.resolve(['lost'])
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await cleanupOrphanedBlobs()).toBe(0)
    expect(blobStore.has('file:lost')).toBe(true)
    warn.mockRestore()
  })

  it('aborts with a time-budget warning when the identity check runs past the deadline', async () => {
    blobStore.set('file:orphan', 'x')
    const clock = vi.spyOn(Date, 'now')
    vi.mocked(sessionRepository.getAllSessionIds).mockImplementationOnce(async () => {
      clock.mockReturnValue(Number.MAX_SAFE_INTEGER)
      return ['remnant']
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await cleanupOrphanedBlobs()).toBe(0)
    expect(blobStore.has('file:orphan')).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      'storage_clear: reference scan exceeded its time budget (1 session identities), aborting without deleting'
    )
    clock.mockRestore()
    warn.mockRestore()
  })

  it('keeps blobs referenced by hidden (archived) sessions and deletes true orphans', async () => {
    blobStore.set('file:visible-attachment', 'x')
    blobStore.set('file:archived-attachment', 'x')
    blobStore.set('file:orphan', 'x')
    blobStore.set('unrelated-key', 'x')
    seedSession('visible', { fileStorageKeys: ['file:visible-attachment'] })
    seedSession('archived', { hidden: true, fileStorageKeys: ['file:archived-attachment'] })

    const deleted = await cleanupOrphanedBlobs()

    expect(deleted).toBe(1)
    expect(blobStore.has('file:visible-attachment')).toBe(true)
    expect(blobStore.has('file:archived-attachment')).toBe(true)
    expect(blobStore.has('file:orphan')).toBe(false)
    expect(blobStore.has('unrelated-key')).toBe(true)
  })

  it('reports blobs freed by a queued predecessor run to concurrent callers', async () => {
    blobStore.set('file:orphan-a', 'x')
    blobStore.set('file:orphan-b', 'x')

    // Second call is enqueued while the first is still running; by the time it
    // scans, the orphans are already gone. It must still report the freed count
    // so quota-recovery callers know space became available and retry.
    const [first, second] = await Promise.all([cleanupOrphanedBlobs(), cleanupOrphanedBlobs()])

    expect(first).toBe(2)
    expect(second).toBe(2)
    expect(blobStore.size).toBe(0)
  })

  it('protects custom copilot icon and background blobs from deletion', async () => {
    blobStore.set('picture:copilot-icon:c1:uuid-1', 'x')
    blobStore.set('picture:copilot-bg:c1:uuid-2', 'x')
    blobStore.set('picture:orphan', 'x')
    sessionStore.set('myCopilots', [
      {
        id: 'c1',
        name: 'Custom Copilot',
        prompt: 'p',
        avatar: { type: 'storage-key', storageKey: 'picture:copilot-icon:c1:uuid-1' },
        backgroundImage: { type: 'storage-key', storageKey: 'picture:copilot-bg:c1:uuid-2' },
      },
    ])

    const deleted = await cleanupOrphanedBlobs()

    expect(deleted).toBe(1)
    expect(blobStore.has('picture:copilot-icon:c1:uuid-1')).toBe(true)
    expect(blobStore.has('picture:copilot-bg:c1:uuid-2')).toBe(true)
    expect(blobStore.has('picture:orphan')).toBe(false)
  })

  it('protects input box draft attachments from deletion', async () => {
    blobStore.set('picture:input-box:draft-image', 'x')
    blobStore.set('file:draft.pdf-10-1700000000000', 'x')
    blobStore.set('file:draft.pdf-10-1700000000000_raw', 'x')
    blobStore.set('file:orphan', 'x')

    const store = getDefaultStore()
    const draftAtom = inputBoxPreConstructedMessageFamily('draft-session')
    store.set(draftAtom, {
      ...store.get(draftAtom),
      pictureKeys: ['picture:input-box:draft-image'],
      preprocessingStatus: {
        files: { 'file:draft.pdf-10-1700000000000': 'processing' as const },
        links: {},
      },
    })

    try {
      const deleted = await cleanupOrphanedBlobs()

      expect(deleted).toBe(1)
      expect(blobStore.has('picture:input-box:draft-image')).toBe(true)
      expect(blobStore.has('file:draft.pdf-10-1700000000000')).toBe(true)
      expect(blobStore.has('file:draft.pdf-10-1700000000000_raw')).toBe(true)
      expect(blobStore.has('file:orphan')).toBe(false)
    } finally {
      inputBoxPreConstructedMessageFamily.remove('draft-session')
    }
  })
})
