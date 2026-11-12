// @vitest-environment jsdom

import type { Message } from '@shared/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { calculateAttachmentTokens } from '../attachment-computation'
import { useDraftAttachmentTokens } from './useDraftAttachmentTokens'

vi.mock('../attachment-computation', () => ({ calculateAttachmentTokens: vi.fn() }))
it('resolves an unsaved draft attachment without a session and reuses it while typing', async () => {
  let complete: ((value: Awaited<ReturnType<typeof calculateAttachmentTokens>>) => void) | undefined
  vi.mocked(calculateAttachmentTokens).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const file = { id: 'f', name: 'draft.txt', storageKey: 'blob', fileType: 'text/plain' }
  const message: Message = { id: 'unsaved', role: 'user', contentParts: [], files: [file] }
  const view = renderHook(({ message }) => useDraftAttachmentTokens(message, 'default', false), {
    initialProps: { message },
  })
  expect(view.result.current.isCalculating).toBe(true)
  act(() =>
    complete?.({
      success: true,
      result: {
        type: 'attachment',
        sessionId: 'new',
        messageId: 'unsaved',
        tokenizerType: 'default',
        tokens: 123,
        calculatedAt: 0,
      },
    })
  )
  await waitFor(() => expect(view.result.current.tokens).toBe(123))
  view.rerender({
    message: { ...message, files: [{ ...file }], contentParts: [{ type: 'text', text: 'more typing' }] },
  })
  expect(view.result.current).toMatchObject({ tokens: 123, isCalculating: false, isApproximate: false })
  expect(calculateAttachmentTokens).toHaveBeenCalledTimes(1)
  view.unmount()
})
