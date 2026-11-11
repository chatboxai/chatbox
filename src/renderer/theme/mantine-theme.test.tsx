// @vitest-environment jsdom

import { Combobox, HoverCard, MantineProvider, Menu, Popover, Select, useCombobox } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GLASS_SURFACE_CLASS } from '@/lib/glass-surface'
import { creteMantineTheme } from './mantine-theme'

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
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)
window.HTMLElement.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

function renderWithTheme(node: ReactNode) {
  return render(<MantineProvider theme={creteMantineTheme()}>{node}</MantineProvider>)
}

function OpenCombobox() {
  const store = useCombobox({ opened: true })
  return (
    <Combobox store={store}>
      <Combobox.Target>
        <button type="button">target</button>
      </Combobox.Target>
      <Combobox.Dropdown data-testid="dropdown">
        <Combobox.Options>
          <Combobox.Option value="a">A</Combobox.Option>
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}

describe('Mantine dropdowns under the app theme', () => {
  it.each([
    [
      'Popover',
      <Popover key="popover" opened>
        <Popover.Target>
          <button type="button">target</button>
        </Popover.Target>
        <Popover.Dropdown data-testid="dropdown">content</Popover.Dropdown>
      </Popover>,
    ],
    [
      'Menu',
      <Menu key="menu" opened>
        <Menu.Target>
          <button type="button">target</button>
        </Menu.Target>
        <Menu.Dropdown data-testid="dropdown">
          <Menu.Item>item</Menu.Item>
        </Menu.Dropdown>
      </Menu>,
    ],
    [
      'HoverCard',
      <HoverCard key="hovercard" initiallyOpened>
        <HoverCard.Target>
          <button type="button">target</button>
        </HoverCard.Target>
        <HoverCard.Dropdown data-testid="dropdown">content</HoverCard.Dropdown>
      </HoverCard>,
    ],
    ['Combobox', <OpenCombobox key="combobox" />],
  ])('marks the %s dropdown as a glass surface', async (_name, node) => {
    renderWithTheme(node)
    const dropdown = await screen.findByTestId('dropdown')
    expect(dropdown.classList).toContain(GLASS_SURFACE_CLASS)
  })

  it('marks the Select dropdown as a glass surface', async () => {
    renderWithTheme(<Select data={['A']} dropdownOpened comboboxProps={{ transitionProps: { duration: 0 } }} />)
    const option = await screen.findByRole('option', { name: 'A' })
    expect(option.closest(`.${GLASS_SURFACE_CLASS}`)).not.toBeNull()
  })
})
