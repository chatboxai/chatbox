import type { JSONSchema7 } from '@ai-sdk/provider'
import { type OutputUnit, type Schema as ValidationSchema, type SchemaDraft, Validator } from '@cfworker/json-schema'
import { jsonSchema } from 'ai'

export class ToolInputValidationError extends Error {
  readonly issues: readonly OutputUnit[]
  constructor(issues: readonly OutputUnit[]) {
    const details = issues
      .slice(0, 8)
      .map((issue) => `- ${issue.instanceLocation || '#'}: ${issue.error.slice(0, 400)}`)
      .join('\n')
    super(`Invalid tool arguments. Tool was not executed.\n${details}\nCorrect these fields and call the tool again.`)
    this.issues = issues.slice(0, 8)
    this.name = 'ToolInputValidationError'
  }
}

function schemaDraft(schema: JSONSchema7): SchemaDraft {
  if (!schema.$schema) return '2020-12'
  if (/draft-04\/schema#?$/.test(schema.$schema)) return '4'
  if (/draft-0[67]\/schema#?$/.test(schema.$schema)) return '7'
  if (/draft\/2019-09\/schema#?$/.test(schema.$schema)) return '2019-09'
  if (/draft\/2020-12\/schema#?$/.test(schema.$schema)) return '2020-12'
  throw new Error(`Unsupported tool schema dialect: ${schema.$schema}`)
}

/** Keep the model-facing schema and runtime validation backed by the same contract. */
export function validatedToolSchema<INPUT = unknown>(
  schema: JSONSchema7 & Record<string, unknown>,
  options: { normalize?: (value: unknown) => unknown } = {}
) {
  const snapshot = JSON.parse(JSON.stringify(schema)) as JSONSchema7
  let validator: Validator | undefined
  return jsonSchema<INPUT>(snapshot, {
    validate(value) {
      try {
        // Initialize lazily so schema setup errors become bounded tool diagnostics.
        // Reference annotations stay in a private copy and never enter model requests.
        validator ??= new Validator(
          JSON.parse(JSON.stringify(snapshot)) as ValidationSchema,
          schemaDraft(snapshot),
          true
        )
        const input = options.normalize ? options.normalize(value) : value
        const result = validator.validate(input)
        return result.valid
          ? { success: true, value: input as INPUT }
          : { success: false, error: new ToolInputValidationError(result.errors) }
      } catch (error) {
        return {
          success: false,
          error: new Error(
            `Unable to validate tool arguments. Tool was not executed. ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}`
          ),
        }
      }
    },
  })
}
