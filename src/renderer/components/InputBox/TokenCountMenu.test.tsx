// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TokenCountMenu from './TokenCountMenu'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => false,
}))

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

function renderMenu(props: Partial<React.ComponentProps<typeof TokenCountMenu>> = {}) {
  return render(
    <MantineProvider>
      <TokenCountMenu
        currentInputTokens={100}
        contextTokens={1000}
        totalTokens={1100}
        totalContextMessages={3}
        {...props}
      >
        <button type="button">Tokens</button>
      </TokenCountMenu>
    </MantineProvider>
  )
}

function getMenuRow(label: string): HTMLElement {
  const labelElement = screen.getByText(`${label}:`)
  const row = labelElement.parentElement
  if (!row) throw new Error(`Missing ${label} row`)
  return row
}

describe('TokenCountMenu', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps cached context exact while only the draft is calculating', () => {
    renderMenu({
      isCalculating: true,
      isContextCalculating: false,
      pendingContextMessages: 0,
    })

    expect(getMenuRow('Context').textContent).toContain('Context:1K')
    expect(getMenuRow('Context').textContent).not.toContain('~')
    expect(getMenuRow('Context').textContent).not.toContain('(3/3)')
    expect(getMenuRow('Total').textContent).toContain('Total:~1K')
    expect(getMenuRow('Total').querySelector('.mantine-Loader-root')).not.toBeNull()
  })

  it('shows context progress from distinct pending context messages', () => {
    renderMenu({
      isCalculating: true,
      isContextCalculating: true,
      pendingContextMessages: 1,
    })

    expect(getMenuRow('Context').textContent).toContain('Context:~1K(2/3)')
  })

  it('keeps failed draft estimates marked approximate without showing a loader', () => {
    renderMenu({
      isCalculating: false,
      isCurrentInputApproximate: true,
      isTotalApproximate: true,
      isContextCalculating: false,
      pendingContextMessages: 0,
    })

    expect(getMenuRow('Current input').textContent).toContain('Current input:~100')
    expect(getMenuRow('Context').textContent).toContain('Context:1K')
    expect(getMenuRow('Context').textContent).not.toContain('~')
    expect(getMenuRow('Total').textContent).toContain('Total:~1K')
    expect(getMenuRow('Total').querySelector('.mantine-Loader-root')).toBeNull()
  })
})
