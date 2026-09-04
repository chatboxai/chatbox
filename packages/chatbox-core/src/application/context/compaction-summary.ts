import type { ModelInterface } from '@shared/models/types'
import { summarizeConversation } from '@shared/prompts'
import type { ModelImageResolver } from '@shared/services/model-message-converter'
import { prepareModelMessages } from '../../generation/model-message-preparation'
import type { Message } from '../../types'

export async function generateCompactionSummaryWithModel(options: {
  model: ModelInterface
  messages: Message[]
  languageName: string
  resolveImage?: ModelImageResolver
  onStreamUpdate?: (text: string) => void
}): Promise<{ success: boolean; summary?: string; error?: Error }> {
  if (options.messages.length === 0) return { success: true, summary: '' }

  try {
    const { coreMessages } = await prepareModelMessages({
      messages: summarizeConversation(options.messages, options.languageName),
      model: options.model,
      resolveImage: options.resolveImage ?? (async () => null),
    })
    const result = await options.model.chat(coreMessages, {
      onResultChange(data) {
        if (!data.contentParts || !options.onStreamUpdate) return
        options.onStreamUpdate(
          data.contentParts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')
        )
      },
    })
    const summary =
      result.contentParts
        ?.filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .replace(/<think>.*?<\/think>/gs, '')
        .trim() ?? ''
    return { success: true, summary }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error : new Error(String(error)) }
  }
}
