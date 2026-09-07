// @vitest-environment jsdom

import NiceModal from '@ebay/nice-modal-react'
import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test-utils'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

const mocks = vi.hoisted(() => {
  class VibedropSlugNotOwnedError extends Error {}
  return {
    publishToVibedrop: vi.fn(),
    recordSessionVibedropPublication: vi.fn(),
    setStoredSlug: vi.fn(),
    sessionPublications: [] as Array<{
      slug: string
      url: string
      visibility: 'unlisted' | 'public'
      uniqueId?: string
      updatedAt: number
    }>,
    storedSlug: undefined as string | undefined,
    VibedropSlugNotOwnedError,
  }
})

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

vi.mock('@/modals/settings-navigation', () => ({
  navigateToSettings: vi.fn(),
}))

vi.mock('@/packages/remote', () => ({
  issueVibedropKey: vi.fn(),
}))

vi.mock('@/packages/vibedrop', () => ({
  clearCachedVibedropKey: vi.fn(),
  getCachedVibedropKey: () => 'publish-key',
  getSessionVibedropPublications: () => mocks.sessionPublications,
  getStoredSlug: () => mocks.storedSlug,
  publishToVibedrop: mocks.publishToVibedrop,
  recordSessionVibedropPublication: mocks.recordSessionVibedropPublication,
  setCachedVibedropKey: vi.fn(),
  setStoredSlug: mocks.setStoredSlug,
  VIBEDROP_MANAGE_URL: 'https://app.vibedrop.cc',
  VibedropAuthError: class VibedropAuthError extends Error {},
  VibedropEmailRequiredError: class VibedropEmailRequiredError extends Error {},
  VibedropSlugNotOwnedError: mocks.VibedropSlugNotOwnedError,
}))

