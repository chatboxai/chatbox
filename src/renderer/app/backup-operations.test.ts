import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  controller: new AbortController(),
  flush: vi.fn<() => Promise<void>>(),
}))

vi.mock('@chatbox/core/generation', () => ({ waitForSessionGenerations: vi.fn(async () => {}) }))
vi.mock('@/adapters/RendererStoragePersistence', () => ({ flushRendererStorageWrites: mocks.flush }))
vi.mock('@/adapters/session-work-lock', () => ({
  withBackupWorkAccess: (action: () => Promise<unknown>) => action(),
}))
vi.mock('./renderer-application', () => ({
  rendererApplication: {
    backupOperations: {
      run: (_kind: string, action: (signal: AbortSignal) => Promise<unknown>) => action(mocks.controller.signal),
    },
    generationRuntime: { waitForIdle: vi.fn(async () => {}) },
    settings: { flushPersistence: vi.fn(async () => {}) },
  },
}))

import { runRendererBackupOperation } from './backup-operations'

beforeEach(() => {
  mocks.controller = new AbortController()
  mocks.flush.mockReset()
})

test('backup waits for accepted storage writes to finish', async () => {
  let finishWrites: () => void = () => {}
  const writes = new Promise<void>((resolve) => {
    finishWrites = resolve
  })
  mocks.flush.mockReturnValue(writes)
  const action = vi.fn(async () => 'saved')
  const result = runRendererBackupOperation('export', action)
  await vi.waitFor(() => expect(mocks.flush).toHaveBeenCalledOnce())
  expect(action).not.toHaveBeenCalled()
  finishWrites()
  await expect(result).resolves.toBe('saved')
  expect(action).toHaveBeenCalledExactlyOnceWith(mocks.controller.signal)
})

test('a failed write prevents backup from starting', async () => {
  mocks.flush.mockRejectedValue(new Error('Disk full'))
  const action = vi.fn(async () => {})
  await expect(runRendererBackupOperation('export', action)).rejects.toThrow('Disk full')
  expect(action).not.toHaveBeenCalled()
})

test('cancelling while writes finish prevents backup from starting', async () => {
  mocks.flush.mockImplementation(async () => {
    mocks.controller.abort()
  })
  const action = vi.fn(async () => {})
  await expect(runRendererBackupOperation('export', action)).rejects.toThrow()
  expect(action).not.toHaveBeenCalled()
})
