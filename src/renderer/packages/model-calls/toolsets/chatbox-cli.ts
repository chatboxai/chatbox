import { validatedToolSchema } from '@shared/validated-tool-schema'
import type { ToolSet } from 'ai'
import { executeChatboxCli, getChatboxCliDescription } from '@/packages/chatbox-cli'
import type { ChatboxCliInput, ChatboxCliOptions, ChatboxCliToolContext } from '@/packages/chatbox-cli/types'

export function buildChatboxCliToolSet(options: ChatboxCliOptions = {}) {
  const executionCache = new Map<string, { signature: string; promise: Promise<Record<string, unknown>> }>()

  const chatbox_cli: ToolSet[string] = {
    description:
      'Run a controlled virtual Chatbox CLI command (not a shell) for account, read-only settings, conversation ' +
      'history, and background image generation. Usage rules are under Chatbox Virtual CLI.',
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Legacy CLI-style command string, e.g. "chatbox account status".',
        },
        argv: {
          type: 'array',
          items: { type: 'string' },
          description: 'Preferred structured arguments, e.g. ["settings", "get", "appearance.theme"].',
        },
      },
      additionalProperties: false,
    }),
    execute: (input, toolOptions) => {
      const cliInput = input as ChatboxCliInput
      const context = toolOptions as typeof toolOptions & ChatboxCliToolContext
      options.onUsed?.()

      const signature = JSON.stringify(cliInput)
      const cacheKey = toolOptions.toolCallId || signature
      const existing = executionCache.get(cacheKey)
      if (existing) {
        if (existing.signature !== signature) {
          return Promise.reject(new Error(`Tool call ${cacheKey} was reused with different Chatbox CLI arguments.`))
        }
        return existing.promise
      }

      const execution = executeChatboxCli(cliInput, context, options)
      executionCache.set(cacheKey, { signature, promise: execution })
      void execution.catch(() => {
        if (executionCache.get(cacheKey)?.promise === execution) {
          executionCache.delete(cacheKey)
        }
      })
      return execution
    },
  }

  return {
    description: getChatboxCliDescription(),
    tools: { chatbox_cli },
  }
}
