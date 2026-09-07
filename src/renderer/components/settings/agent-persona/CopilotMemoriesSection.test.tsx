// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test-utils'

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

const mocks = vi.hoisted(() => ({
  clearCopilotMemories: vi.fn(),
  deleteCopilotMemory: vi.fn(),
  listAllCopilotMemories: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => (values?.name ? key.replace('{{name}}', values.name) : key),
  }),
}))

vi.mock('@/hooks/useCopilots', () => ({
  useCopilotMemory: () => ({ owners: [] }),
  useMyCopilots: () => ({ copilots: [{ id: 'copilot-1', name: 'Research Copilot' }] }),
}))

vi.mock('@/stores/agentPersonaStore', () => ({
  clearCopilotMemories: mocks.clearCopilotMemories,
  deleteCopilotMemory: mocks.deleteCopilotMemory,
  listAllCopilotMemories: mocks.listAllCopilotMemories,
}))

import { CopilotMemoriesSection } from './CopilotMemoriesSection'

function renderSection() {
  render(
    <MantineProvider>
      <CopilotMemoriesSection />
    </MantineProvider>
  )
}

describe('CopilotMemoriesSection', () => {
  beforeEach(() => {
    mocks.clearCopilotMemories.mockReset().mockResolvedValue(undefined)
    mocks.deleteCopilotMemory.mockReset().mockResolvedValue(true)
    mocks.listAllCopilotMemories.mockReset().mockResolvedValue({
      'copilot-1': [{ id: 'memory-1', content: 'Prefers concise answers', createdAt: '2026-08-31T00:00:00.000Z' }],
    })
  })

  test('requires confirmation before clearing all memories for a copilot', async () => {
    renderSection()

    const clearButton = await screen.findByRole('button', { name: 'Clear all' })
    fireEvent.click(clearButton)

    expect(mocks.clearCopilotMemories).not.toHaveBeenCalled()
    expect(await screen.findByText('Clear all memories for "Research Copilot"? This cannot be undone.')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear all' })[1])

    await waitFor(() => expect(mocks.clearCopilotMemories).toHaveBeenCalledOnce())
    expect(mocks.clearCopilotMemories).toHaveBeenCalledWith('copilot-1')
    await waitFor(() => expect(screen.queryByText('Prefers concise answers')).toBeNull())
  })
})
