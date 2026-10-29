import type { SandboxProvider } from '@shared/sandbox-provider'
import type { JSONSchema7 } from 'json-schema'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/packages/user-exec-approval', () => ({
  requestFileMutationApproval: vi.fn(),
}))

import { buildFilesystemTools } from './filesystem'

function assertOpenAiCompatibleFunctionSchema(schema: JSONSchema7) {
  expect(schema.type).toBe('object')
  expect(schema).not.toHaveProperty('oneOf')
  expect(schema).not.toHaveProperty('anyOf')
  expect(schema).not.toHaveProperty('allOf')
  expect(schema).not.toHaveProperty('enum')
  expect(schema).not.toHaveProperty('not')
}

function getJsonSchema(inputSchema: unknown): JSONSchema7 {
  return (inputSchema as { jsonSchema: JSONSchema7 }).jsonSchema
}

function executeTool(tool: unknown, input: unknown) {
  const executableTool = tool as {
    execute?: (input: unknown, options: { toolCallId: string; messages: [] }) => unknown
  }
  return executableTool.execute?.(input, { toolCallId: 'tool-call-id', messages: [] })
}

describe('edit file tool schemas', () => {
  test('filesystem edit_file does not use top-level composition keywords', () => {
    const tools = buildFilesystemTools({
      sessionId: 'session-id',
      provider: {} as SandboxProvider,
    }).tools
    const schema = getJsonSchema(tools.edit_file.inputSchema)

    assertOpenAiCompatibleFunctionSchema(schema)
    expect(schema.required).toEqual(['file_path', 'edits'])
    expect(schema.properties).toHaveProperty('edits')
    expect(schema.properties).not.toHaveProperty('old_text')
    expect(schema.properties).not.toHaveProperty('new_text')
  })

  test('filesystem edit_file rejects calls without edit content', async () => {
    const tools = buildFilesystemTools({}).tools
    const result = await executeTool(tools.edit_file, { file_path: '/tmp/example.txt' })

    expect(result).toEqual({ error: 'Provide edits[] or both old_text and new_text.' })
  })
})
