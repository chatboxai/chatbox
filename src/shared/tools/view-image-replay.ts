import type { ModelMessage } from 'ai'
import { isImageViewingToolName } from './view-image'
import { lastAssistantMessageIndex } from './view-image-batch'

const VIEW_IMAGE_LABEL_PREFIX = '[Image from view_image tool: '

function viewImageLabelFilePath(part: { type: string; text?: string }): string | undefined {
  if (part.type !== 'text' || !part.text?.startsWith(VIEW_IMAGE_LABEL_PREFIX) || !part.text.endsWith(']')) {
    return undefined
  }
  return part.text.slice(VIEW_IMAGE_LABEL_PREFIX.length, -1)
}

function isToolResultImagePart(part: { type: string; mediaType?: string }): boolean {
  return part.type === 'file' && part.mediaType?.startsWith('image/') === true
}

function followsToolImageResult(messages: ModelMessage[], messageIndex: number): boolean {
  const previousMessage = messageIndex > 0 ? messages[messageIndex - 1] : undefined
  return previousMessage?.role === 'tool'
}

export function boundToolResultImages(messages: ModelMessage[], limit: number): ModelMessage[] {
  const lastAssistant = lastAssistantMessageIndex(messages)
  let remainingImages = Math.max(0, Math.floor(limit))
  const reversedMessages: ModelMessage[] = []
  const omittedFilePathsByToolMessage = new Map<number, string[]>()

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message.role === 'user' && Array.isArray(message.content) && followsToolImageResult(messages, messageIndex)) {
      const boundedContent = [] as typeof message.content
      for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = message.content[partIndex]
        const label = partIndex > 0 ? message.content[partIndex - 1] : undefined
        const filePath = label ? viewImageLabelFilePath(label) : undefined
        if (part.type === 'image' && label && filePath !== undefined) {
          if (messageIndex > lastAssistant || remainingImages > 0) {
            boundedContent.unshift(label, part)
            if (messageIndex <= lastAssistant) remainingImages -= 1
          } else {
            const omittedFilePaths = omittedFilePathsByToolMessage.get(messageIndex - 1) ?? []
            omittedFilePaths.push(filePath)
            omittedFilePathsByToolMessage.set(messageIndex - 1, omittedFilePaths)
          }
          partIndex -= 1
          continue
        }
        boundedContent.unshift(part)
      }
      if (boundedContent.length > 0) reversedMessages.push({ ...message, content: boundedContent })
      continue
    }

    if (message.role === 'tool') {
      const boundedContent = [] as typeof message.content
      const omittedFilePaths = omittedFilePathsByToolMessage.get(messageIndex) ?? []
      for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = message.content[partIndex]
        // Tool messages also carry approval responses, which have no output to bound.
        if (part.type !== 'tool-result') {
          boundedContent.unshift(part)
          continue
        }
        const output = part.output
        if (output.type !== 'content') {
          if (output.type === 'text') {
            const outputText = output.value
            const omittedPathIndex = omittedFilePaths.findIndex((filePath) =>
              outputText.startsWith(`Viewed image: ${filePath}. The image is attached`)
            )
            if (omittedPathIndex >= 0) {
              const [filePath] = omittedFilePaths.splice(omittedPathIndex, 1)
              boundedContent.unshift({
                ...part,
                output: {
                  type: 'text',
                  value: `Viewed image: ${filePath}. Image omitted from this replay to keep the request payload bounded.`,
                },
              })
              continue
            }
          }
          boundedContent.unshift(part)
          continue
        }
        const boundedValue = [] as typeof output.value
        for (let valueIndex = output.value.length - 1; valueIndex >= 0; valueIndex -= 1) {
          const valuePart = output.value[valueIndex]
          if (!isToolResultImagePart(valuePart)) {
            boundedValue.unshift(valuePart)
            continue
          }
          if ((messageIndex > lastAssistant && isImageViewingToolName(part.toolName)) || remainingImages > 0) {
            boundedValue.unshift(valuePart)
            if (messageIndex <= lastAssistant || !isImageViewingToolName(part.toolName)) remainingImages -= 1
          }
        }
        if (boundedValue.length < output.value.length) {
          boundedValue.push({
            type: 'text',
            text: 'Historical image pixels omitted from this request. View or capture it again if needed.',
          })
        }
        boundedContent.unshift({ ...part, output: { ...output, value: boundedValue } })
      }
      reversedMessages.push({ ...message, content: boundedContent })
      continue
    }

    reversedMessages.push(message)
  }

  return reversedMessages.reverse()
}
