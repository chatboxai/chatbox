import type { ToolExecutionOptions } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createChatBridgeHostTool } from '@shared/chatbridge/tools'
import { prepareToolsForExecution } from '@/packages/model-calls/stream-text'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

function getExecutionOptions(toolCallId: string): ToolExecutionOptions {
  return {
    toolCallId,
    messages: [],
  }
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-host-tool-contract',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['bridge'],
    },
    testCase,
    execute
  )
}

describe('ChatBridge host-coordinated tool execution', () => {
  it('wraps host-managed app tools through the stream-text seam while leaving generic tools unchanged', () =>
    traceScenario(
      'wraps host-managed app tools through the stream-text seam while leaving generic tools unchanged',
      async () => {
        const genericExecute = vi.fn(async (input: { query: string }) => ({
          echoed: input.query,
        }))

        const preparedTools = prepareToolsForExecution(
          {
            save_story: createChatBridgeHostTool({
              description: 'Persist the story state in the host-owned shell.',
              appId: 'story-builder',
              schemaVersion: 1,
              effect: 'side-effect',
              retryClassification: 'unsafe',
              inputSchema: z.object({
                title: z.string(),
                idempotencyKey: z.string(),
              }),
              execute: async (input) => ({
                saved: true,
                title: input.title,
              }),
            }),
            generic_search: {
              description: 'A normal non-ChatBridge tool.',
              execute: genericExecute,
            },
          },
          'session-3'
        )

        const hostManagedResult = await preparedTools.save_story.execute?.(
          {
            title: 'Checkpoint 1',
            idempotencyKey: 'idem-save-1',
          },
          getExecutionOptions('tool-save-story-host')
        )

        const genericResult = await preparedTools.generic_search.execute?.(
          {
            query: 'chatbridge',
          },
          getExecutionOptions('tool-generic-search')
        )

        expect(hostManagedResult).toMatchObject({
          kind: 'chatbridge.host.tool.record.v1',
          toolName: 'save_story',
          sessionId: 'session-3',
          executionAuthority: 'host',
          effect: 'side-effect',
          retryClassification: 'unsafe',
          invocation: {
            args: {
              idempotencyKey: 'idem-save-1',
              title: 'Checkpoint 1',
            },
            idempotencyKey: 'idem-save-1',
          },
          outcome: {
            status: 'success',
            result: {
              saved: true,
              title: 'Checkpoint 1',
            },
          },
        })

        expect(genericExecute).toHaveBeenCalledOnce()
        expect(genericResult).toEqual({
          echoed: 'chatbridge',
        })
      }
    ))
})
