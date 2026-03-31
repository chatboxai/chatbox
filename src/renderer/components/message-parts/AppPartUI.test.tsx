/** @vitest-environment jsdom */

import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { AppPartUI } from './AppPartUI'

describe('AppPartUI', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  })

  it('renders app lifecycle metadata as a host-owned status card', () => {
    render(
      <MantineProvider>
        <AppPartUI
          part={{
            type: 'app',
            appId: 'story-builder',
            appName: 'Story Builder',
            appInstanceId: 'instance-1',
            lifecycle: 'active',
            summary: 'Restored the active story draft and preserved the exportable checkpoint.',
          }}
        />
      </MantineProvider>
    )

    expect(screen.getByRole('status', { name: 'Story Builder Active' })).toBeTruthy()
    expect(screen.getByText('Restored the active story draft and preserved the exportable checkpoint.')).toBeTruthy()
  })

  it('shows explicit error details when an app lifecycle part reports failure', () => {
    render(
      <MantineProvider>
        <AppPartUI
          part={{
            type: 'app',
            appId: 'story-builder',
            appInstanceId: 'instance-2',
            lifecycle: 'error',
            error: 'Bridge session expired before resume completed.',
          }}
        />
      </MantineProvider>
    )

    expect(screen.getByRole('status', { name: 'story-builder Error' })).toBeTruthy()
    expect(screen.getByText('story-builder error: Bridge session expired before resume completed.')).toBeTruthy()
    expect(screen.getByText('Bridge session expired before resume completed.')).toBeTruthy()
  })
})