vi.mock('@/stores/authInfoStore', () => ({
  useAuthInfoStore: (selector: (state: { accessToken: string; refreshToken: string }) => boolean) =>
    selector({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
}))

import VibedropPublish from './VibedropPublish'

const modalId = 'vibedrop-publish-test'
NiceModal.register(modalId, VibedropPublish)

function showPublishModal(html: string, uniqueId: string, sessionId = 'session-1') {
  act(() => {
    void NiceModal.show(modalId, { html, uniqueId, sessionId })
  })
}

describe('VibedropPublish', () => {
  beforeEach(() => {
    mocks.publishToVibedrop.mockReset()
    mocks.recordSessionVibedropPublication.mockReset()
    mocks.setStoredSlug.mockReset()
    mocks.sessionPublications = []
    mocks.storedSlug = undefined
  })

  test('starts a fresh publish flow after a successful modal is closed', async () => {
    mocks.publishToVibedrop
      .mockResolvedValueOnce({
        slug: 'first-site',
        url: 'https://first-site.vibedrop.site',
        visibility: 'unlisted',
      })
      .mockResolvedValueOnce({
        slug: 'second-site',
        url: 'https://second-site.vibedrop.site',
        visibility: 'unlisted',
      })

    render(
      <MantineProvider>
        <NiceModal.Provider />
      </MantineProvider>
    )

    showPublishModal('<html>first</html>', 'artifact-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    expect(await screen.findByDisplayValue('https://first-site.vibedrop.site')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByDisplayValue('https://first-site.vibedrop.site')).toBeNull()
    })

    showPublishModal('<html>second</html>', 'artifact-2')
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeTruthy()
    expect(screen.queryByDisplayValue('https://first-site.vibedrop.site')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByDisplayValue('https://second-site.vibedrop.site')).toBeTruthy()
    expect(mocks.publishToVibedrop).toHaveBeenLastCalledWith({
      html: '<html>second</html>',
      slug: null,
      vdKey: 'publish-key',
      visibility: 'unlisted',
    })
  })

  test('defaults to a new page when only another artifact in the session was published', async () => {
    mocks.sessionPublications = [
      {
        slug: 'existing-site',
        url: 'https://existing-site.vibedrop.site',
        visibility: 'public',
        uniqueId: 'artifact-1',
        updatedAt: 1,
      },
    ]
    mocks.publishToVibedrop.mockResolvedValue({
      slug: 'new-site',
      url: 'https://new-site.vibedrop.site',
      visibility: 'unlisted',
    })

    render(
      <MantineProvider>
        <NiceModal.Provider />
      </MantineProvider>
    )

    showPublishModal('<html>new artifact</html>', 'artifact-2')
    expect(await screen.findByText('New page')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(mocks.publishToVibedrop).toHaveBeenCalledWith({
        html: '<html>new artifact</html>',
        slug: null,
        vdKey: 'publish-key',
        visibility: 'unlisted',
      })
    })
  })

  test('can explicitly replace another page published from the same session', async () => {
    mocks.sessionPublications = [
      {
        slug: 'existing-site',
        url: 'https://existing-site.vibedrop.site',
        visibility: 'public',
        uniqueId: 'artifact-1',
        updatedAt: 1,
      },
    ]
    mocks.publishToVibedrop.mockResolvedValue({
      slug: 'existing-site',
      url: 'https://existing-site.vibedrop.site',
      visibility: 'public',
    })

    render(
      <MantineProvider>
        <NiceModal.Provider />
      </MantineProvider>
    )

    showPublishModal('<html>replacement</html>', 'artifact-2')
    fireEvent.click(await screen.findByText('Update page'))
    expect(await screen.findByDisplayValue('https://existing-site.vibedrop.site')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(mocks.publishToVibedrop).toHaveBeenCalledWith({
        html: '<html>replacement</html>',
        slug: 'existing-site',
        vdKey: 'publish-key',
        visibility: 'public',
      })
    })
    expect(mocks.recordSessionVibedropPublication).toHaveBeenCalledWith(
      'session-1',
      'artifact-2',
      expect.objectContaining({ slug: 'existing-site' })
    )
  })

  test('defaults to updating the page already linked to the same artifact', async () => {
    mocks.storedSlug = 'existing-site'
    mocks.sessionPublications = [
      {
        slug: 'existing-site',
        url: 'https://existing-site.vibedrop.site',
        visibility: 'public',
        uniqueId: 'artifact-1',
        updatedAt: 1,
      },
    ]
    mocks.publishToVibedrop.mockResolvedValue({
      slug: 'existing-site',
      url: 'https://existing-site.vibedrop.site',
      visibility: 'public',
    })

    render(
      <MantineProvider>
        <NiceModal.Provider />
      </MantineProvider>
    )

    showPublishModal('<html>same artifact</html>', 'artifact-1')
    expect(await screen.findByDisplayValue('https://existing-site.vibedrop.site')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(mocks.publishToVibedrop).toHaveBeenCalledWith({
        html: '<html>same artifact</html>',
        slug: 'existing-site',
        vdKey: 'publish-key',
        visibility: 'public',
      })
    })
  })

  test('can publish the same artifact as a new page when explicitly selected', async () => {
    mocks.storedSlug = 'existing-site'
    mocks.sessionPublications = [
      {
        slug: 'existing-site',
        url: 'https://existing-site.vibedrop.site',
        visibility: 'public',
        uniqueId: 'artifact-1',
        updatedAt: 1,
      },
    ]
    mocks.publishToVibedrop.mockResolvedValue({
      slug: 'new-site',
      url: 'https://new-site.vibedrop.site',
      visibility: 'unlisted',
    })

    render(
      <MantineProvider>
        <NiceModal.Provider />
      </MantineProvider>
    )

    showPublishModal('<html>same artifact, new page</html>', 'artifact-1')
    fireEvent.click(await screen.findByText('New page'))
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(mocks.publishToVibedrop).toHaveBeenCalledWith({
        html: '<html>same artifact, new page</html>',
        slug: null,
        vdKey: 'publish-key',
        visibility: 'unlisted',
      })
    })
  })

  test('does not silently create a new page when the selected update target is unavailable', async () => {
    mocks.storedSlug = 'unavailable-site'
    mocks.sessionPublications = [
      {
        slug: 'unavailable-site',
        url: 'https://unavailable-site.vibedrop.site',
        visibility: 'public',
        uniqueId: 'artifact-1',
        updatedAt: 1,
      },
    ]
    mocks.publishToVibedrop.mockRejectedValueOnce(new mocks.VibedropSlugNotOwnedError()).mockResolvedValueOnce({
      slug: 'new-site',
      url: 'https://new-site.vibedrop.site',
      visibility: 'unlisted',
    })

    render(
      <MantineProvider>
        <NiceModal.Provider />
      </MantineProvider>
    )

    showPublishModal('<html>replacement</html>', 'artifact-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    expect(
      await screen.findByText('This page can no longer be updated. Publish it as a new page instead.')
    ).toBeTruthy()
    expect(mocks.publishToVibedrop).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(mocks.publishToVibedrop).toHaveBeenLastCalledWith({
        html: '<html>replacement</html>',
        slug: null,
        vdKey: 'publish-key',
        visibility: 'unlisted',
      })
    })
  })

  test('keeps legacy artifact slug mappings updateable before session history exists', async () => {
    mocks.storedSlug = 'legacy-site'
    mocks.publishToVibedrop.mockResolvedValue({
      slug: 'legacy-site',
      url: 'https://legacy-site.vibedrop.site',
      visibility: 'unlisted',
    })

    render(
      <MantineProvider>
        <NiceModal.Provider />
      </MantineProvider>
    )

    showPublishModal('<html>legacy artifact</html>', 'artifact-1')
    expect(await screen.findByText('Update page')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(mocks.publishToVibedrop).toHaveBeenCalledWith({
        html: '<html>legacy artifact</html>',
        slug: 'legacy-site',
        vdKey: 'publish-key',
        visibility: 'unlisted',
      })
    })
  })
})
