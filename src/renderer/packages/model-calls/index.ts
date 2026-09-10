import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import type { Message } from '@shared/types'
import { convertToModelMessages } from './message-utils'

export async function generateText(
  model: ModelInterface,
  messages: Message[],
  options: CallChatCompletionOptions = {}
) {
  return model.chat(await convertToModelMessages(messages, { modelSupportVision: model.isSupportVision() }), options)
}
