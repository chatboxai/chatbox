import type { CoreMessage, ToolSet } from 'ai'
import { t } from 'i18next'
import { uniqueId } from 'lodash'
import { getModel } from 'src/shared/models'
import { ChatboxAIAPIError } from 'src/shared/models/errors'
import { sequenceMessages } from 'src/shared/utils/message'
import { getModelSettings } from 'src/shared/utils/model_settings'
import { createModelDependencies } from '@/adapters'
import * as settingActions from '@/stores/settingActions'
import type { ModelInterface, OnResultChange, onResultChangeWithCancel } from '../../../shared/models/types'
import {
  type KnowledgeBase,
  type Message,
  type MessageInfoPart,
  type MessageToolCallPart,
  ModelProviderEnum,
  type ProviderOptions,
  type StreamTextResult,
} from '../../../shared/types'
import { getToolSet } from '../knowledge-base/tools'
import { mcpController } from '../mcp/controller'
import { convertToCoreMessages, injectModelSystemPrompt } from './message-utils'
import { imageOCR } from './preprocess'
import {
  combinedSearchByPromptEngineering,
  constructMessagesWithKnowledgeBaseResults,
  constructMessagesWithSearchResults,
  knowledgeBaseSearchByPromptEngineering,
  searchByPromptEngineering,
  webSearchTool,
} from './tools'

/**
 * 处理搜索结果并返回模型响应的通用函数
 */
async function handleSearchResult(
  result: { query: string; searchResults: any[]; type?: 'knowledge_base' | 'web' | 'none' },
  toolName: string,
  model: ModelInterface,
  messages: Message[],
  coreMessages: CoreMessage[],
  controller: AbortController,
  onResultChange: OnResultChange,
  params: { providerOptions?: ProviderOptions }
) {
  if (!result?.searchResults?.length || result.type === 'none') {
    return model.chat(coreMessages, { signal: controller.signal, onResultChange })
  }

  const toolCallPart: MessageToolCallPart = {
    type: 'tool-call',
    state: 'result',
    toolCallId: `${result.type || toolName.replace('_', '')}_search_${uniqueId()}`,
    toolName,
    args: { query: result.query },
    result,
  }
  onResultChange({ contentParts: [toolCallPart] })

  const messagesWithResults =
    result.type === 'knowledge_base' || toolName === 'query_knowledge_base'
      ? constructMessagesWithKnowledgeBaseResults(messages, result.searchResults)
      : constructMessagesWithSearchResults(messages, result.searchResults)

  return model.chat(await convertToCoreMessages(messagesWithResults), {
    signal: controller.signal,
    onResultChange: (data) => {
      if (data.contentParts) {
        onResultChange({ ...data, contentParts: [toolCallPart, ...data.contentParts] })
      } else {
        onResultChange(data)
      }
    },
    providerOptions: params.providerOptions,
  })
}

async function ocrMessages(messages: Message[]) {
  // check chatbox ai license active
  const licenseKey = settingActions.getLicenseKey()
  const settings = settingActions.getSettings()
  if (!licenseKey && !(settings.ocrModel?.provider && settings.ocrModel?.model)) {
    // use default ocr model
    throw ChatboxAIAPIError.fromCodeName('model_not_support_image_2', 'model_not_support_image_2')
  }
  let ocrModel: ModelInterface
  const dependencies = await createModelDependencies()
  if (settings.licenseKey) {
    const modelSettings = getModelSettings(settings, ModelProviderEnum.ChatboxAI, 'chatbox-ocr-1')
    ocrModel = getModel(modelSettings, { uuid: '123' }, dependencies)
  } else {
    const ocrModelSetting = settings.ocrModel
    const modelSettings = getModelSettings(settings, ocrModelSetting?.provider!, ocrModelSetting?.model!)
    ocrModel = getModel(modelSettings, { uuid: '123' }, dependencies)
  }
  // do OCR first
  await imageOCR(ocrModel, messages)
}

/**
 * 这里是供UI层调用，集中处理了模型的联网搜索、工具调用、系统消息等逻辑
 */
