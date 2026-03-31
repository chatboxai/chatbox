import type { ToolExecutionOptions } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
  createChatBridgeHostTool,
  getChatBridgeHostToolPartUpdate,
  wrapChatBridgeHostTools,
} from './tools'

function getExecutionOptions(toolCallId: string): ToolExecutionOptions {
  return {
    toolCallId,
    messages: [],
  }
}

describe('ChatBridge host tool contract', () => {
  it('rejects unsupported schema versions before execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))

    const toolSet = wrapChatBridgeHostTools(
      {
        open_story: createChatBridgeHostTool({
          description: 'Open the reviewed story surface.',
          appId: 'story-builder',
          schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION + 1,
          effect: 'read',
          retryClassification: 'safe',
          inputSchema: z.object({
            prompt: z.string(),
          }),
          execute,
        }),
      },
      {
        sessionId: 'session-1',
      }
    )

    const result = await toolSet.open_story.execute?.({ prompt: 'Draft a scene.' }, getExecutionOptions('tool-open-story'))

    expect(execute).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'open_story',
      sessionId: 'session-1',
      outcome: {
        status: 'rejected',
        error: {
          code: 'schema_version_mismatch',
        },
      },
    })
  })

  it('rejects side-effecting tools that omit an idempotency key', async () => {
    const execute = vi.fn(async () => ({ saved: true }))

    const toolSet = wrapChatBridgeHostTools({
      save_story: createChatBridgeHostTool({
        description: 'Save the current story draft.',
        appId: 'story-builder',
        schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
        effect: 'side-effect',
        retryClassification: 'unsafe',
        inputSchema: z.object({
          title: z.string(),
          idempotencyKey: z.string().optional(),
        }),
        execute,
      }),
    })

    const result = await toolSet.save_story.execute?.({ title: 'Act I' }, getExecutionOptions('tool-save-story-missing-idem'))

    expect(execute).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'save_story',
      effect: 'side-effect',
      retryClassification: 'unsafe',
      outcome: {
        status: 'rejected',
        error: {
          code: 'missing_idempotency_key',
        },
      },
    })
  })

  it('normalizes host-managed tool records for persisted tool-call parts', async () => {
    const toolSet = wrapChatBridgeHostTools(
      {
        save_story: createChatBridgeHostTool({
          description: 'Persist the story draft.',
          appId: 'story-builder',
          schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
          effect: 'side-effect',
          retryClassification: 'safe',
          inputSchema: z.object({
            title: z.string(),
            idempotencyKey: z.string(),
            metadata: z.object({
              sceneCount: z.number(),
            }),
          }),
          execute: async () => ({
            savedAt: new Date('2026-03-31T12:00:00.000Z'),
            publish: () => 'hidden',
            receipt: {
              revision: 7,
            },
          }),
        }),
      },
      {
        sessionId: 'session-2',
      }
    )

    const result = await toolSet.save_story.execute?.(
      {
        title: 'Act I',
        idempotencyKey: 'idem-1',
        metadata: {
          sceneCount: 3,
        },
      },
      getExecutionOptions('tool-save-story-success')
    )

    const partUpdate = getChatBridgeHostToolPartUpdate(result)

    expect(partUpdate).not.toBeNull()
    expect(partUpdate).toMatchObject({
      state: 'result',
      args: {
        idempotencyKey: 'idem-1',
        metadata: {
          sceneCount: 3,
        },
        title: 'Act I',
      },
    })

    expect(partUpdate?.result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'save_story',
      executionAuthority: 'host',
      invocation: {
        idempotencyKey: 'idem-1',
      },
      outcome: {
        status: 'success',
        result: {
          publish: '[function]',
          receipt: {
            revision: 7,
          },
          savedAt: '2026-03-31T12:00:00.000Z',
        },
      },
    })
  })

  it('normalizes execution errors before they are persisted', async () => {
    const toolSet = wrapChatBridgeHostTools(
      {
        save_story: createChatBridgeHostTool({
          description: 'Persist the story draft.',
          appId: 'story-builder',
          schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
          effect: 'side-effect',
          retryClassification: 'unsafe',
          inputSchema: z.object({
            title: z.string(),
            idempotencyKey: z.string(),
          }),
          execute: async () => {
            throw {
              occurredAt: new Date('2026-03-31T13:00:00.000Z'),
              publish: () => 'hidden',
              nested: {
                revision: 9,
              },
            }
          },
        }),
      },
      {
        sessionId: 'session-4',
      }
    )

    const result = await toolSet.save_story.execute?.(
      {
        title: 'Act II',
        idempotencyKey: 'idem-2',
      },
      getExecutionOptions('tool-save-story-error')
    )

    const partUpdate = getChatBridgeHostToolPartUpdate(result)

    expect(partUpdate).not.toBeNull()
    expect(partUpdate).toMatchObject({
      state: 'error',
    })

    expect(partUpdate?.result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'save_story',
      outcome: {
        status: 'error',
        error: {
          code: 'tool_execution_failed',
          details: {
            nested: {
              revision: 9,
            },
            occurredAt: '2026-03-31T13:00:00.000Z',
            publish: '[function]',
          },
        },
      },
    })
  })
})
