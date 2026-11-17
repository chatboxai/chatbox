// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FileEditPreview } from './FileEditPreview'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
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
afterEach(cleanup)
it('mounts the continuous preview on expansion and unmounts on collapse', () => {
  const preview = '@@ -1,150 +1,150 @@\n' + Array.from({ length: 150 }, (_, i) => `+row-${i}`).join('\n')
  const { container } = render(
    <MantineProvider>
      <FileEditPreview preview={preview} />
    </MantineProvider>
  )
  const details = container.querySelector('details')!
  expect(container.querySelector('pre')).toBeNull()
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(container.querySelectorAll('pre span')).toHaveLength(151)
  expect(screen.getByText('+row-0')).toBeTruthy()
  expect(screen.getByText('+row-149')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
  details.open = false
  fireEvent(details, new Event('toggle'))
  expect(container.querySelector('pre')).toBeNull()
})
it('bounds imported previews and warns before showing partial content', () => {
  const { container } = render(
    <MantineProvider>
      <FileEditPreview preview={'x'.repeat(100_000)} />
    </MantineProvider>
  )
  container.querySelector('details')!.open = true
  fireEvent(container.querySelector('details')!, new Event('toggle'))
  expect(container.querySelector('pre')?.textContent?.length).toBeLessThanOrEqual(8000)
  expect(screen.getByText(/Review the file before approving/)).toBeTruthy()
})

it('shows a skipped-preview notice directly when there is no diff to expand', () => {
  const { container } = render(
    <MantineProvider>
      <FileEditPreview preview="" incomplete />
    </MantineProvider>
  )
  expect(container.querySelector('details')).toBeNull()
  expect(container.querySelector('pre')).toBeNull()
  expect(screen.getByText(/Review the file before approving/)).toBeTruthy()
})
