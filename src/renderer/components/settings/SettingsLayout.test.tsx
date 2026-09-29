// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingRow, SettingSwitchRow } from './SettingsLayout'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

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

describe('SettingSwitchRow', () => {
  it('toggles the switch when its label is clicked', () => {
    const onChange = vi.fn()
    render(
      <MantineProvider>
        <SettingSwitchRow label="Improve Network Compatibility" checked={false} onChange={onChange} />
      </MantineProvider>
    )
    fireEvent.click(screen.getByText('Improve Network Compatibility'))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('switch', { name: 'Improve Network Compatibility' })).toBeTruthy()
  })
})

describe('SettingRow', () => {
  it('ties the label to a field passed as a function of its id', () => {
    render(
      <MantineProvider>
        <SettingRow label="Network Proxy" control={(id) => <input id={id} />} />
      </MantineProvider>
    )
    expect(screen.getByLabelText('Network Proxy').tagName).toBe('INPUT')
  })

  it('leaves the label unattached to controls passed as they are', () => {
    const onClick = vi.fn()
    render(
      <MantineProvider>
        <SettingRow
          label="Archived Chats"
          control={
            <button type="button" onClick={onClick}>
              View
            </button>
          }
        />
      </MantineProvider>
    )
    fireEvent.click(screen.getByText('Archived Chats'))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByText('Archived Chats').tagName).not.toBe('LABEL')
  })
})
