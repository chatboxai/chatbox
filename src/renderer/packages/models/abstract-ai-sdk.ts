import storage from '@/storage'
import * as settingActions from '@/stores/settingActions'
import { saveImage } from '@/utils/image'
import { cloneMessage, getMessageText, sequenceMessages } from '@/utils/message'
import * as Sentry from '@sentry/react'
import {
  APICallError,
  CoreMessage,
  CoreSystemMessage,
  FilePart,
  experimental_generateImage as generateImage,
  ImageModel,
  ImagePart,
  LanguageModelV1,
  streamText,
  TextPart,
  ToolSet,
} from 'ai'
import dayjs from 'dayjs'
import { compact } from 'lodash'
import {
  Message,
  MessageContentParts,
  MessageTextPart,
  MessageToolCallPart,
  ProviderModelInfo,
  StreamTextResult,
} from 'src/shared/types'
import { ApiError, ChatboxAIAPIError } from './errors'
import { CallChatCompletionOptions, ModelInterface } from './types'

// ai sdk CallSettings类型的子集
export interface CallSettings {
  temperature?: number
  topP?: number
  providerOptions?: CoreSystemMessage['providerOptions']
}

export default abstract class AbstractAISDKModel implements ModelInterface {
  public name = 'AI SDK Model'
  public injectDefaultMetadata = true

  public isSupportToolUse() {
    return this.options.model.capabilities?.includes('tool_use') || false
  }
  public isSupportVision() {
    return this.options.model.capabilities?.includes('vision') || false
  }
  public isSupportReasoning() {
    return this.options.model.capabilities?.includes('reasoning') || false
  }

  public constructor(public options: { model: ProviderModelInfo }) {}

  protected abstract getChatModel(options: CallChatCompletionOptions): LanguageModelV1

  protected getImageModel(): ImageModel | null {
    return null
  }

  public isSupportSystemMessage() {
    return true
  }

  protected getCallSettings(options: CallChatCompletionOptions): CallSettings {
    return {}
  }

  public async chat(messages: Message[], options: CallChatCompletionOptions): Promise<StreamTextResult> {
    try {
      return await this._callChatCompletion(messages, options)
    } catch (e) {
      if (e instanceof ChatboxAIAPIError) {
        throw e
      }
      // 如果当前模型不支持图片输入，抛出对应的错误
      if (
        e instanceof ApiError &&
        e.message.includes('Invalid content type. image_url is only supported by certain models.')
      ) {
        // 根据当前 IP，判断是否在错误中推荐 Chatbox AI 4
        const remoteConfig = settingActions.getRemoteConfig()
        if (remoteConfig.setting_chatboxai_first) {
          throw ChatboxAIAPIError.fromCodeName('model_not_support_image', 'model_not_support_image')
        } else {
          throw ChatboxAIAPIError.fromCodeName('model_not_support_image', 'model_not_support_image_2')
        }
      }

      // 添加请求信息到 Sentry
      Sentry.withScope((scope) => {
        scope.setTag('provider_name', this.name)
        scope.setExtra('messages', JSON.stringify(messages))
        scope.setExtra('options', JSON.stringify(options))
        Sentry.captureException(e)
      })
      throw e
    }
  }

  public async paint(
    prompt: string,
    num: number,
    callback?: (picBase64: string) => any,
    signal?: AbortSignal
  ): Promise<string[]> {
    const imageModel = this.getImageModel()
    if (!imageModel) {
      throw new ApiError('Provider doesnt support image generation')
    }
    const result = await generateImage({
      model: imageModel,
      prompt,
      n: num,
      abortSignal: signal,
    })
    const dataUrls = result.images.map((image) => `data:${image.mimeType};base64,${image.base64}`)
    for (const dataUrl of dataUrls) {
      callback?.(dataUrl)
    }
    return dataUrls
  }

