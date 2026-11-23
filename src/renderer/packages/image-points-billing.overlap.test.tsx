// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import NiceModal from '@ebay/nice-modal-react'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmModal from '@/modals/ConfirmModal'
import { authorizeImagePoints } from './image-points-billing'
import { confirmWorkAction } from './mobile-work-mode/confirmation'

const viewport = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => viewport.mobile }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key, language: 'en' } }))
vi.mock('@/components/common/Link', () => ({ default: () => null }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({ licenseKey: 'overlap-license', language: 'en' }),
    setState: vi.fn(),
    subscribe: () => () => undefined,
  },
}))
vi.mock('@/packages/remote', () => ({
  buildChatboxUrl: (path: string) => `https://chatboxai.app${path}`,
  getLicenseDetailRealtime: async () => ({
    data: {
      plan: 'pro',
      image_total_quota: 100,
      image_used_count: 100,
      unified_token_usage_details: [{ token_limit: 100000, token_usage: 0 }],
      expansion_pack_limit: 0,
      expansion_pack_usage: 0,
    },
  }),
  getChatboxAIModelList: async () => ({ imageModels: [{ modelId: 'image', points_per_image: 27000 }] }),
}))

const imageTitle = 'Use compute points to generate images?'
const workTitle = 'Calendar access'
const imageParams = { prompt: 'cat', referenceImages: [], model: { provider: 'chatbox-ai', modelId: 'image' } }
const workProps = { title: workTitle, message: 'Allow calendar access?', confirmText: 'Allow' }

beforeEach(() => {
  viewport.mobile = false
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  localStorage.clear()
  NiceModal.register('confirm', ConfirmModal)
  NiceModal.register('image-points-confirm', ConfirmModal)
  render(
    <MantineProvider>
      <NiceModal.Provider />
    </MantineProvider>
  )
})

afterEach(() => {
  act(() => {
    for (const id of ['confirm', 'image-points-confirm']) NiceModal.remove(id)
  })
  cleanup()
  vi.unstubAllGlobals()
})

function finishDrawerClose() {
  // jsdom does not run CSS exit animations.
  const drawer = document.querySelector('[data-vaul-drawer][data-state="closed"]')
  if (drawer)
    fireEvent(drawer, Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'slideToBottom' }))
}

function dialog(title: string) {
  return screen.getByRole('dialog', { name: title })
}

describe('overlapping image and work confirmations', () => {
  it.each([
    ['image', false],
    ['work', false],
    ['image', true],
    ['work', true],
  ] as const)('requires separate consent when %s opens first (mobile: %s)', async (first, mobile) => {
    viewport.mobile = mobile
    const submit = vi.fn()
    const workDone = vi.fn()
    let image!: Promise<void>
    let work!: Promise<boolean>
    const startImage = async () => {
      act(() => {
        image = authorizeImagePoints(imageParams, new AbortController().signal, true).then(submit)
      })
      await screen.findByRole('dialog', { name: imageTitle })
    }
    const startWork = async () => {
      act(() => {
        work = confirmWorkAction(workProps).then((result) => {
          workDone(result)
          return result
        })
      })
      await screen.findByRole('dialog', { name: workTitle })
    }
    if (first === 'image') {
      await startImage()
      await startWork()
    } else {
      await startWork()
      await startImage()
    }
    if (first === 'image') {
      fireEvent.click(within(dialog(workTitle)).getByRole('button', { name: 'Allow' }))
      await expect(work).resolves.toBe(true)
      finishDrawerClose()
      expect(submit).not.toHaveBeenCalled()
      expect(localStorage.length).toBe(0)
      fireEvent.click(
        within(await screen.findByRole('dialog', { name: imageTitle })).getByRole('button', {
          name: 'Continue generating',
        })
      )
    } else {
      fireEvent.click(within(dialog(imageTitle)).getByRole('button', { name: 'Continue generating' }))
      await image
      finishDrawerClose()
      expect(workDone).not.toHaveBeenCalled()
      fireEvent.click(
        within(await screen.findByRole('dialog', { name: workTitle })).getByRole('button', { name: 'Allow' })
      )
      await expect(work).resolves.toBe(true)
    }
    await image
    expect(submit).toHaveBeenCalledOnce()
    expect(localStorage.length).toBe(0)
  })

  it('aborting the image request leaves the work confirmation pending', async () => {
    const controller = new AbortController()
    const submit = vi.fn()
    const workDone = vi.fn()
    const image = authorizeImagePoints(imageParams, controller.signal, true).then(submit)
    const rejected = expect(image).rejects.toMatchObject({ name: 'AbortError' })
    await screen.findByRole('dialog', { name: imageTitle })
    const work = confirmWorkAction(workProps).then((result) => {
      workDone(result)
      return result
    })
    await screen.findByRole('dialog', { name: workTitle })
    act(() => controller.abort())
    await rejected
    expect(submit).not.toHaveBeenCalled()
    expect(workDone).not.toHaveBeenCalled()
    fireEvent.click(within(dialog(workTitle)).getByRole('button', { name: 'Allow' }))
    await expect(work).resolves.toBe(true)
    expect(localStorage.length).toBe(0)
  })

  it('aborting work leaves image consent pending and allows the user to decline it', async () => {
    const controller = new AbortController()
    const submit = vi.fn()
    const work = confirmWorkAction(workProps, controller.signal)
    const rejectedWork = expect(work).rejects.toMatchObject({ name: 'AbortError' })
    await screen.findByRole('dialog', { name: workTitle })
    const image = authorizeImagePoints(imageParams, new AbortController().signal, true).then(submit)
    const rejectedImage = expect(image).rejects.toMatchObject({ name: 'AbortError' })
    await screen.findByRole('dialog', { name: imageTitle })
    act(() => controller.abort())
    await rejectedWork
    await waitFor(() => expect(screen.queryByRole('dialog', { name: workTitle })).toBeNull())
    expect(submit).not.toHaveBeenCalled()
    fireEvent.click(within(dialog(imageTitle)).getByRole('button', { name: 'Cancel' }))
    await rejectedImage
    expect(submit).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })
})
