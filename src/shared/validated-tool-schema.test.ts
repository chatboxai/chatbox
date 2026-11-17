import { describe, expect, it } from 'vitest'
import { validatedToolSchema } from './validated-tool-schema'

const commandSchema = {
  type: 'object' as const,
  properties: {
    command: { type: 'string' as const },
    timeout: { type: 'integer' as const, minimum: 1 },
    shell: { type: 'string' as const, enum: ['bash', 'zsh'] },
  },
  required: ['command'],
  additionalProperties: false,
}

async function validate(schema: ReturnType<typeof validatedToolSchema>, input: unknown) {
  if (!schema.validate) throw new Error('Missing tool validator')
  return schema.validate(input)
}

describe('validatedToolSchema', () => {
  it.each([
    [{ cmd: 'pwd' }, 'command'],
    [{ command: 123 }, 'string'],
    [{ command: 'pwd', timeout: '100' }, 'integer'],
    [{ command: 'pwd', timeout: 0 }, 'minimum'],
    [{ command: 'pwd', shell: 'fish' }, 'enum'],
    [{ command: 'pwd', other: true }, 'additionalProperties'],
    [{ command: 'pwd', timeout: null }, 'integer'],
  ])('rejects invalid arguments %j with a field-level diagnostic', async (input, expected) => {
    const result = await validate(validatedToolSchema(commandSchema), input)
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected validation failure')
    expect(result.error.message).toContain('Tool was not executed')
    expect(JSON.stringify(result.error)).toContain(expected)
  })

  it('preserves valid values without coercion or filling defaults', async () => {
    const input = { command: 'pwd' }
    expect(await validate(validatedToolSchema(commandSchema), input)).toEqual({ success: true, value: input })
    expect(input).toEqual({ command: 'pwd' })
  })

  it('validates nested items and returns their input paths', async () => {
    const schema = validatedToolSchema({
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          minItems: 1,
          items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
      },
      required: ['edits'],
    })
    const result = await validate(schema, { edits: [{ text: 4 }] })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected validation failure')
    expect(result.error.message).toContain('#/edits/0/text')
    expect((await validate(schema, { edits: [] })).success).toBe(false)
  })

  it('preserves open maps and enforces schema-valued additionalProperties', async () => {
    const open = validatedToolSchema({ type: 'object', properties: {} })
    expect(open.jsonSchema).not.toHaveProperty('additionalProperties')
    expect((await validate(open, { dynamic: 'value' })).success).toBe(true)
    const map = validatedToolSchema({ type: 'object', additionalProperties: { type: 'string' } })
    expect((await validate(map, { dynamic: 'value' })).success).toBe(true)
    expect((await validate(map, { dynamic: 42 })).success).toBe(false)
  })

  it('validates local refs and unions without mutating the model-facing schema', async () => {
    const inputSchema = {
      type: 'object' as const,
      $defs: { value: { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] } },
      properties: { value: { $ref: '#/$defs/value' } },
      required: ['value'],
    }
    const before = JSON.stringify(inputSchema)
    const schema = validatedToolSchema(inputSchema)
    expect((await validate(schema, { value: null })).success).toBe(true)
    expect((await validate(schema, { value: 1 })).success).toBe(false)
    expect(JSON.stringify(schema.jsonSchema)).toBe(before)
    expect(JSON.stringify(inputSchema)).toBe(before)
  })

  it('honors draft 7 tuple items and draft 2020 prefixItems', async () => {
    const draft7 = validatedToolSchema({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { pair: { type: 'array', items: [{ type: 'string' }, { type: 'number' }], additionalItems: false } },
    })
    const pair = {
      type: 'array' as const,
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: false as const,
    }
    const modern = validatedToolSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { pair },
    })
    for (const schema of [draft7, modern]) {
      expect((await validate(schema, { pair: ['a', 1] })).success).toBe(true)
      expect((await validate(schema, { pair: [1, 'a'] })).success).toBe(false)
      expect((await validate(schema, { pair: ['a', 1, true] })).success).toBe(false)
    }
  })
  it('validates Draft 6 tool schemas', async () => {
    const schema = validatedToolSchema({
      $schema: 'http://json-schema.org/draft-06/schema#',
      type: 'object',
      properties: {
        value: { type: 'number', exclusiveMinimum: 0 },
        tags: { type: 'array', contains: { const: 'required' } },
      },
      required: ['value', 'tags'],
    })
    expect((await validate(schema, { value: 1, tags: ['required'] })).success).toBe(true)
    expect((await validate(schema, { value: 0, tags: [] })).success).toBe(false)
  })

  it('isolates unsupported schema initialization to the affected tool call', async () => {
    const schema = validatedToolSchema({ $schema: 'https://example.com/unsupported-dialect', type: 'object' })
    const result = await validate(schema, {})
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected validation failure')
    expect(result.error.message).toContain('Unsupported tool schema dialect')
    expect(result.error.message).toContain('Tool was not executed')
  })
})

it('bounds schema setup errors', async () => {
  const schema = validatedToolSchema({ $ref: `https://example.com/${'x'.repeat(10000)}` })
  const result = await schema.validate?.({})
  expect(result?.success).toBe(false)
  if (result && !result.success) expect(result.error.message.length).toBeLessThan(500)
})

it('stops at the first invalid array entry', async () => {
  const schema = validatedToolSchema({ type: 'array', items: { type: 'object', required: ['text'] } })
  const result = await schema.validate?.(Array.from({ length: 10000 }, () => ({})))
  expect(result?.success).toBe(false)
  if (result && !result.success)
    expect(
      (result.error as import('./validated-tool-schema').ToolInputValidationError).issues.length
    ).toBeLessThanOrEqual(8)
})
