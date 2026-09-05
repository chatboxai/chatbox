/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  set: vi.fn<(key: string, data: string) => Promise<void>>(),
  remove: vi.fn<(key: string) => Promise<void>>(),
  key: 0,
}))

vi.mock('@/adapters/CurrentBlobStorage', () => ({ currentBlobStorage: mocks }))
vi.mock('@/stores/queryClient', () => ({ queryClient: { setQueryData: vi.fn() } }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn() }) }))
vi.mock('@/storage/StoreStorage', () => ({
  StorageKeyGenerator: { picture: () => `picture:image-creator-ref:${++mocks.key}` },
}))

import { useReferenceImageDraft } from './useReferenceImageDraft'

async function uploadedDraft() {
  const hook = renderHook(() => useReferenceImageDraft())
  act(() => hook.result.current.upload([new File(['image'], 'ref.png', { type: 'image/png' })]))
  await waitFor(() => expect(hook.result.current.images).toHaveLength(1))
  return { ...hook, key: hook.result.current.images[0].storageKey }
}

describe('reference image draft ownership', () => {
  beforeEach(() => {
    mocks.key = 0
    mocks.set.mockReset().mockResolvedValue(undefined)
    mocks.remove.mockReset().mockResolvedValue(undefined)
  })

  it('cleans up an unsubmitted upload when starting a new draft', async () => {
    const { result, key } = await uploadedDraft()
    await act(() => result.current.clear())
    expect(result.current.images).toEqual([])
    expect(mocks.remove).toHaveBeenCalledWith(key)
  })

  it.each(['new', 'remove', 'unmount'] as const)(
    'keeps submitted uploads after %s and durable creation',
    async (action) => {
      const { result, key, unmount } = await uploadedDraft()
      const submission = result.current.beginSubmission()
      if (action === 'new') await act(() => result.current.clear())
      else if (action === 'remove') act(() => result.current.removeReference(key))
      else unmount()
      expect(mocks.remove).not.toHaveBeenCalled()
      submission.commit()
      await submission.rollback()
      expect(mocks.remove).not.toHaveBeenCalled()
    }
  )

  it('restores a selected upload after creation fails so it can be retried or removed', async () => {
    const { result, key } = await uploadedDraft()
    const submission = result.current.beginSubmission()
    await submission.rollback()
    expect(result.current.images).toEqual([{ storageKey: key }])
    expect(mocks.remove).not.toHaveBeenCalled()
    act(() => result.current.removeReference(key))
    expect(mocks.remove).toHaveBeenCalledWith(key)
  })

  it.each(['new', 'remove', 'unmount'] as const)(
    'reclaims submitted uploads after %s and creation failure',
    async (action) => {
      const { result, key, unmount } = await uploadedDraft()
      const submission = result.current.beginSubmission()
      if (action === 'new') await act(() => result.current.clear())
      else if (action === 'remove') act(() => result.current.removeReference(key))
      else unmount()
      await submission.rollback()
      expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(key)
    }
  )

  it('preserves a new draft when a previous submission finishes', async () => {
    const { result } = await uploadedDraft()
    const submission = result.current.beginSubmission()
    await act(() => result.current.clear())
    act(() => result.current.addReference('existing-output', 'parent-record'))
    submission.commit()
    expect(submission.complete()).toBe(false)
    expect(result.current.images).toEqual([{ storageKey: 'existing-output', sourceRecordId: 'parent-record' }])
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('reclaims an upload whose blob write finishes after unmount', async () => {
    let finish: (() => void) | undefined
    mocks.set.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const { result, unmount } = renderHook(() => useReferenceImageDraft())
    act(() => result.current.upload([new File(['image'], 'ref.png', { type: 'image/png' })]))
    await waitFor(() => expect(mocks.set).toHaveBeenCalledOnce())
    unmount()
    finish?.()
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(mocks.set.mock.calls[0][0]))
  })

  it('preserves record-owned references and passes their unique parent IDs to submissions', () => {
    const { result } = renderHook(() => useReferenceImageDraft())
    act(() => {
      result.current.addReference('output-a', 'parent')
      result.current.addReference('output-b', 'parent')
    })
    const submission = result.current.beginSubmission()
    expect(submission.referenceImages).toEqual(['output-a', 'output-b'])
    expect(submission.parentIds).toEqual(['parent'])
    submission.commit()
    act(() => expect(submission.complete()).toBe(true))
    expect(result.current.images).toEqual([])
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
