import { describe, expect, it, vi } from 'vitest'
import { mcpToolSchema } from './mcp-tool-schema'

describe('MCP structural validation', () => {
  it('never executes external patterns and keeps the advertised schema intact', async () => {
    const source = {
      type: 'object' as const,
      properties: { q: { type: 'string' as const, pattern: '^(a+)+$' } },
      required: ['q'],
    }
    const report = vi.fn()
    const schema = mcpToolSchema(source, report)
    expect(schema.jsonSchema).toEqual(source)
    expect((await schema.validate?.({ q: `${'a'.repeat(40)}b` }))?.success).toBe(true)
    expect((await schema.validate?.({ q: 12 }))?.success).toBe(false)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it.each([
    { $schema: 'https://example.org/custom', type: 'object' as const },
    { $ref: 'https://example.org/schema' },
    { $dynamicRef: '#node' },
    { patternProperties: { '^(a+)+$': { type: 'number' as const } }, additionalProperties: false },
  ])('leaves advanced semantics to the MCP server with one bounded diagnostic', async (source) => {
    const report = vi.fn()
    const schema = mcpToolSchema(source, report)
    expect((await schema.validate?.({ value: 'ok' }))?.success).toBe(true)
    expect((await schema.validate?.({ value: 'again' }))?.success).toBe(true)
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0].length).toBeLessThan(250)
  })

  it('preserves a property literally named pattern and schema-valued open maps', async () => {
    const schema = mcpToolSchema(
      { type: 'object', properties: { pattern: { type: 'number' } }, additionalProperties: { type: 'string' } },
      vi.fn()
    )
    expect((await schema.validate?.({ pattern: 2, extra: 'yes' }))?.success).toBe(true)
    expect((await schema.validate?.({ pattern: 'wrong' }))?.success).toBe(false)
  })
})

it.each([
  { prefixItems: [{ type: 'string' }], items: false },
  { items: [{ type: 'string' }], additionalItems: false },
])('delegates tuple semantics without rejecting valid prefix items', async (tuple) => {
  const schema = mcpToolSchema(
    { type: 'object', properties: { pair: { type: 'array', ...tuple } } } as Parameters<typeof mcpToolSchema>[0],
    vi.fn()
  )
  expect((await schema.validate?.({ pair: ['ok'] }))?.success).toBe(true)
})
