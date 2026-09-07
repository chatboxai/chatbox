/** @vitest-environment jsdom */
import type { Session, SessionMetaPage } from '@shared/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SessionAttachmentRagMaintenanceSource } from './session_attachment_rag_maintenance'

const { runMaintenance } = vi.hoisted(() => ({
  runMaintenance: vi.fn(() =>
    Promise.resolve({ interruptedFailedCount: 0, canceledPurgedCount: 0, orphanDeletedIds: [] })
  ),
}))

vi.mock('@/platform', () => ({
  default: {
    isDesktopLike: true,
    getSessionAttachmentRagController: () => ({ runMaintenance }),
  },
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionQueryBridge: { getSession: vi.fn(() => Promise.resolve(null)) },
    sessions: { listSessionsMetaPage: vi.fn(() => Promise.resolve({ items: [], nextCursor: null, total: 0 })) },
  },
}))

function createSource(): SessionAttachmentRagMaintenanceSource & {
  getSession: ReturnType<typeof vi.fn>
  listSessionsMetaPage: ReturnType<typeof vi.fn>
} {
  const page: SessionMetaPage = {
    items: [{ id: 'session-1', name: 'Session', type: 'chat', sortOrder: 1, createdAt: 1 }],
    nextCursor: null,
    total: 1,
  }
  const session: Session = { id: 'session-1', name: 'Session', type: 'chat', messages: [] }
  return {
    getSession: vi.fn(() => Promise.resolve(session)),
    listSessionsMetaPage: vi.fn(() => Promise.resolve(page)),
  }
}

async function loadMaintenance() {
  vi.resetModules()
  const { sessionStartupRecovery } = await import('@/packages/session-startup-recovery')
  sessionStartupRecovery.clearForTests()
  return { ...(await import('./session_attachment_rag_maintenance')), sessionStartupRecovery }
}

describe('initSessionAttachmentRagMaintenance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    runMaintenance.mockClear()
  })

  afterEach(() => {
    localStorage.clear()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  test('does not read or sweep when a visible session failed to start', async () => {
    const source = createSource()
    const { runSessionAttachmentRagMaintenancePass, sessionStartupRecovery } = await loadMaintenance()
    sessionStartupRecovery.fail('session-1')
    await expect(runSessionAttachmentRagMaintenancePass({ source })).resolves.toEqual({
      interruptedFailedCount: 0,
      canceledPurgedCount: 0,
      orphanDeletedIds: [],
    })
    expect(source.getSession).not.toHaveBeenCalled()
    expect(runMaintenance).not.toHaveBeenCalled()
  })

  test('does not let a deleted failed-session marker block maintenance', async () => {
    const source = createSource()
    const { runSessionAttachmentRagMaintenancePass, sessionStartupRecovery } = await loadMaintenance()
    sessionStartupRecovery.fail('deleted-session')
    await runSessionAttachmentRagMaintenancePass({ source })
    expect(source.getSession).toHaveBeenCalledWith('session-1')
    expect(runMaintenance).toHaveBeenCalledWith({
      sessionIds: ['session-1'],
      messageIds: [],
      attachmentReferences: [],
    })
  })

  test('preserves the recovery guard after background migration finishes', async () => {
    const source = createSource()
    const { initSessionAttachmentRagMaintenance, sessionStartupRecovery } = await loadMaintenance()
    sessionStartupRecovery.fail('session-1')
    initSessionAttachmentRagMaintenance({ source, sessionMigrationDone: Promise.resolve() })
    await vi.advanceTimersByTimeAsync(0)
    expect(source.listSessionsMetaPage).toHaveBeenCalled()
    expect(source.getSession).not.toHaveBeenCalled()
    expect(runMaintenance).not.toHaveBeenCalled()
  })

  test('reads no session until the session migration is over', async () => {
    const source = createSource()
    let finishMigration: () => void = () => {}
    const sessionMigrationDone = new Promise<void>((resolve) => {
      finishMigration = resolve
    })
    const { initSessionAttachmentRagMaintenance } = await loadMaintenance()

    initSessionAttachmentRagMaintenance({ source, sessionMigrationDone, firstPassWaitMs: 600_000 })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(source.listSessionsMetaPage).not.toHaveBeenCalled()
    expect(source.getSession).not.toHaveBeenCalled()

    finishMigration()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.getSession).toHaveBeenCalledWith('session-1')
    expect(runMaintenance).toHaveBeenCalledOnce()
  })

  test('runs the first pass once the wait bound elapses', async () => {
    const source = createSource()
    const { initSessionAttachmentRagMaintenance } = await loadMaintenance()

    initSessionAttachmentRagMaintenance({
      source,
      sessionMigrationDone: new Promise<void>(() => {}),
      firstPassWaitMs: 600_000,
    })
    await vi.advanceTimersByTimeAsync(599_000)

    expect(source.getSession).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)

    expect(source.getSession).toHaveBeenCalledWith('session-1')
    expect(runMaintenance).toHaveBeenCalledOnce()
  })

  test('collects the scope right away when no migration is pending', async () => {
    const source = createSource()
    const { initSessionAttachmentRagMaintenance } = await loadMaintenance()

    initSessionAttachmentRagMaintenance({ source })
    await vi.advanceTimersByTimeAsync(0)

    expect(source.getSession).toHaveBeenCalledWith('session-1')
    expect(runMaintenance).toHaveBeenCalledOnce()
  })
})
