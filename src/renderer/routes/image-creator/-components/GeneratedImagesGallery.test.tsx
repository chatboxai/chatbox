/** @vitest-environment jsdom */
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn(), fetchBlob: vi.fn(), download: vi.fn() }))
vi.mock('./constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./constants')>()),
  getImageSizeFromUrl: mocks.load,
}))
vi.mock('@/hooks/useBlob', () => ({ useFetchBlob: () => mocks.fetchBlob }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/platform', () => ({ default: { exporter: { exportByUrl: mocks.download } } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/tooltip', () => ({ AppTooltip: ({ children }: { children: ReactNode }) => children }))
vi.mock('react-photoswipe-gallery', () => ({
  Gallery: ({ children }: { children: ReactNode }) => children,
  Item: ({ children }: { children: (props: { ref: null; open: () => void }) => ReactNode }) =>
    children({ ref: null, open: () => undefined }),
}))

import { GeneratedImagesGallery } from './GeneratedImagesGallery'

const original = 'https://example.com/original.png'
const thumbnail = 'https://example.com/thumbnail.png'
let client: QueryClient

function show(images = [original], thumbnails?: string[]) {
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <GeneratedImagesGallery images={images} thumbnails={thumbnails} onUseAsReference={() => undefined} />
      </QueryClientProvider>
    </MantineProvider>
  )
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  client = new QueryClient()
  mocks.load.mockReset()
  mocks.fetchBlob.mockReset()
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.unstubAllGlobals()
})

describe('GeneratedImagesGallery', () => {
  it('shows a thumbnail before the full image finishes, then replaces it', async () => {
    let complete: ((size: { width: number; height: number }) => void) | undefined
    mocks.load.mockImplementation((url: string) =>
      url === thumbnail
        ? Promise.resolve({ width: 512, height: 410 })
        : new Promise((resolve) => {
            complete = resolve
          })
    )
    show([original], [thumbnail])
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(thumbnail))
    expect(screen.getByText('Loading full-size image...')).toBeTruthy()
    complete?.({ width: 1400, height: 1120 })
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(original))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the thumbnail after original failure and reloads the original', async () => {
    mocks.load.mockImplementation((url: string) =>
      url === thumbnail
        ? Promise.resolve({ width: 512, height: 410 })
        : Promise.reject(new Error('Image loading timed out'))
    )
    show([original], [thumbnail])
    await screen.findByText('Image generated, but failed to load')
    expect(screen.getByRole('img').getAttribute('src')).toBe(thumbnail)
    mocks.load.mockResolvedValue({ width: 1400, height: 1120 })
    fireEvent.click(screen.getByRole('button', { name: 'Reload image' }))
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(original))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mocks.load.mock.calls.filter(([url]) => url === original)).toHaveLength(2)
  })

  it('provides a reload button when both downloads fail', async () => {
    mocks.load.mockRejectedValue(new Error('Network failure'))
    show([original], [thumbnail])
    await screen.findByText('Image generated, but failed to load')
    expect(screen.getByRole('button', { name: 'Reload image' })).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    mocks.load.mockResolvedValue({ width: 100, height: 100 })
    fireEvent.click(screen.getByRole('button', { name: 'Reload image' }))
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(original))
  })

  it('shows the original when the thumbnail fails', async () => {
    mocks.load.mockImplementation((url: string) =>
      url === thumbnail ? Promise.reject(new Error('Thumbnail failed')) : Promise.resolve({ width: 1400, height: 1120 })
    )
    show([original], [thumbnail])
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(original))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('recovers when the displayed image fails after its initial probe succeeded', async () => {
    mocks.load.mockResolvedValue({ width: 1400, height: 1120 })
    show([original], [thumbnail])
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(original))
    fireEvent.error(screen.getByRole('img'))
    await screen.findByText('Image generated, but failed to load')
    expect(screen.getByRole('img').getAttribute('src')).toBe(thumbnail)
    fireEvent.click(screen.getByRole('button', { name: 'Reload image' }))
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(original))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('loads historical records without a thumbnail', async () => {
    mocks.load.mockResolvedValue({ width: 100, height: 100 })
    show()
    await screen.findByRole('img')
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('shows an actionable failure for a missing local image', async () => {
    mocks.fetchBlob.mockResolvedValue(null)
    show(['image:missing'])
    await screen.findByText('Image generated, but failed to load')
    expect(screen.getByRole('button', { name: 'Reload image' })).toBeTruthy()
  })
})
