import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  calculateImageResizeSize,
  calculateSvgRasterSize,
  MAX_CANVAS_AREA,
  svgHasUnsafeResources,
  svgToPngBase64,
} from './pic_utils'

function svgElement(localName: string, attributes: Record<string, string> = {}, textContent = ''): Element {
  return {
    attributes: Object.entries(attributes).map(([attributeName, value]) => ({
      localName: attributeName,
      name: attributeName,
      namespaceURI: null,
      value,
    })),
    localName,
    namespaceURI: 'http://www.w3.org/2000/svg',
    textContent,
  } as unknown as Element
}

function svgDocument(elements: Element[]): Document {
  return {
    getElementsByTagName: (name: string) => (name === '*' ? elements : []),
  } as unknown as Document
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('calculateImageResizeSize', () => {
  test('keeps both dimensions nonzero for extreme aspect ratios', () => {
    expect(calculateImageResizeSize(16_384, 1)).toEqual({ width: 1568, height: 1 })
    expect(calculateImageResizeSize(1, 16_384)).toEqual({ width: 1, height: 1568 })
  })

  test('applies the model short-side limit while preserving the aspect ratio', () => {
    expect(calculateImageResizeSize(1200, 1000)).toEqual({ width: 921, height: 768 })
  })
})

describe('calculateSvgRasterSize', () => {
  test('preserves the existing 2x raster scale for ordinary SVGs', () => {
    expect(calculateSvgRasterSize(640, 480)).toEqual({ width: 1280, height: 960 })
  })

  test('bounds large square SVGs before allocating the canvas', () => {
    expect(calculateSvgRasterSize(10_000, 10_000, { maxOutputDimension: 1568 })).toEqual({
      width: 1568,
      height: 1568,
    })
  })

  test('keeps aspect ratio when bounding a large SVG', () => {
    expect(calculateSvgRasterSize(10_000, 5_000, { maxOutputDimension: 1568 })).toEqual({
      width: 1568,
      height: 784,
    })
  })

  test('keeps the output inside the smallest mobile canvas area', () => {
    for (const [width, height] of [
      [10_200, 5_952],
      [19_200, 5_952],
    ]) {
      const size = calculateSvgRasterSize(width, height)
      expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_AREA)
      expect(size.width / size.height).toBeCloseTo(width / height, 2)
    }
    expect(calculateSvgRasterSize(100_000, 100_000)).toEqual({ width: 4096, height: 4096 })
  })

  test('rejects invalid source dimensions', () => {
    expect(() => calculateSvgRasterSize(Number.POSITIVE_INFINITY, 100)).toThrow('invalid dimensions')
  })

  test('accepts only resource-isolated SVG elements and attributes', () => {
    expect(
      svgHasUnsafeResources(
        svgDocument([
          svgElement('svg', { xmlns: 'http://www.w3.org/2000/svg' }),
          svgElement('defs'),
          svgElement('linearGradient'),
          svgElement('rect', { fill: 'url(#paint)' }),
        ])
      )
    ).toBe(false)

    expect(svgHasUnsafeResources(svgDocument([svgElement('feImage')]))).toBe(true)
    expect(svgHasUnsafeResources(svgDocument([svgElement('foreignObject')]))).toBe(true)
    expect(svgHasUnsafeResources(svgDocument([svgElement('rect', { style: 'fill: url(external.png)' })]))).toBe(true)
    expect(svgHasUnsafeResources(svgDocument([svgElement('use', { href: 'data:image/png;base64,AA==' })]))).toBe(true)
  })

  test('rejects unsafe SVG resources before browser decoding', async () => {
    const parsedDocument = svgDocument([svgElement('svg'), svgElement('feImage')])
    class MockDOMParser {
      parseFromString() {
        return parsedDocument
      }
    }
    const imageConstructor = vi.fn()
    vi.stubGlobal('DOMParser', MockDOMParser)
    vi.stubGlobal('Image', imageConstructor)

    const svg = '<svg><image href="data:image/png;base64,AA==" /></svg>'
    await expect(
      svgToPngBase64(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, {
        strictResourceIsolation: true,
      })
    ).rejects.toThrow('contains resources that are not supported')
    expect(imageConstructor).not.toHaveBeenCalled()
  })

  test('rejects an empty canvas result instead of returning a blank data URL', async () => {
    const svgRoot = { getAttribute: () => null }
    class MockDOMParser {
      parseFromString() {
        return { documentElement: svgRoot, getElementsByTagName: () => [] }
      }
    }
    class MockImage {
      onload: (() => void) | null = null
      onerror: ((error: unknown) => void) | null = null
      width = 9000
      height = 9000
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('DOMParser', MockDOMParser)
    vi.stubGlobal('Image', MockImage)
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toDataURL: () => 'data:,',
      }),
    })

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="9000"></svg>'
    await expect(svgToPngBase64(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)).rejects.toThrow(
      'too large to rasterize'
    )
  })
})
