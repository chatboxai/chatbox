import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clearSessionSubmissionQueueMock, getSubmissionQueueStateMock, showMock } = vi.hoisted(() => ({
  clearSessionSubmissionQueueMock: vi.fn(),
  getSubmissionQueueStateMock: vi.fn(),
  showMock: vi.fn(),
}))

vi.mock('@ebay/nice-modal-react', () => ({
  default: { show: showMock },
}))
vi.mock('@/stores/session/submission-queue', () => ({
  clearSessionSubmissionQueue: clearSessionSubmissionQueueMock,
}))
vi.mock('@/stores/atoms/submissionQueueAtoms', () => ({
  getSubmissionQueueState: getSubmissionQueueStateMock,
}))

import { confirmAndDiscardSubmissionQueue } from './queued-message-confirmation'

describe('confirmAndDiscardSubmissionQueue', () => {
  beforeEach(() => {
    clearSessionSubmissionQueueMock.mockReset()
    getSubmissionQueueStateMock.mockReset()
    showMock.mockReset()
  })

  it('allows the action without opening a modal when the session queue is empty', async () => {
    getSubmissionQueueStateMock.mockReturnValue({ items: [], status: 'idle' })

    await expect(confirmAndDiscardSubmissionQueue('session-1')).resolves.toBe(true)

    expect(showMock).not.toHaveBeenCalled()
    expect(clearSessionSubmissionQueueMock).not.toHaveBeenCalled()
  })

  it('runs a protected new-thread action immediately when the session queue is empty', async () => {
    let startedNewThread = false
    getSubmissionQueueStateMock.mockReturnValue({ items: [], status: 'idle' })

    await expect(
      confirmAndDiscardSubmissionQueue('session-1', () => {
        startedNewThread = true
      })
    ).resolves.toBe(true)

    expect(startedNewThread).toBe(true)
    expect(showMock).not.toHaveBeenCalled()
  })

  it('keeps queued messages when the discard confirmation is cancelled', async () => {
    getSubmissionQueueStateMock.mockReturnValue({ items: [{ id: 'queued-1' }], status: 'idle' })
    showMock.mockResolvedValue(false)

    await expect(confirmAndDiscardSubmissionQueue('session-1')).resolves.toBe(false)

    expect(clearSessionSubmissionQueueMock).not.toHaveBeenCalled()
  })

  it('does not run a protected thread-switch action when the discard confirmation is cancelled', async () => {
    let switchedThread = false
    getSubmissionQueueStateMock.mockReturnValue({ items: [{ id: 'queued-1' }], status: 'idle' })
    showMock.mockResolvedValue(false)

    await expect(
      confirmAndDiscardSubmissionQueue('session-1', () => {
        switchedThread = true
      })
    ).resolves.toBe(false)

    expect(switchedThread).toBe(false)
  })

  it('runs a protected thread-switch action after confirmation and queue cleanup', async () => {
    let switchedThread = false
    getSubmissionQueueStateMock.mockReturnValue({ items: [{ id: 'queued-1' }], status: 'idle' })
    showMock.mockResolvedValue(true)

    await expect(
      confirmAndDiscardSubmissionQueue('session-1', () => {
        switchedThread = true
      })
    ).resolves.toBe(true)

    expect(switchedThread).toBe(true)
    expect(clearSessionSubmissionQueueMock).toHaveBeenCalledWith('session-1')
  })

  it('clears queued messages only after discard confirmation', async () => {
    getSubmissionQueueStateMock.mockReturnValue({ items: [{ id: 'queued-1' }, { id: 'queued-2' }], status: 'idle' })
    showMock.mockResolvedValue(true)

    await expect(confirmAndDiscardSubmissionQueue('session-1')).resolves.toBe(true)

    expect(clearSessionSubmissionQueueMock).toHaveBeenCalledOnce()
    expect(clearSessionSubmissionQueueMock).toHaveBeenCalledWith('session-1')
  })
})
