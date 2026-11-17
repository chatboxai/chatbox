/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  svgToPngBase64: vi.fn(),
  exportImageFile: vi.fn(),
  exportByUrl: vi.fn(),
  toastAdd: vi.fn(),
  platformType: { value: 'mobile' },
}))

vi.mock('pele/lazy', () => ({ renderAsync: vi.fn() }))
vi.mock('@/analytics/jk', () => ({ trackJkAutoEvent: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/packages/navigator', () => ({ copyToClipboard: vi.fn() }))
vi.mock('@/packages/pic_utils', () => ({
  svgCodeToBase64: vi.fn(),
  svgToPngBase64: mocks.svgToPngBase64,
}))
vi.mock('@/platform', () => ({
  default: {
    get type() {
      return mocks.platformType.value
    },
    exporter: {
      exportImageFile: mocks.exportImageFile,
      exportByUrl: mocks.exportByUrl,
    },
  },
}))
vi.mock('@/stores/uiStore', () => ({ useUIStore: () => vi.fn() }))
vi.mock('../stores/toastActions', () => ({ add: mocks.toastAdd }))

import { downloadSvgPreview } from './Mermaid'

const t = (key: string) => key
const svgDataUrl = 'data:image/svg+xml;base64,PHN2Zy8+'

describe('downloadSvgPreview', () => {
  beforeEach(() => {
    mocks.platformType.value = 'mobile'
    mocks.svgToPngBase64.mockReset()
    mocks.exportImageFile.mockReset().mockResolvedValue(undefined)
    mocks.exportByUrl.mockReset().mockResolvedValue(undefined)
    mocks.toastAdd.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('saves the rasterized PNG on mobile', async () => {
    mocks.svgToPngBase64.mockResolvedValue('data:image/png;base64,AAAA')

    await downloadSvgPreview(svgDataUrl, t)

    expect(mocks.exportImageFile).toHaveBeenCalledTimes(1)
    expect(mocks.exportImageFile.mock.calls[0][1]).toBe('data:image/png;base64,AAAA')
    expect(mocks.toastAdd).not.toHaveBeenCalled()
  })

  test('shares the original SVG when rasterizing fails on mobile', async () => {
    mocks.svgToPngBase64.mockRejectedValue(new Error('SVG is too large to rasterize (8192x8192)'))

    await downloadSvgPreview(svgDataUrl, t)

    expect(mocks.exportImageFile).toHaveBeenCalledTimes(1)
    expect(mocks.exportImageFile.mock.calls[0][1]).toBe(svgDataUrl)
    expect(mocks.toastAdd).not.toHaveBeenCalled()
  })

  test('tells the user when both the PNG and the SVG export fail', async () => {
    mocks.svgToPngBase64.mockRejectedValue(new Error('too large'))
    mocks.exportImageFile.mockRejectedValue(new Error('disk full'))

    await downloadSvgPreview(svgDataUrl, t)

    expect(mocks.toastAdd).toHaveBeenCalledWith('Failed to export file: {{error}}')
  })

  test('downloads the SVG directly on desktop without rasterizing', async () => {
    mocks.platformType.value = 'desktop'

    await downloadSvgPreview(svgDataUrl, t)

    expect(mocks.svgToPngBase64).not.toHaveBeenCalled()
    expect(mocks.exportByUrl).toHaveBeenCalledTimes(1)
    expect(mocks.exportByUrl.mock.calls[0][1]).toBe(svgDataUrl)
  })
})
