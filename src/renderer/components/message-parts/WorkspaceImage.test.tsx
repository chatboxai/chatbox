// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { platformType, readBase64Mock } = vi.hoisted(() => ({
  platformType: { value: 'mobile' as 'mobile' | 'desktop' },
  readBase64Mock: vi.fn(),
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/platform', () => ({
  default: {
    get type() {
      return platformType.value
    },
  },
}))

vi.mock('@/packages/mobile-work-mode/CapacitorWorkspace', () => ({
  CapacitorWorkspace: class {
    readBase64(sessionId: string, path: string) {
      return readBase64Mock(sessionId, path)
    }
  },
}))

import { clearWorkspaceImageCache } from './workspace-image'
import { WorkspaceImage } from './WorkspaceImage'

beforeEach(() => {
  clearWorkspaceImageCache()
  readBase64Mock.mockReset()
  platformType.value = 'mobile'
})

afterEach(() => {
  cleanup()
})

describe('WorkspaceImage', () => {
  it('inlines a mobile workspace image as a data URL', async () => {
    readBase64Mock.mockResolvedValue('AAAA')
    render(<WorkspaceImage source="output/chart.png" alt="chart" sessionId="session-1" />)

    const image = await screen.findByRole('img')
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(image.getAttribute('alt')).toBe('chart')
    expect(readBase64Mock).toHaveBeenCalledWith('session-1', 'output/chart.png')
  })

  it('normalizes ./ and backslashes before reading the workspace file', async () => {
    readBase64Mock.mockResolvedValue('AAAA')
    render(<WorkspaceImage source={'.\\output\\chart.png'} alt="chart" sessionId="session-1" />)

    await screen.findByRole('img')
    expect(readBase64Mock).toHaveBeenCalledWith('session-1', 'output/chart.png')
  })

  it('degrades to a chip when the workspace file is gone', async () => {
    readBase64Mock.mockRejectedValue(new Error('File missing or too large'))
    render(<WorkspaceImage source="output/gone.png" alt="gone" sessionId="session-1" retryDelaysMs={[]} />)

    const chip = await screen.findByTestId('workspace-image-unavailable')
    expect(chip.textContent).toContain('Image no longer available in this workspace')
  })

  it('reports images that exceed the inline limit', async () => {
    // 27 MB decoded: above MAX_WORKSPACE_IMAGE_BYTES.
    readBase64Mock.mockResolvedValue('A'.repeat(36 * 1024 * 1024))
    render(<WorkspaceImage source="output/huge.png" alt="huge" sessionId="session-1" retryDelaysMs={[]} />)

    const chip = await screen.findByTestId('workspace-image-unavailable')
    expect(chip.textContent).toContain('Image is too large to display')
  })

  it('keeps the plain <img> on desktop so desktop behaviour is unchanged', async () => {
    platformType.value = 'desktop'
    render(<WorkspaceImage source="output/chart.png" alt="chart" sessionId="session-1" />)

    const image = await screen.findByRole('img')
    expect(image.getAttribute('src')).toBe('output/chart.png')
    expect(readBase64Mock).not.toHaveBeenCalled()
  })

  it('keeps the plain <img> when there is no session to read from', async () => {
    render(<WorkspaceImage source="output/chart.png" alt="chart" />)

    const image = await screen.findByRole('img')
    expect(image.getAttribute('src')).toBe('output/chart.png')
    expect(readBase64Mock).not.toHaveBeenCalled()
  })

  it('reads each file once per session and reuses the cached data URL', async () => {
    readBase64Mock.mockResolvedValue('AAAA')
    const first = render(<WorkspaceImage source="output/chart.png" alt="a" sessionId="session-1" />)
    await screen.findByRole('img')
    first.unmount()

    render(<WorkspaceImage source="output/chart.png" alt="b" sessionId="session-1" />)
    expect((await screen.findByRole('img')).getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(readBase64Mock).toHaveBeenCalledTimes(1)
  })

  it('recovers when the file only appears after the first attempt', async () => {
    // The user message referencing output/chart.png renders before Python has written
    // the file; the assistant message must still show it once the run commits.
    readBase64Mock.mockRejectedValueOnce(new Error('File missing or too large')).mockResolvedValue('AAAA')
    render(
      <WorkspaceImage source="output/chart.png" alt="chart" sessionId="session-1" retryDelaysMs={[10]} />
    )

    expect(await screen.findByTestId('workspace-image-unavailable')).toBeTruthy()
    const image = await screen.findByRole('img', undefined, { timeout: 3_000 })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(readBase64Mock).toHaveBeenCalledTimes(2)
  })
})