  private async _callChatCompletion<T extends ToolSet>(
    rawMessages: Message[],
    options: CallChatCompletionOptions<T>
  ): Promise<StreamTextResult> {
    const model = this.getChatModel(options)

    if (this.injectDefaultMetadata && this.isSupportSystemMessage()) {
      rawMessages = injectModelSystemPrompt(model.modelId, rawMessages)
    }
    if (!this.isSupportSystemMessage()) {
      rawMessages = rawMessages.map((m) => ({ ...m, role: m.role === 'system' ? 'user' : m.role }))
    }

    const messages = sequenceMessages(rawMessages)
    const coreMessages = await convertToCoreMessages(messages)
    const callSettings = this.getCallSettings(options)

    const result = streamText({
      model,
      messages: coreMessages,
      maxSteps: Number.MAX_SAFE_INTEGER,
      tools: options.tools,
      abortSignal: options.signal,
      ...callSettings,
    })

    let contentParts: MessageContentParts = []
    let currentTextPart: MessageTextPart | undefined = undefined
    let reasoningContent = ''

    for await (const chunk of result.fullStream) {
      console.debug('stream chunk', chunk)
      if (chunk.type === 'text-delta') {
        if (!currentTextPart) {
          currentTextPart = { type: 'text', text: '' }
          contentParts.push(currentTextPart)
        }
        currentTextPart.text += chunk.textDelta
      } else if (chunk.type === 'reasoning') {
        reasoningContent += chunk.textDelta
      } else if (chunk.type === 'tool-call') {
        currentTextPart = undefined
        contentParts.push({
          type: 'tool-call',
          state: 'call',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.args,
        })
      } else if (chunk.type === 'tool-result') {
        const part = contentParts.find((p) => p.type === 'tool-call' && p.toolCallId === chunk.toolCallId) as
          | MessageToolCallPart
          | undefined
        if (part) {
          if ((chunk.result as unknown) instanceof Error) {
            console.debug('mcp tool execute error', chunk.result)
            part.state = 'error'
            part.result = JSON.parse(JSON.stringify(chunk.result))
          } else {
            part.state = 'result'
            part.result = chunk.result
          }
        }
      } else if (chunk.type === 'file' && chunk.mimeType.startsWith('image/')) {
        currentTextPart = undefined
        const storageKey = await saveImage('response', `data:${chunk.mimeType};base64,${chunk.base64}`)
        contentParts.push({ type: 'image', storageKey })
      } else if (chunk.type === 'error') {
        const error = chunk.error
        if (APICallError.isInstance(error)) {
          throw new ApiError(`Error from ${this.name}`, error.responseBody)
        }
        if (error instanceof ChatboxAIAPIError) {
          throw error
        }
        throw new ApiError(`Error from ${this.name}: ${chunk.error}`)
      } else {
        continue
      }
      options.onResultChange?.({ reasoningContent, contentParts })
    }

    const usage = await result.usage
    options.onResultChange?.({
      contentParts,
      reasoningContent,
      tokenCount: usage?.completionTokens,
      tokensUsed: usage?.totalTokens,
    })

    return { contentParts, reasoningContent, usage }
  }
}

async function convertContentParts<T extends TextPart | ImagePart | FilePart>(
  contentParts: MessageContentParts,
  imageType: 'image' | 'file'
): Promise<T[]> {
  return compact(
    await Promise.all(
      contentParts.map(async (c) => {
        if (c.type === 'text') {
          return { type: 'text', text: c.text! } as T
        } else if (c.type === 'image') {
          const imageData = (await storage.getBlob(c.storageKey))?.replace(/^data:image\/[^;]+;base64,/, '')
          return {
            type: imageType,
            ...(imageType === 'image' ? { image: imageData } : { data: imageData }),
            mimeType: 'image/png',
          } as T
        }
        return null
      })
    )
  )
}

async function convertUserContentParts(contentParts: MessageContentParts): Promise<Array<TextPart | ImagePart>> {
  return convertContentParts<TextPart | ImagePart>(contentParts, 'image')
}

async function convertAssistantContentParts(contentParts: MessageContentParts): Promise<Array<TextPart | FilePart>> {
  return convertContentParts<TextPart | FilePart>(contentParts, 'file')
}

async function convertToCoreMessages(messages: Message[]): Promise<CoreMessage[]> {
  return compact(
    await Promise.all(
      messages.map(async (m) => {
        switch (m.role) {
          case 'system':
            return {
              role: 'system' as const,
              content: getMessageText(m),
            }
          case 'user': {
            const contentParts = await convertUserContentParts(m.contentParts || [])
            return {
              role: 'user' as const,
              content: contentParts,
            }
          }
          case 'assistant': {
            const contentParts = m.contentParts || []
            return {
              role: 'assistant' as const,
              content: await convertAssistantContentParts(contentParts),
            }
          }
          case 'tool':
            return null
          default:
            const _exhaustiveCheck: never = m.role
            throw new Error(`Unkown role: ${_exhaustiveCheck}`)
        }
      })
    )
  )
}

/**
 * 在 system prompt 中注入模型信息
 * @param model
 * @param messages
 * @returns
 */
function injectModelSystemPrompt(model: string, messages: Message[]) {
  const metadataPrompt = `Current model: ${model}\nCurrent date: ${dayjs().format('YYYY-MM-DD')}\n`
  let hasInjected = false
  return messages.map((m) => {
    if (m.role === 'system' && !hasInjected) {
      m = cloneMessage(m) // 复制，防止原始数据在其他地方被直接渲染使用
      m.contentParts = [{ type: 'text', text: metadataPrompt + getMessageText(m) }]
      hasInjected = true
    }
    return m
  })
}
