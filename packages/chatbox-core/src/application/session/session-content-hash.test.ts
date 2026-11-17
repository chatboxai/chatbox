import { describe, expect, it, vi } from 'vitest'
import { sessionContentHash } from './session-content-hash'

function reference(value: unknown): string {
  const serialized =
    JSON.stringify(value, (_key, item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    }) ?? String(value)
  const hash = (seed: number) => {
    let value = seed >>> 0
    for (let i = 0; i < serialized.length; i++) {
      value = Math.imul(value ^ serialized.charCodeAt(i), 0x01000193) >>> 0
      value ^= value >>> 13
    }
    return value.toString(16).padStart(8, '0')
  }
  return `${serialized.length.toString(36)}:${hash(0x811c9dc5)}:${hash(0x9e3779b9)}`
}

describe('session content hash compatibility', () => {
  it('preserves ordering, Unicode, JSON omission, scalar and toJSON semantics', () => {
    const fixtures: unknown[] = [
      null,
      undefined,
      123,
      NaN,
      Infinity,
      -0,
      true,
      { z: undefined, a: '\\"\n\t\u0000', '10': 'ten', '2': 'two', '01': 'one', Ä: '中😀', Z: false },
      [undefined, , Symbol('x'), () => {}, null, new Date('2026-01-01')],
      {
        nested: {
          toJSON(key: string) {
            return { z: key, a: 1 }
          },
        },
        shared: [1, 2],
      },
      { text: 'a'.repeat(16383) + '😀' + '\ud800' + '\udc00' + '中'.repeat(20000) + '\ud800' },
      {
        message: { files: [{ sessionAttachmentId: 123 }], contentParts: [{ type: 'text', text: 'x'.repeat(100000) }] },
      },
    ]
    for (const value of fixtures) expect(sessionContentHash(value)).toBe(reference(value))
  })
  it('never serializes a whole session or an unbounded string', () => {
    const value = { messages: Array.from({ length: 32 }, () => ({ text: 'x'.repeat(128 * 1024) })) }
    const expected = reference(value)
    const stringify = JSON.stringify
    let maxString = 0
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation((input: unknown) => {
      expect(typeof input).not.toBe('object')
      if (typeof input === 'string') maxString = Math.max(maxString, input.length)
      return stringify(input)
    })
    try {
      expect(sessionContentHash(value)).toBe(expected)
      expect(maxString).toBeLessThanOrEqual(16 * 1024)
    } finally {
      spy.mockRestore()
    }
  })
  it('rejects cycles and distinguishes changed content', () => {
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    expect(() => sessionContentHash(cycle)).toThrow()
    expect(sessionContentHash({ text: 'a' })).not.toBe(sessionContentHash({ text: 'b' }))
  })
})
