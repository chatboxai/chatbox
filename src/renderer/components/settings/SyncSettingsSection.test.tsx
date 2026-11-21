// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { type DesktopSyncApi, defaultSyncPreferences, SyncIpcChannels } from '@shared/sync'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { platformMock } = vi.hoisted(() => ({
  platformMock: { sync: undefined as DesktopSyncApi | undefined, ipc: { invoke: vi.fn() } },
}))

vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})
vi.mock('@/platform', () => ({ default: platformMock }))
vi.mock('@/app/renderer-backup', () => ({ rendererBackupService: {} }))

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

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)

describe('SyncSettingsSection', () => {
  let SyncSettingsSection: typeof import('./SyncSettingsSection').SyncSettingsSection

  beforeEach(async () => {
    vi.resetModules()
    platformMock.ipc.invoke.mockReset()
    let preferences = { ...defaultSyncPreferences, mode: 'window-close' as const }
    const { invoke } = platformMock.ipc
    invoke.mockImplementation((channel, input) => {
      if (channel === SyncIpcChannels.PREFERENCES_SET) {
        preferences = { ...preferences, ...input }
        return Promise.resolve(preferences)
      }
      if (channel === SyncIpcChannels.BAIDU_STATUS) {
        return Promise.resolve({ success: true, account: { authenticated: false } })
      }
    })
    platformMock.sync = {
      getBaiduAccount: () => invoke(SyncIpcChannels.BAIDU_STATUS),
      signInToBaidu: (input) => invoke(SyncIpcChannels.BAIDU_LOGIN, input),
      cancelBaiduLogin: () => invoke(SyncIpcChannels.BAIDU_CANCEL_LOGIN),
      signOutOfBaidu: () => invoke(SyncIpcChannels.BAIDU_LOGOUT),
      configureWebDav: (input) => invoke(SyncIpcChannels.WEBDAV_CONFIGURE, input),
      readSavedSecret: (input) => invoke(SyncIpcChannels.READ_SAVED_SECRET, input),
      getPreferences: async () => preferences,
      setPreferences: (input) => invoke(SyncIpcChannels.PREFERENCES_SET, input),
      download: (input) => invoke(SyncIpcChannels.CLOUD_DOWNLOAD, input),
      upload: (input) => invoke(SyncIpcChannels.CLOUD_UPLOAD, input),
      recordCompletion: (input) => invoke(SyncIpcChannels.SYNC_RESULT, input),
      setWindowCloseReady: async () => {},
      onWindowCloseRequested: () => () => {},
      completeWindowClose: async () => {},
    }
    ;({ SyncSettingsSection } = await import('./SyncSettingsSection'))
  })

  async function enableSync() {
    const control = screen.getByRole<HTMLInputElement>('switch', { name: 'Enable synchronization' })
    await waitFor(() => expect(control.disabled).toBe(false))
    await act(() => {
      fireEvent.click(control)
    })
  }

  it('disables dependent controls until synchronization is enabled', async () => {
    render(
      <MantineProvider>
        <SyncSettingsSection />
      </MantineProvider>
    )

    expect((screen.getByRole('textbox', { name: 'Synchronization service' }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Baidu AppKey') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Baidu SecretKey') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByLabelText('Authorization callback URL')).toBeNull()
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: 'End-to-end encryption' }) as HTMLInputElement).disabled).toBe(true)

    await enableSync()

    expect((screen.getByRole('textbox', { name: 'Synchronization service' }) as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('Baidu AppKey') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('Baidu SecretKey') as HTMLInputElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Baidu AppKey'), { target: { value: 'app-key' } })
    fireEvent.change(screen.getByLabelText('Baidu SecretKey'), { target: { value: 'secret-key' } })
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('switch', { name: 'End-to-end encryption' }) as HTMLInputElement).disabled).toBe(false)
  })

  it('shows the token field only when end-to-end encryption is enabled', async () => {
    render(
      <MantineProvider>
        <SyncSettingsSection />
      </MantineProvider>
    )

    expect(screen.queryByLabelText('Token')).toBeNull()
    await enableSync()
    await act(() => {
      fireEvent.click(screen.getByRole('switch', { name: 'End-to-end encryption' }))
    })
    expect(await screen.findByLabelText('Token')).toBeTruthy()
  })

  it('cancels an active Baidu login', async () => {
    let cancelLogin: (() => void) | undefined
    platformMock.ipc.invoke.mockImplementation((channel: string) => {
      if (channel === SyncIpcChannels.BAIDU_STATUS) {
        return Promise.resolve({
          success: true,
          account: { authenticated: false },
          configuration: { clientSecretConfigured: false },
        })
      }
      if (channel === SyncIpcChannels.BAIDU_LOGIN) {
        return new Promise((resolve) => {
          cancelLogin = () => resolve({ success: false, error: 'login_cancelled' })
        })
      }
      if (channel === SyncIpcChannels.BAIDU_CANCEL_LOGIN) {
        cancelLogin?.()
        return Promise.resolve({ success: true })
      }
      if (channel === SyncIpcChannels.PREFERENCES_SET) {
        return Promise.resolve({ ...defaultSyncPreferences, enabled: true, mode: 'window-close' })
      }
      return Promise.reject(new Error(`Unexpected IPC channel: ${channel}`))
    })

    render(
      <MantineProvider>
        <SyncSettingsSection />
      </MantineProvider>
    )

    await waitFor(() => expect(platformMock.ipc.invoke).toHaveBeenCalledWith(SyncIpcChannels.BAIDU_STATUS))
    await enableSync()
    fireEvent.change(screen.getByLabelText('Baidu AppKey'), { target: { value: 'app-key' } })
    fireEvent.change(screen.getByLabelText('Baidu SecretKey'), { target: { value: 'secret-key' } })
    const signInButton = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement
    await waitFor(() => expect(signInButton.disabled).toBe(false))
    fireEvent.click(signInButton)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(platformMock.ipc.invoke).toHaveBeenCalledWith(SyncIpcChannels.BAIDU_CANCEL_LOGIN))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull())
  })

  it('tests and saves WebDAV using the server and account fields', async () => {
    let preferences = {
      ...defaultSyncPreferences,
      mode: 'window-close' as const,
    }
    platformMock.ipc.invoke.mockImplementation((channel: string, input: object) => {
      if (channel === SyncIpcChannels.BAIDU_STATUS) {
        return Promise.resolve({ success: true, account: { authenticated: false } })
      }
      if (channel === SyncIpcChannels.PREFERENCES_SET) {
        preferences = { ...preferences, ...input }
        return Promise.resolve(preferences)
      }
      if (channel === SyncIpcChannels.WEBDAV_CONFIGURE) {
        return Promise.resolve({
          success: true,
          preferences: {
            ...preferences,
            webdav: { id: 'target', url: 'https://example.test/dav/', username: 'user', passwordConfigured: true },
          },
        })
      }
      if (channel === SyncIpcChannels.READ_SAVED_SECRET) return Promise.resolve('stored-password')
      return Promise.reject(new Error(`Unexpected IPC channel: ${channel}`))
    })

    const view = render(
      <MantineProvider>
        <SyncSettingsSection />
      </MantineProvider>
    )
    await enableSync()
    const service = screen.getByRole('textbox', { name: 'Synchronization service' })
    await waitFor(() => expect((service as HTMLInputElement).disabled).toBe(false))
    fireEvent.click(service)
    fireEvent.click(await screen.findByRole('option', { name: 'WebDAV' }))

    expect(screen.queryByLabelText('Baidu AppKey')).toBeNull()
    expect(screen.queryByRole('textbox', { name: /remote directory/i })).toBeNull()
    fireEvent.change(screen.getByLabelText('WebDAV server URL'), { target: { value: 'https://example.test/dav/' } })
    fireEvent.change(screen.getByLabelText('WebDAV username'), { target: { value: 'user' } })
    fireEvent.change(screen.getByLabelText('WebDAV password or app password'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test and save' }))

    await waitFor(() =>
      expect(platformMock.ipc.invoke).toHaveBeenCalledWith(SyncIpcChannels.WEBDAV_CONFIGURE, {
        url: 'https://example.test/dav/',
        username: 'user',
        password: 'password',
      })
    )
    expect(await screen.findByText('WebDAV connection verified and saved.')).toBeTruthy()
    expect((screen.getByLabelText('WebDAV password or app password') as HTMLInputElement).value).toBe('')
    view.unmount()

    render(
      <MantineProvider>
        <SyncSettingsSection />
      </MantineProvider>
    )
    expect(await screen.findByDisplayValue('https://example.test/dav/')).toBeTruthy()
    expect(screen.getByDisplayValue('user')).toBeTruthy()
    expect(screen.getByText('Saved on this device')).toBeTruthy()
    expect(platformMock.ipc.invoke).not.toHaveBeenCalledWith(SyncIpcChannels.READ_SAVED_SECRET, expect.anything())

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Show credential' }))
    expect(await screen.findByDisplayValue('stored-password')).toBeTruthy()
    expect(platformMock.ipc.invoke).toHaveBeenCalledWith(SyncIpcChannels.READ_SAVED_SECRET, {
      kind: 'webdav-password',
      id: 'target',
    })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Hide credential' }), { key: ' ' })
    expect(screen.queryByDisplayValue('stored-password')).toBeNull()
  })
})
