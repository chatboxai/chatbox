import type { Message, MessageContentParts } from '@shared/types'
import { getChatBridgeAppSummaryForModel } from '@shared/chatbridge'
import { buildChatBridgeAppStateDigest, formatChatBridgeAppStateDigest, getLatestChatBridgeAppScreenshot } from '@shared/chatbridge'
import type { ModelDependencies } from '@shared/types/adapters'
import type { FilePart, ImagePart, ModelMessage, TextPart } from 'ai'
import dayjs from 'dayjs'
import { compact } from 'lodash'
import { createModelDependencies } from '@/adapters'
import { cloneMessage, getMessageText } from '@/utils/message'

async function convertContentParts<T extends TextPart | ImagePart | FilePart>(
  contentParts: MessageContentParts,
  imageType: 'image' | 'file',
  dependencies: ModelDependencies,
  options?: { modelSupportVision: boolean }
): Promise<T[]> {
  return compact(
    await Promise.all(
      contentParts.map(async (c) => {
        if (c.type === 'text') {
          return { type: 'text', text: c.text } as T
        } else if (c.type === 'image') {
          if (options?.modelSupportVision === false) {
            return { type: 'text', text: `This is an image, OCR Result: \n${c.ocrResult}` } as T
          }
          try {
            const imageData = await dependencies.storage.getImage(c.storageKey)
            if (!imageData) {
              console.warn(`Image not found for storage key: ${c.storageKey}`)
              return null
            }
            const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, '')
            const mediaType = imageData.match(/^data:([^;]+)/)?.[1] || 'image/png'

            if (imageType === 'image') {
              return {
                type: 'image',
                image: base64Data,
                mediaType,
              } as T
            } else {
              return {
                type: 'file',
                data: base64Data,
                mediaType,
              } as T
            }
          } catch (error) {
            console.error(`Failed to get image for storage key ${c.storageKey}:`, error)
            return null
          }
        }
        return null
      })
    )
  )
}

async function convertUserContentParts(
  contentParts: MessageContentParts,
  dependencies: ModelDependencies,
  options?: { modelSupportVision: boolean }
): Promise<Array<TextPart | ImagePart>> {
  return await convertContentParts<TextPart | ImagePart>(contentParts, 'image', dependencies, options)
}

async function convertAssistantContentParts(
  contentParts: MessageContentParts,
  dependencies: ModelDependencies
): Promise<Array<TextPart | FilePart>> {
  const results: Array<TextPart | FilePart> = []

  for (const part of contentParts) {
    if (part.type === 'text') {
      results.push({ type: 'text', text: part.text })
      continue
    }

    if (part.type === 'image') {
      try {
        const imageData = await dependencies.storage.getImage(part.storageKey)
        if (!imageData) {
          console.warn(`Image not found for storage key: ${part.storageKey}`)
          continue
        }
        const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, '')
        const mediaType = imageData.match(/^data:([^;]+)/)?.[1] || 'image/png'

        results.push({
          type: 'file',
          data: base64Data,
          mediaType,
        })
      } catch (error) {
        console.error(`Failed to get image for storage key ${part.storageKey}:`, error)
      }
      continue
    }

    if (part.type === 'app') {
      const summaryForModel = getChatBridgeAppSummaryForModel(part)
      const digest = formatChatBridgeAppStateDigest(buildChatBridgeAppStateDigest(part))
      const latestScreenshot = getLatestChatBridgeAppScreenshot(part.values)
      const text = [summaryForModel, digest].filter(Boolean).join('\n')

      if (text) {
        results.push({
          type: 'text',
          text,
        })
      }

      if (latestScreenshot) {
        try {
          const imageData = await dependencies.storage.getImage(latestScreenshot.storageKey)
          if (!imageData) {
            console.warn(`Image not found for storage key: ${latestScreenshot.storageKey}`)
            continue
          }

          const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, '')
          const mediaType = imageData.match(/^data:([^;]+)/)?.[1] || 'image/png'
          results.push({
            type: 'file',
            data: base64Data,
            mediaType,
          })
        } catch (error) {
          console.error(`Failed to get image for storage key ${latestScreenshot.storageKey}:`, error)
        }
      }
    }
  }

  return results
}

export async function convertToModelMessages(
  messages: Message[],
  options?: { modelSupportVision: boolean }
): Promise<ModelMessage[]> {
  const dependencies = await createModelDependencies()
  const results = await Promise.all(
    messages.map(async (m): Promise<ModelMessage | null> => {
      switch (m.role) {
        case 'system':
          return {
            role: 'system' as const,
            content: getMessageText(m),
          }
        case 'user': {
          const contentParts = await convertUserContentParts(m.contentParts || [], dependencies, options)
          return {
            role: 'user' as const,
            content: contentParts,
          }
        }
        case 'assistant': {
          const contentParts = m.contentParts || []
          return {
            role: 'assistant' as const,
            content: await convertAssistantContentParts(contentParts, dependencies),
          }
        }
        case 'tool':
          return null
        default: {
          const _exhaustiveCheck: never = m.role
          throw new Error(`Unknown role: ${_exhaustiveCheck}`)
        }
      }
    })
  )
  
  // Filter out null values manually instead of using compact
  return results.filter((result): result is ModelMessage => result !== null)
}

/**
 * 在 system prompt 中注入模型信息
 * @param model
 * @param messages
 * @returns
 */
export function injectModelSystemPrompt(
  model: string,
  messages: Message[],
  additionalInfo: string,
  role: 'system' | 'user' = 'system'
) {
  const metadataPrompt = `Current model: ${model}\nCurrent date: ${dayjs().format(
    'YYYY-MM-DD'
  )}\n Additional info for this conversation: ${additionalInfo}\n\n`
  let hasInjected = false
  return messages.map((m) => {
    if (m.role === role && !hasInjected) {
      m = cloneMessage(m) // 复制，防止原始数据在其他地方被直接渲染使用
      m.contentParts = [{ type: 'text', text: metadataPrompt + getMessageText(m) }]
      hasInjected = true
    }
    return m
  })
}
