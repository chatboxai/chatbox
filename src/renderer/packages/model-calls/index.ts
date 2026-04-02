import type { ModelInterface } from '@shared/models/types'
import type { Message } from '@shared/types'
import { getLangSmithErrorMessage, type LangSmithTraceContext } from '@shared/utils/langsmith_adapter'
import { langsmith } from '@/adapters/langsmith'
import { getMessageText } from '@shared/utils/message'
import { convertToModelMessages } from './message-utils'

export { generateImage } from './generate-image'
export { streamText } from './stream-text'

function summarizeMessages(messages: Message[]) {
  return messages.map((message) => ({
    role: message.role,
    contentPreview: getMessageText(message).slice(0, 240),
  }))
}

export async function generateText(
  model: ModelInterface,
  messages: Message[],
  traceOptions?: {
    name?: string
    metadata?: Record<string, unknown>
    tags?: string[]
  }
) {
  const traceRun = await langsmith.startRun({
    name: traceOptions?.name ?? 'chatbox.generate_text',
    runType: 'chain',
    inputs: {
      modelId: model.modelId,
      messages: summarizeMessages(messages),
    },
    metadata: traceOptions?.metadata,
    tags: ['chatbox', 'renderer', ...(traceOptions?.tags ?? [])],
  })

  try {
    const result = await model.chat(await convertToModelMessages(messages, { modelSupportVision: model.isSupportVision() }), {
      traceContext: {
        name: `${traceOptions?.name ?? 'chatbox.generate_text'}.llm`,
        parentRunId: traceRun.runId,
        metadata: traceOptions?.metadata,
        tags: traceOptions?.tags,
      } satisfies LangSmithTraceContext,
    })
    await traceRun.end({
      outputs: {
        contentPartTypes: Array.from(new Set(result.contentParts?.map((part) => part.type) ?? [])),
      },
    })
    return result
  } catch (error) {
    await traceRun.end({
      error: getLangSmithErrorMessage(error),
    })
    throw error
  }
}
