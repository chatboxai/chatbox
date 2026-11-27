import { describe, expect, it, vi } from 'vitest'
import {
  base64ByteLength,
  cacheWorkspaceImage,
  clearWorkspaceImageCache,
  getCachedWorkspaceImage,
  hasFailedWorkspaceImage,
  isWorkspaceImagePath,
  markWorkspaceImageFailed,
  normalizeWorkspaceImagePath,
  workspaceImageDataUrl,
  workspaceImageMimeType,
} from './workspace-image'

describe('isWorkspaceImagePath', () => {
  it('accepts workspace-relative image paths models write after Python runs', () => {
    for (const src of [
      'output/chart.png',
      'output/energy.png',
      './output/motion.png',
      'artifacts/run-1/figure.jpg',
      'notes/sub dir/plot.webp',
      'chart.PNG',
      'output/plot.jpeg?raw=1',
    ]) {
      expect(isWorkspaceImagePath(src), src).toBe(true)
    }
  })

  it('leaves real URLs and non-image paths to the browser', () => {
    for (const src of [
      undefined,
      '',
      '   ',
      'https://example.com/a.png',
      'http://example.com/a.png',
      'data:image/png;base64,AAAA',
      'blob:https://localhost/1234',
      'file:///tmp/a.png',
      'capacitor://localhost/a.png',
      '/absolute/a.png',
      '//cdn.example.com/a.png',
      '#figure-1',
      'output/chart.pdf',
      'output/data.csv',
      'output/chart',
      'output/../secret.png',
    ]) {
      expect(isWorkspaceImagePath(src), String(src)).toBe(false)
    }
  })
})

describe('normalizeWorkspaceImagePath', () => {
  it('strips ./ prefixes, backslashes and duplicate slashes', () => {
    expect(normalizeWorkspaceImagePath('./output//chart.png')).toBe('output/chart.png')
    expect(normalizeWorkspaceImagePath('.\\output\\chart.png')).toBe('output/chart.png')
    expect(normalizeWorkspaceImagePath('  ././output/chart.png  ')).toBe('output/chart.png')
  })
})

describe('workspaceImageMimeType', () => {
  it('maps image extensions to media types', () => {
    expect(workspaceImageMimeType('output/chart.png')).toBe('image/png')
    expect(workspaceImageMimeType('output/photo.JPG')).toBe('image/jpeg')
    expect(workspaceImageMimeType('output/anim.webp')).toBe('image/webp')
  })

  it('falls back to png for unknown extensions', () => {
    expect(workspaceImageMimeType('output/chart.xyz')).toBe('image/png')
  })
})

describe('base64ByteLength', () => {
  it('computes the decoded size including padding', () => {
    expect(base64ByteLength('')).toBe(0)
    expect(base64ByteLength('AAAA')).toBe(3)
    expect(base64ByteLength('AAA=')).toBe(2)
    expect(base64ByteLength('AA==')).toBe(1)
  })
})

describe('workspaceImageDataUrl', () => {
  it('builds a data URL with the media type of the file', () => {
    expect(workspaceImageDataUrl('output/chart.png', 'AAAA')).toBe('data:image/png;base64,AAAA')
    expect(workspaceImageDataUrl('output/photo.jpg', 'AAAA')).toBe('data:image/jpeg;base64,AAAA')
  })
})

describe('workspace image cache', () => {
  it('caches resolved data URLs per session and path', () => {
    clearWorkspaceImageCache()
    expect(getCachedWorkspaceImage('s1', 'output/chart.png')).toBeUndefined()
    cacheWorkspaceImage('s1', './output/chart.png', 'data:image/png;base64,AAAA')
    // Normalized key: ./output/chart.png and output/chart.png are the same file.
    expect(getCachedWorkspaceImage('s1', 'output/chart.png')).toBe('data:image/png;base64,AAAA')
    expect(getCachedWorkspaceImage('s2', 'output/chart.png')).toBeUndefined()
    clearWorkspaceImageCache()
  })

  it('remembers recent failures so a broken reference is not retried on every delta', () => {
    clearWorkspaceImageCache()
    expect(hasFailedWorkspaceImage('s1', 'output/gone.png')).toBe(false)
    markWorkspaceImageFailed('s1', './output/gone.png')
    expect(hasFailedWorkspaceImage('s1', 'output/gone.png')).toBe(true)
    expect(hasFailedWorkspaceImage('s2', 'output/gone.png')).toBe(false)
    clearWorkspaceImageCache()
  })

  it('re-checks a failed path once the miss is stale, so a later file still shows up', () => {
    clearWorkspaceImageCache()
    vi.useFakeTimers()
    try {
      markWorkspaceImageFailed('s1', 'output/chart.png')
      expect(hasFailedWorkspaceImage('s1', 'output/chart.png')).toBe(true)
      // A user message can reference a file the agent has not produced yet; the miss
      // must expire instead of hiding the real image for the rest of the session.
      vi.advanceTimersByTime(2_500)
      expect(hasFailedWorkspaceImage('s1', 'output/chart.png')).toBe(false)
    } finally {
      vi.useRealTimers()
      clearWorkspaceImageCache()
    }
  })

  it('clears the failure mark when the same path later resolves', () => {
    clearWorkspaceImageCache()
    markWorkspaceImageFailed('s1', 'output/chart.png')
    cacheWorkspaceImage('s1', 'output/chart.png', 'data:image/png;base64,AAAA')
    expect(hasFailedWorkspaceImage('s1', 'output/chart.png')).toBe(false)
    expect(getCachedWorkspaceImage('s1', 'output/chart.png')).toBe('data:image/png;base64,AAAA')
    clearWorkspaceImageCache()
  })
})
