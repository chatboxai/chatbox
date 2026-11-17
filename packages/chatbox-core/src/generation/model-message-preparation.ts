import type { ModelInterface } from '@shared/models/types'
import {
  type ConvertToModelMessagesOptions,
  convertToModelMessages,
  type ModelImageResolver,
} from '@shared/services/model-message-converter'
import type { Message } from '@shared/types'
import { sequenceMessages } from '@shared/utils/message'

export async function prepareModelMessages(options: {
  messages: Message[]
  model: ModelInterface
  resolveImage: ModelImageResolver
  conversion?: Omit<ConvertToModelMessagesOptions, 'modelSupportVision'>
}) {
  const roleCompatibleMessages = options.model.isSupportSystemMessage()
    ? options.messages
    : options.messages.map((message) => (message.role === 'system' ? { ...message, role: 'user' as const } : message))
  const promptMessages = sequenceMessages(roleCompatibleMessages)
  const coreMessages = await convertToModelMessages(promptMessages, options.resolveImage, {
    ...options.conversion,
    modelSupportVision: options.model.isSupportVision(),
  })
  return { coreMessages, promptMessages }
}
