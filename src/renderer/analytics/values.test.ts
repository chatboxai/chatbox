import { describe, expect, it } from 'vitest'
import { bucketCount, toBooleanString } from './values'

describe('toBooleanString', () => {
  it('maps booleans to string literals', () => {
    expect(toBooleanString(true)).toBe('true')
    expect(toBooleanString(false)).toBe('false')
  })
})

describe('bucketCount', () => {
  it('buckets counts at the 0/1/2+ boundaries', () => {
    expect(bucketCount(-1)).toBe('0')
    expect(bucketCount(0)).toBe('0')
    expect(bucketCount(1)).toBe('1')
    expect(bucketCount(2)).toBe('2_plus')
    expect(bucketCount(100)).toBe('2_plus')
  })
})
