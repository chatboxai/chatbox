import type { JSONSchema7 } from '@ai-sdk/provider'
import { jsonSchema } from 'ai'
import { ToolInputValidationError, validatedToolSchema } from './validated-tool-schema'

/** Local MCP validation checks structure; the server owns advanced schema semantics. */
export function mcpToolSchema(schema: JSONSchema7 & Record<string, unknown>, report: (message: string) => void) {
  let delegated = false
  let nodes = 0
  const project = (value: unknown, depth = 0): unknown => {
    if (typeof value === 'boolean') return value
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 64 || ++nodes > 10000) {
      delegated = true
      return {}
    }
    const source = value as Record<string, unknown>
    if (
      typeof source.$schema === 'string' &&
      !/^https?:\/\/json-schema\.org\/(draft-0[467]|draft\/(2019-09|2020-12))\/schema\/?#?$/.test(source.$schema)
    ) {
      delegated = true
      return {}
    }
    // These keywords can change the meaning of siblings such as additionalProperties.
    if (
      Array.isArray(source.items) ||
      [
        '$ref',
        '$dynamicRef',
        '$recursiveRef',
        'allOf',
        'anyOf',
        'oneOf',
        'not',
        'if',
        'patternProperties',
        'prefixItems',
      ].some((key) => key in source)
    ) {
      delegated = true
      return {}
    }
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(source)) {
      if (
        [
          'type',
          'enum',
          'const',
          'required',
          'minimum',
          'maximum',
          'multipleOf',
          'minLength',
          'maxLength',
          'minItems',
          'maxItems',
          'minProperties',
          'maxProperties',
        ].includes(key)
      ) {
        result[key] = entry
      } else if (key === 'properties') {
        result[key] = Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).map(([name, child]) => [name, project(child, depth + 1)])
        )
      } else if (key === 'items' || key === 'additionalProperties') {
        result[key] = Array.isArray(entry) ? entry.map((child) => project(child, depth + 1)) : project(entry, depth + 1)
      } else if (
        !['description', 'title', 'default', 'examples', '$defs', 'definitions', '$id', '$comment', '$schema'].includes(
          key
        )
      ) {
        // Never execute server-supplied regular expressions or format implementations on the UI thread.
        delegated = true
      }
    }
    return result
  }
  let local: ReturnType<typeof validatedToolSchema> | undefined
  try {
    local = validatedToolSchema(project(schema) as JSONSchema7 & Record<string, unknown>)
  } catch {
    delegated = true
  }
  let reported = false
  const warn = () => {
    if (reported) return
    reported = true
    report(
      'Some MCP schema constraints are validated by the server only; local validation checks supported structural constraints.'
    )
  }
  if (delegated) warn()
  return jsonSchema(schema, {
    async validate(value) {
      const result = await local?.validate?.(value)
      if (result?.success || (result && result.error instanceof ToolInputValidationError)) return result
      warn()
      return { success: true, value }
    },
  })
}
