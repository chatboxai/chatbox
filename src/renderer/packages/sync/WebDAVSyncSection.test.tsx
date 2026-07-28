// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

const mocks = vi.hoisted(() => ({
  flushItem: vi.fn(async () => undefined),
  previewWebDAVUpload: vi.fn(async () => ({
    localCount: 1,
    remoteCount: 2,
    remoteOnlyCount: 1,
    willRemoveRemoteCount: 1,
    remoteMissing: false,
  })),
  testWebDAVConnection: vi.fn(async () => ({ snapshotExists: false, encryptionVerified: false })),
  toastSuccess: vi.fn(),
  uploadWebDAVSnapshot: vi.fn(async () => ({ uploaded: 1, lastSyncedAt: '2026-07-23T00:00:00.000Z' })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce((result, [name, value]) => result.replace(`{{${name}}}`, String(value)), key),
  }),
}))

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }))
vi.mock('@/components/AdaptiveSelect', () => ({ AdaptiveSelect: () => null }))
vi.mock('@/components/common/LazySlider', () => ({ default: () => null }))
vi.mock('@/components/common/AdaptiveModal', async () => {
  const React = await import('react')
  const AdaptiveModal = ({ opened, title, children }: { opened: boolean; title: ReactNode; children: ReactNode }) =>
    opened ? React.createElement('div', null, title, children) : null
  AdaptiveModal.Actions = ({ children }: { children: ReactNode }) => React.createElement('div', null, children)
  return { AdaptiveModal }
})
vi.mock('@/i18n/locales', () => ({ languageNameMap: {}, languages: [] }))
vi.mock('@/packages/settings-export', () => ({ sanitizeSettingsForExport: (settings: unknown) => settings }))
vi.mock('@/packages/sync/local', () => ({ createDefaultWebDAVSyncDeps: () => ({}) }))
vi.mock('@/packages/sync/service', () => ({
  downloadAndMergeWebDAVSnapshot: vi.fn(),
  previewWebDAVUpload: mocks.previewWebDAVUpload,
  testWebDAVConnection: mocks.testWebDAVConnection,
  uploadWebDAVSnapshot: mocks.uploadWebDAVSnapshot,
}))
vi.mock('@/packages/toast', () => ({ toastError: vi.fn() }))
vi.mock('@/platform', () => ({
  default: { type: 'desktop', exporter: {}, getDeviceName: vi.fn() },
}))
vi.mock('@/storage', () => ({
  default: {
    flushItem: mocks.flushItem,
    getAllKeys: vi.fn(async () => []),
    getItem: vi.fn(),
  },
  StorageKey: { Settings: 'settings' },
}))
vi.mock('@/stores/chatStore', () => ({ getMetaStorage: vi.fn(), recoverSessionList: vi.fn() }))
vi.mock('@/stores/migration', () => ({ migrateOnData: vi.fn() }))
vi.mock('@/stores/settingsStore', async () => {
  const { createStore, useStore } = await import('zustand')
  const sync = {
    provider: 'webdav' as const,
    webdav: {
      url: 'https://dav.example.com/',
      username: 'alice',
      password: 'password',
      syncPassword: 'sync-password',
    },
    lastSyncedAt: undefined,
  }
  const store = createStore(() => ({
    sync,
    setSettings: vi.fn(),
    getSettings: () => ({ sync }),
  }))
  return {
    settingsStore: store,
    useSettingsStore: (selector: (state: ReturnType<typeof store.getState>) => unknown) => useStore(store, selector),
  }
})

import { WebDAVSyncSection } from '@/routes/settings/general'

function renderSection() {
  return render(
    <MantineProvider>
      <WebDAVSyncSection />
    </MantineProvider>
  )
}

describe('WebDAVSyncSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without an unstable Zustand selector loop', () => {
    renderSection()

    expect(screen.getByText('Manual WebDAV Sync')).toBeTruthy()
    expect(screen.queryByText('Enable WebDAV sync')).toBeNull()
  })

  it('flushes settings before testing and explains when encryption cannot be verified', async () => {
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => expect(mocks.testWebDAVConnection).toHaveBeenCalledTimes(1))
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Connection successful; no remote snapshot exists to verify the encryption password'
    )
    expect(mocks.flushItem).toHaveBeenCalledWith('settings')
    expect(mocks.flushItem.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.testWebDAVConnection.mock.invocationCallOrder[0]
    )
  })

  it('requires confirmation before removing remote-only conversations', async () => {
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Merge and Upload' }))

    expect(await screen.findByText('Replace remote conversations?')).toBeTruthy()
    expect(mocks.uploadWebDAVSnapshot).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Replace Remote Snapshot' }))

    await waitFor(() => expect(mocks.uploadWebDAVSnapshot).toHaveBeenCalledTimes(1))
  })
})
