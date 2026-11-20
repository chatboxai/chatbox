import { describe, expect, it } from 'vitest'
import { getStatusBadgeCutoutStyle } from './status-badge-cutout'

describe('getStatusBadgeCutoutStyle', () => {
  it('cuts a transparent circle centered on the corner badge', () => {
    const style = getStatusBadgeCutoutStyle(20, 10)
    expect(style.width).toBe(20)
    expect(style.height).toBe(20)
    expect(style.maskImage).toBe('radial-gradient(circle at 17px 17px, transparent 6px, black 6.5px)')
    expect(style.WebkitMaskImage).toBe(style.maskImage)
  })
})
