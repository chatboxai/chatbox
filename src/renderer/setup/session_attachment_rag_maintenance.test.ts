/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionStartupRecovery } from '@/packages/session-startup-recovery'
import { runSessionAttachmentRagMaintenancePass } from './session_attachment_rag_maintenance'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listSessionsMetaPage: vi.fn(),
  runMaintenance: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionQueryBridge: { getSession: mocks.getSession },
    sessions: { listSessionsMetaPage: mocks.listSessionsMetaPage },
  },
}))

vi.mock('@/platform', () => ({
  default: {
    isDesktopLike: true,
    getSessionAttachmentRagController: () => ({ runMaintenance: mocks.runMaintenance }),
  },
}))

describe('session attachment RAG maintenance startup guard', () => {
  beforeEach(() => {
    mocks.getSession.mockReset()
    mocks.listSessionsMetaPage.mockReset()
    mocks.runMaintenance.mockReset()
  })

  afterEach(() => {
    sessionStartupRecovery.clearForTests()
  })

  it('does not read or sweep when a visible session failed to start', async () => {
    sessionStartupRecovery.fail('failed-session')
    mocks.listSessionsMetaPage.mockResolvedValue({
      items: [{ id: 'failed-session' }],
      nextCursor: null,
      total: 1,
    })

    await expect(runSessionAttachmentRagMaintenancePass()).resolves.toEqual({
      interruptedFailedCount: 0,
      canceledPurgedCount: 0,
      orphanDeletedIds: [],
    })
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.runMaintenance).not.toHaveBeenCalled()
  })

  it('does not let a deleted failed-session marker block maintenance', async () => {
    sessionStartupRecovery.fail('deleted-session')
    mocks.listSessionsMetaPage.mockResolvedValue({
      items: [{ id: 'live-session' }],
      nextCursor: null,
      total: 1,
    })
    mocks.getSession.mockResolvedValue({ id: 'live-session', messages: [] })
    mocks.runMaintenance.mockResolvedValue({
      interruptedFailedCount: 0,
      canceledPurgedCount: 0,
      orphanDeletedIds: [],
    })

    await runSessionAttachmentRagMaintenancePass()

    expect(mocks.getSession).toHaveBeenCalledWith('live-session')
    expect(mocks.runMaintenance).toHaveBeenCalledWith({
      sessionIds: ['live-session'],
      messageIds: [],
      attachmentReferences: [],
    })
  })
})
