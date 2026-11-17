import { describe, expect, test } from 'vitest'
import { contentColumnClassName, contentColumnContainerClassName, paddedContentColumnClassName } from './contentColumn'

describe('content column', () => {
  test('keeps the standard column at max-w-4xl', () => {
    expect(contentColumnClassName(false)).toBe('w-full max-w-4xl mx-auto')
    expect(paddedContentColumnClassName(false)).toBe('w-full max-w-4xl mx-auto px-md')
    expect(contentColumnContainerClassName(false)).toBe('')
  })

  test('centers the full-width column and grows it sub-linearly up to 1600px', () => {
    const className = contentColumnClassName(true)
    expect(className.split(' ')).toEqual([
      'w-[min(1600px,calc(960px_+_(100cqw_-_960px)_*_0.45))]',
      'max-w-full',
      'mx-auto',
    ])
    expect(paddedContentColumnClassName(true)).toBe(`${className} px-md`)
  })

  test('measures the full-width column against a shared main-area container', () => {
    expect(contentColumnContainerClassName(true)).toBe('[container-type:inline-size]')
  })
})
