// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GLASS_FILL_CLASS } from '@/lib/glass-surface'
import { MobileWorkArtifactsUI } from './MobileWorkArtifactsUI'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('@/analytics/agent-mode', () => ({ trackWorkArtifactAction: vi.fn() }))
vi.mock('@/packages/mobile-work-mode/artifacts', () => ({
  localWorkPreviewDocument: vi.fn(),
  readLocalWorkArtifact: vi.fn(),
  shareLocalWorkArtifact: vi.fn(),
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

afterEach(cleanup)

describe('MobileWorkArtifactsUI', () => {
  test('artifact cards are translucent glass fills in the transcript', () => {
    const view = render(
      <MantineProvider>
        <MobileWorkArtifactsUI
          artifacts={[{ path: '/work/report.md', name: 'report.md', mimeType: 'text/markdown', size: 120 }]}
        />
      </MantineProvider>
    )
    expect(view.container.querySelector(`.${GLASS_FILL_CLASS}`)?.textContent).toContain('report.md')
  })
})
