import { buildContext, flattenToolCallPartsToText } from '@shared/context'
import type { Message, MessageContentParts } from '@shared/types'
import type { MemoryToolContext } from '@shared/types/agent-persona'
import type { ToolSet } from 'ai'
import type { GenerationPreparationPort, GenerationPreparationRequest } from './GenerationService'
import { prepareModelMessages } from './model-message-preparation'

export interface BasicGenerationToolPreparation {
  fallbackToolCallPart?: MessageContentParts[number]
  infoParts?: MessageContentParts
  instructions?: string
  tools: ToolSet
  memoryToolContext?: MemoryToolContext
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
              text: `${message.contentParts
                .filter((part): part is Extract<MessageContentParts[number], { type: 'text' }> => part.type === 'text')
                .map((part) => part.text)
                .join('\n')}\n\n${instructions}`,
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
    })
    const tools = (await this.options.prepareTools?.(request, promptMessages)) ?? { tools: {} }
    if (Object.keys(tools.tools).length === 0) {
      promptMessages = flattenToolCallPartsToText(promptMessages)
    }
    if (tools.instructions?.trim()) {
      promptMessages = injectInstructions(
        promptMessages,
        tools.instructions.trim(),
        () => `generation-instructions-${request.session.id}`
      )
    }
    const preparedMessages = await prepareModelMessages({
      messages: promptMessages,
      model: request.model,
      resolveImage: (storageKey) => request.attachments.read(storageKey),
      conversion: {
        ensureGoogleFunctionCallSignatures: request.model.apiStyle === 'google',
      },
    })
    promptMessages = preparedMessages.promptMessages

    return {
      promptMessages,
      coreMessages: preparedMessages.coreMessages,
      tools: tools.tools,
      memoryToolContext: tools.memoryToolContext,
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
