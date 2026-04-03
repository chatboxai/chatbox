import { createLangSmithConversationMetadata } from '@shared/models/tracing'
import type { ModelInterface } from '@shared/models/types'
import type { Message } from '@shared/types'
import { getLangSmithErrorMessage } from '@shared/utils/langsmith_adapter'
import { getMessageText } from '@shared/utils/message'
import { createModelDependencies } from '@/adapters'
import { langsmith } from '@/adapters/langsmith'

export async function generateImage(
  model: ModelInterface,
  params: {
    message: Message // 图片并不关注session context，只需要上一条用户消息
    num: number
    sessionId?: string
    threadId?: string
    messageId?: string
  },
  callback?: (picBase64: string) => void
) {
  const prompt = getMessageText(params.message)
  const traceMetadata = createLangSmithConversationMetadata(
    {
      sessionId: params.sessionId,
      threadId: params.threadId,
      messageId: params.messageId,
    },
    {
      operation: 'generateImage',
    }
  )
  const traceRun = await langsmith.startRun({
    name: 'chatbox.image_generation.generate',
    runType: 'chain',
    inputs: {
      sessionId: params.sessionId ?? null,
      threadId: params.threadId ?? params.sessionId ?? null,
      messageId: params.messageId ?? null,
      modelId: model.modelId,
      messagePreview: prompt.slice(0, 240),
      num: params.num,
      referenceImageCount: params.message.contentParts.filter((part) => part.type === 'image').length,
    },
    metadata: traceMetadata,
    tags: ['chatbox', 'renderer', 'image-generation'],
  })

  try {
    const dependencies = await createModelDependencies()
    const images = await Promise.all(
      params.message.contentParts
        .filter((c) => c.type === 'image')
        .map(async (c) => ({ imageUrl: await dependencies.storage.getImage(c.storageKey) }))
    )

    const result = await model.paint(
      {
        prompt,
        images,
        num: params.num,
        traceContext: {
          name: 'chatbox.image_generation.generate.paint',
          parentRunId: traceRun.runId,
          metadata: {
            ...traceMetadata,
            modelId: model.modelId,
          },
          tags: ['chatbox', 'renderer', 'image-generation'],
        },
      },
      undefined,
      callback
    )

    await traceRun.end({
      outputs: {
        imageCount: result.length,
        status: result.length > 0 ? 'success' : 'empty',
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
