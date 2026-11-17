import { describe, expect, it } from 'vitest'
import { normalizeBrowserUrl } from './url'

describe('normalizeBrowserUrl', () => {
  it('keeps full URLs, including local ones', () => {
    expect(normalizeBrowserUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(normalizeBrowserUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/')
    expect(normalizeBrowserUrl('file:///tmp/page.html')).toBe('file:///tmp/page.html')
  })

  it('adds a scheme to bare hosts', () => {
    expect(normalizeBrowserUrl(' example.com/docs ')).toBe('https://example.com/docs')
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizeBrowserUrl('127.0.0.1:5173/app')).toBe('http://127.0.0.1:5173/app')
  })

  it('rejects empty input', () => {
    expect(() => normalizeBrowserUrl('  ')).toThrow('URL is empty')
  })
})
