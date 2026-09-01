import { buildContext } from '@shared/context'
import { convertToModelMessages } from '@shared/services/model-message-converter'
import type { Message, MessageContentParts } from '@shared/types'
import { sequenceMessages } from '@shared/utils/message'
import type { ToolSet } from 'ai'
import type { GenerationPreparationPort, GenerationPreparationRequest } from './GenerationService'

export interface BasicGenerationToolPreparation {
  fallbackToolCallPart?: MessageContentParts[number]
  infoParts?: MessageContentParts
  instructions?: string
  tools: ToolSet
}

export interface BasicGenerationPreparationOptions<TContext> {
  prepareTools?(
    request: GenerationPreparationRequest<TContext>,
    promptMessages: Message[]
  ): Promise<BasicGenerationToolPreparation>
}

function injectInstructions(messages: Message[], instructions: string, createId: () => string): Message[] {
  const systemIndex = messages.findIndex((message) => message.role === 'system')
  if (systemIndex < 0) {
    return [
      {
        id: createId(),
        role: 'system',
        contentParts: [{ type: 'text', text: instructions }],
      },
      ...messages,
    ]
  }
  return messages.map((message, index) =>
    index === systemIndex
      ? {
          ...message,
          contentParts: [
            {
              type: 'text',
              text: `${instructions}\n\n${message.contentParts
                .filter((part): part is Extract<MessageContentParts[number], { type: 'text' }> => part.type === 'text')
                .map((part) => part.text)
                .join('\n')}`,
            },
          ],
        }
      : message
  )
}

/**
 * Portable preparation path for hosts that intentionally expose no desktop
 * Sandbox, MCP or Knowledge Base runtime. Context filtering, attachment
 * injection and AI SDK message conversion stay shared with the Renderer.
 */
export class BasicGenerationPreparation<TContext> implements GenerationPreparationPort<TContext> {
  constructor(private readonly options: BasicGenerationPreparationOptions<TContext> = {}) {}

  async prepare(request: GenerationPreparationRequest<TContext>) {
    let promptMessages = await buildContext(request.messages.slice(0, request.targetMessageIndex), {
      attachmentResolver: request.attachments,
      compactionPoints: request.compactionPoints,
      maxContextMessageCount: request.settings.maxContextMessageCount,
      modelSupportToolUseForFile: false,
      toolCleanupMode: 'none',
      preserveToolCallMessageIds: request.preserveLastPromptMessageToolCalls
        ? [request.messages[request.targetMessageIndex - 1]?.id].filter((id): id is string => Boolean(id))
        : undefined,
    })
    const tools = (await this.options.prepareTools?.(request, promptMessages)) ?? { tools: {} }
    if (tools.instructions?.trim()) {
      promptMessages = injectInstructions(
        promptMessages,
        tools.instructions.trim(),
        () => `generation-instructions-${request.session.id}`
      )
    }
    if (!request.model.isSupportSystemMessage()) {
      promptMessages = promptMessages.map((message) =>
        message.role === 'system' ? { ...message, role: 'user' as const } : message
      )
    }
    promptMessages = sequenceMessages(promptMessages)
    const coreMessages = await convertToModelMessages(
      promptMessages,
      (storageKey) => request.attachments.read(storageKey),
      {
        modelSupportVision: request.model.isSupportVision(),
        ensureGoogleFunctionCallSignatures: request.model.apiStyle === 'google',
      }
    )

    return {
      promptMessages,
      coreMessages,
      tools: tools.tools,
      chatOptions: {
        sessionId: request.session.id,
        agentMode: false,
        signal: request.signal,
        providerOptions: request.providerOptions,
      },
      infoParts: tools.infoParts ?? [],
      fallbackToolCallPart: tools.fallbackToolCallPart,
    }
  }
}