export async function streamText(
  model: ModelInterface,
  params: {
    sessionId?: string
    messages: Message[]
    onResultChangeWithCancel: onResultChangeWithCancel
    providerOptions?: ProviderOptions
    knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
    webBrowsing?: boolean
  },
  signal?: AbortSignal
) {
  const { knowledgeBase, webBrowsing, sessionId } = params

  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal) {
    signal.addEventListener('abort', cancel, { once: true })
  }

  let result: StreamTextResult = {
    contentParts: [],
  }
  // 不支持工具调用的模型，使用prompt engineering的方式处理知识库和网络搜索
  const kbNotSupported = knowledgeBase && !model.isSupportToolUse('knowledge-base')
  const webNotSupported = webBrowsing && !model.isSupportToolUse('web-browsing')

  params.messages = injectModelSystemPrompt(
    model.modelId,
    params.messages,
    // 在系统提示中添加知识库名称，方便模型理解
    knowledgeBase && !kbNotSupported
      ? `Knowledge base is available to help you answer questions: ${knowledgeBase.name}`
      : '',
    model.isSupportSystemMessage() ? 'system' : 'user'
  )

  if (!model.isSupportSystemMessage()) {
    params.messages = params.messages.map((m) => ({ ...m, role: m.role === 'system' ? 'user' : m.role }))
  }

  const messages = sequenceMessages(params.messages)
  const infoParts: MessageInfoPart[] = []
  try {
    params.onResultChangeWithCancel({ cancel }) // 这里先传递 cancel 方法
    const onResultChange: OnResultChange = (data) => {
      if (data.contentParts) {
        result = { ...result, ...data, contentParts: [...infoParts, ...data.contentParts] }
      } else {
        result = { ...result, ...data }
      }
      params.onResultChangeWithCancel({ ...result, cancel })
    }
    if (
      !model.isSupportVision() &&
      messages.some((m) => m.contentParts.some((c) => c.type === 'image' && !c.ocrResult))
    ) {
      await ocrMessages(messages)
      infoParts.push({
        type: 'info',
        text: t('Current model {{modelName}} does not support image input, using OCR to process images', {
          modelName: model.modelId,
        }),
      })
    }

    const coreMessages = await convertToCoreMessages(messages, { modelSupportVision: model.isSupportVision() })

    if (kbNotSupported || webNotSupported) {
      // 当两个功能都启用且都不支持工具调用时，使用组合搜索
      if (kbNotSupported && webNotSupported) {
        // infoParts.push({
        //   type: 'info',
        //   text: t(
        //     'Current model {{modelName}} does not support tool use, using prompt for knowledge base and web search',
        //     {
        //       modelName: model.modelId,
        //     }
        //   ),
        // })

        const callResult = await combinedSearchByPromptEngineering(
          model,
          params.messages,
          knowledgeBase.id,
          controller.signal
        )
        const toolName = callResult.type === 'knowledge_base' ? 'query_knowledge_base' : 'web_search'
        return handleSearchResult(
          callResult,
          toolName,
          model,
          messages,
          coreMessages,
          controller,
          onResultChange,
          params
        )
      }
      // 只有知识库不支持工具调用
      else if (kbNotSupported) {
        // infoParts.push({
        //   type: 'info',
        //   text: t('Current model {{modelName}} does not support tool use, using prompt for knowledge base', {
        //     modelName: model.modelId,
        //   }),
        // })

        const callResult = await knowledgeBaseSearchByPromptEngineering(model, params.messages, knowledgeBase.id)

        return handleSearchResult(
          callResult || { query: '', searchResults: [] },
          'query_knowledge_base',
          model,
          messages,
          coreMessages,
          controller,
          onResultChange,
          params
        )
      }
      // 只有网络搜索不支持工具调用
      else if (webNotSupported) {
        // infoParts.push({
        //   type: 'info',
        //   text: t('Current model {{modelName}} does not support tool use, using prompt for web search', {
        //     modelName: model.modelId,
        //   }),
        // })

        const callResult = await searchByPromptEngineering(model, params.messages, controller.signal)
        return handleSearchResult(
          callResult || { query: '', searchResults: [] },
          'web_search',
          model,
          messages,
          coreMessages,
          controller,
          onResultChange,
          params
        )
      }
    }

    let tools: ToolSet = {
      ...mcpController.getAvailableTools(),
    }
    if (webBrowsing) {
      tools.web_search = webSearchTool
    }
    if (knowledgeBase) {
      tools = {
        ...tools,
        ...getToolSet(knowledgeBase.id),
      }
    }
    console.debug('tools', tools)

    result = await model.chat(coreMessages, {
      sessionId,
      signal: controller.signal,
      onResultChange,
      providerOptions: params.providerOptions,
      tools,
    })

    return result
  } catch (err) {
    console.error(err)
    // if a cancellation is performed, do not throw an exception, otherwise the content will be overwritten.
    if (controller.signal.aborted) {
      return result
    }
    throw err
  }
}
