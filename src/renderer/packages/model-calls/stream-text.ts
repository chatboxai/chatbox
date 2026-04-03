import { buildChatBridgeChessReasoningPrompt, wrapChatBridgeHostTools } from '@shared/chatbridge'
import type { ChatBridgeAppRecordSnapshot } from '@shared/chatbridge/app-records'
import { getModel } from '@shared/models'
import { ChatboxAIAPIError, OCRError } from '@shared/models/errors'
import { createLangSmithConversationMetadata } from '@shared/models/tracing'
import { getLangSmithErrorMessage, type LangSmithTraceContext } from '@shared/utils/langsmith_adapter'
import { getMessageText, sequenceMessages } from '@shared/utils/message'
import { getModelSettings } from '@shared/utils/model_settings'
import type { ModelMessage, ToolSet } from 'ai'
import { t } from 'i18next'
import { uniqueId } from 'lodash'
import { createModelDependencies } from '@/adapters'
import { langsmith } from '@/adapters/langsmith'
import * as settingActions from '@/stores/settingActions'
import { settingsStore } from '@/stores/settingsStore'
import type {
  ModelInterface,
  OnResultChange,
  OnResultChangeWithCancel,
  OnStatusChange,
} from '../../../shared/models/types'
import {
  type KnowledgeBase,
  type Message,
  type MessageInfoPart,
  type MessageToolCallPart,
  ModelProviderEnum,
  type ProviderOptions,
  type StreamTextResult,
} from '../../../shared/types'
import { mcpController } from '../mcp/controller'
import { convertToModelMessages, injectModelSystemPrompt } from './message-utils'
import { imageOCR } from './preprocess'
import {
  combinedSearchByPromptEngineering,
  constructMessagesWithKnowledgeBaseResults,
  constructMessagesWithSearchResults,
  knowledgeBaseSearchByPromptEngineering,
  searchByPromptEngineering,
} from './tools'
import fileToolSet from './toolsets/file'
import { getToolSet } from './toolsets/knowledge-base'
import websearchToolSet, { parseLinkTool, webSearchTool } from './toolsets/web-search'
import { buildChatBridgeAppContextPrompt } from '../context-management/app-context'
import {
  normalizeChatBridgeExecutionGovernorContentParts,
  prepareChatBridgeExecutionGovernor,
} from '../chatbridge/runtime/execution-governor'
export { prepareToolsForExecution } from '../chatbridge/runtime/execution-governor'

/**
 * 处理搜索结果并返回模型响应的通用函数
 */
async function handleSearchResult(
  result: { query: string; searchResults: any[]; type?: 'knowledge_base' | 'web' | 'none' },
  toolName: string,
  model: ModelInterface,
  messages: Message[],
  coreMessages: ModelMessage[],
  controller: AbortController,
  onResultChange: OnResultChange,
  params: { providerOptions?: ProviderOptions; onStatusChange?: OnStatusChange; traceContext?: LangSmithTraceContext }
) {
  if (!result?.searchResults?.length || result.type === 'none') {
    const chatResult = await model.chat(coreMessages, {
      signal: controller.signal,
      onResultChange,
      onStatusChange: params.onStatusChange,
      traceContext: params.traceContext,
    })
    return { result: chatResult, coreMessages }
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

  const chatResult = await model.chat(await convertToModelMessages(messagesWithResults), {
    signal: controller.signal,
    onResultChange: (data) => {
      if (data.contentParts) {
        onResultChange({ ...data, contentParts: [toolCallPart, ...data.contentParts] })
      } else {
        onResultChange(data)
      }
    },
    onStatusChange: params.onStatusChange,
    providerOptions: params.providerOptions,
    traceContext: params.traceContext
      ? {
          ...params.traceContext,
          name: `${params.traceContext.name ?? 'chatbox.session.generate'}.search_followup`,
        }
      : undefined,
  })
  return { result: chatResult, coreMessages }
}

function summarizeMessagesForTrace(messages: Message[]) {
  return messages.map((message) => ({
    role: message.role,
    contentPreview: getMessageText(message).slice(0, 240),
    contentPartTypes: message.contentParts.map((part) => part.type),
  }))
}

function normalizeResultContentParts(
  infoParts: MessageInfoPart[],
  contentParts: StreamTextResult['contentParts'],
  options: {
    reviewedRouteArtifact?: Message['contentParts'][number]
  } = {}
) {
  return normalizeChatBridgeExecutionGovernorContentParts(infoParts, contentParts ?? [], options)
}

async function ocrMessages(messages: Message[], traceContext?: LangSmithTraceContext) {
  const settings = settingsStore.getState().getSettings()
  const hasUserOcrModel = settings.ocrModel?.provider && settings.ocrModel?.model
  const hasLicenseKey = !!settings.licenseKey

  if (!hasUserOcrModel && !hasLicenseKey) {
    // No user-configured OCR model and no Chatbox AI license — cannot perform OCR
    throw ChatboxAIAPIError.fromCodeName('model_not_support_image_2', 'model_not_support_image_2')
  }

  const ocrProviderName = hasUserOcrModel ? settings.ocrModel!.provider : 'Chatbox AI'
  try {
    let ocrModel: ModelInterface
    const dependencies = await createModelDependencies()
    if (hasUserOcrModel) {
      // User has explicitly configured an OCR model — always respect their choice
      const ocrModelSetting = settings.ocrModel!
      const modelSettings = getModelSettings(settings, ocrModelSetting.provider, ocrModelSetting.model)
      ocrModel = getModel(modelSettings, settings, { uuid: '123' }, dependencies)
    } else {
      // Fallback to Chatbox AI built-in OCR model
      const modelSettings = getModelSettings(settings, ModelProviderEnum.ChatboxAI, 'chatbox-ocr-1')
      ocrModel = getModel(modelSettings, settings, { uuid: '123' }, dependencies)
    }
    await imageOCR(ocrModel, messages, traceContext)
  } catch (err) {
    throw new OCRError(ocrProviderName, err instanceof Error ? err : new Error(`${err}`))
  }
}

export function buildAdditionalConversationInfo(
  messages: Message[],
  toolSetInstructions: string,
  appRecords?: ChatBridgeAppRecordSnapshot
): string {
  return [
    toolSetInstructions,
    buildChatBridgeAppContextPrompt(appRecords),
    buildChatBridgeChessReasoningPrompt(messages),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 这里是供UI层调用，集中处理了模型的联网搜索、工具调用、系统消息等逻辑
 */
export async function streamText(
  model: ModelInterface,
  params: {
    sessionId?: string
    threadId?: string
    targetMessageId?: string
    messages: Message[]
    onResultChangeWithCancel: OnResultChangeWithCancel
    onStatusChange?: OnStatusChange
    providerOptions?: ProviderOptions
    knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
    webBrowsing?: boolean
    appRecords?: ChatBridgeAppRecordSnapshot
  },
  signal?: AbortSignal
): Promise<{ result: StreamTextResult; coreMessages: ModelMessage[] }> {
  const { knowledgeBase, webBrowsing, sessionId } = params
  const hasFileOrLink = params.messages.some((m) => m.files?.length || m.links?.length)

  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal) {
    signal.addEventListener('abort', cancel, { once: true })
  }

  let result: StreamTextResult = {
    contentParts: [],
  }
  let coreMessages: ModelMessage[] = []
  const correlationMetadata = createLangSmithConversationMetadata({
    sessionId: sessionId ?? null,
    threadId: params.threadId ?? null,
    messageId: params.targetMessageId ?? null,
  })
  const traceMetadata = {
    ...correlationMetadata,
    operation: 'streamText',
  }
  const traceRun = await langsmith.startRun({
    name: 'chatbox.session.generate',
    runType: 'chain',
    inputs: {
      sessionId: sessionId ?? null,
      threadId: params.threadId ?? sessionId ?? null,
      messageId: params.targetMessageId ?? null,
      modelId: model.modelId,
      knowledgeBaseId: knowledgeBase?.id ?? null,
      webBrowsing: Boolean(webBrowsing),
      hasFileOrLink,
      messages: summarizeMessagesForTrace(params.messages),
    },
    metadata: traceMetadata,
    tags: ['chatbox', 'renderer', 'chat'],
  })
  const modelTraceContext: LangSmithTraceContext = {
    name: 'chatbox.session.generate.llm',
    parentRunId: traceRun.runId,
    metadata: traceMetadata,
    tags: ['chatbox', 'renderer', 'chat'],
  }

  // for model not support tool use, use prompt engineering to handle knowledge base and web search
  const needFileToolSet = hasFileOrLink && model.isSupportToolUse()
  const kbNotSupported = knowledgeBase && !model.isSupportToolUse('knowledge-base')
  const webNotSupported = webBrowsing && !model.isSupportToolUse('web-browsing')

  // 1. inject system prompt for tool use
  let toolSetInstructions = ''
  // 预加载知识库工具集（异步获取文件列表）
  let kbToolSet = null
  if (knowledgeBase) {
    try {
      kbToolSet = await getToolSet(knowledgeBase.id, knowledgeBase.name)
    } catch (err) {
      console.error('Failed to load knowledge base toolset:', err)
    }
  }
  if (kbToolSet && !kbNotSupported) {
    toolSetInstructions += kbToolSet.description
  }
  if (needFileToolSet) {
    toolSetInstructions += fileToolSet.description
  }
  if (webBrowsing && !webNotSupported) {
    toolSetInstructions += websearchToolSet.description
  }

  params.messages = injectModelSystemPrompt(
    model.modelId,
    params.messages,
    // 在系统提示中添加工具能力和 ChatBridge 上下文，方便模型理解
    buildAdditionalConversationInfo(params.messages, toolSetInstructions, params.appRecords),
    model.isSupportSystemMessage() ? 'system' : 'user'
  )

  if (!model.isSupportSystemMessage()) {
    params.messages = params.messages.map((m) => ({ ...m, role: m.role === 'system' ? 'user' : m.role }))
  }

  // 2. sequence messages to fix the order, prevent model API 400 errors
  const messages = sequenceMessages(params.messages)
  const infoParts: MessageInfoPart[] = []
  let reviewedRouteArtifact: Message['contentParts'][number] | undefined
  try {
    params.onResultChangeWithCancel({ cancel }) // 这里先传递 cancel 方法
    const onResultChange: OnResultChange = (data) => {
      if (data.contentParts) {
        result = {
          ...result,
          ...data,
          contentParts: normalizeResultContentParts(infoParts, data.contentParts, {
            reviewedRouteArtifact,
          }),
        }
      } else {
        result = { ...result, ...data }
      }
      params.onResultChangeWithCancel({ ...result, cancel })
    }
    if (
      !model.isSupportVision() &&
      messages.some((m) => m.contentParts.some((c) => c.type === 'image' && !c.ocrResult))
    ) {
      await ocrMessages(messages, {
        name: 'chatbox.session.generate.ocr',
        parentRunId: traceRun.runId,
        metadata: traceMetadata,
        tags: ['chatbox', 'renderer', 'ocr'],
      })
      infoParts.push({
        type: 'info',
        text: t('Current model {{modelName}} does not support image input, using OCR to process images', {
          modelName: model.modelId,
        }),
      })
    }

    coreMessages = await convertToModelMessages(messages, { modelSupportVision: model.isSupportVision() })

    // 3. handle model not support tool use scenarios
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
          controller.signal,
          {
            parentRunId: traceRun.runId,
            metadata: correlationMetadata,
            tags: ['chatbox', 'renderer', 'chat'],
          }
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
          {
            ...params,
            traceContext: modelTraceContext,
          }
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

        const callResult = await knowledgeBaseSearchByPromptEngineering(model, params.messages, knowledgeBase.id, {
          parentRunId: traceRun.runId,
          metadata: correlationMetadata,
          tags: ['chatbox', 'renderer', 'chat'],
        })

        return handleSearchResult(
          callResult || { query: '', searchResults: [] },
          'query_knowledge_base',
          model,
          messages,
          coreMessages,
          controller,
          onResultChange,
          {
            ...params,
            traceContext: modelTraceContext,
          }
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

        const callResult = await searchByPromptEngineering(model, params.messages, controller.signal, {
          parentRunId: traceRun.runId,
          metadata: correlationMetadata,
          tags: ['chatbox', 'renderer', 'chat'],
        })
        return handleSearchResult(
          callResult || { query: '', searchResults: [] },
          'web_search',
          model,
          messages,
          coreMessages,
          controller,
          onResultChange,
          {
            ...params,
            traceContext: modelTraceContext,
          }
        )
      }
    }

    // 4. construct tool set
    let tools: ToolSet = {
      ...mcpController.getAvailableTools(),
    }
    if (webBrowsing) {
      tools.web_search = webSearchTool
      if (settingActions.isPro()) {
        tools.parse_link = parseLinkTool
      }
    }
    if (kbToolSet) {
      tools = {
        ...tools,
        ...kbToolSet.tools,
      }
    }

    if (needFileToolSet) {
      tools = {
        ...tools,
        ...fileToolSet.tools,
      }
    }

    const governor = prepareChatBridgeExecutionGovernor({
      messages,
      baseTools: tools,
      modelSupportsToolUse: model.isSupportToolUse(),
      sessionId,
      traceAdapter: langsmith,
      traceParentRunId: traceRun.runId,
      correlationMetadata,
    })
    tools = governor.tools
    reviewedRouteArtifact = governor.reviewedRouteArtifact

    console.debug('tools', tools)

    result = await model.chat(coreMessages, {
      sessionId,
      signal: controller.signal,
      onResultChange,
      onStatusChange: params.onStatusChange,
      providerOptions: params.providerOptions,
      tools,
      traceContext: modelTraceContext,
    })

    if (result.contentParts) {
      result = {
        ...result,
        contentParts: normalizeResultContentParts(infoParts, result.contentParts, {
          reviewedRouteArtifact,
        }),
      }
    }

    await traceRun.end({
      outputs: {
        contentPartTypes: Array.from(new Set(result.contentParts?.map((part) => part.type) ?? [])),
        infoPartCount: infoParts.length,
        toolCount: Object.keys(tools).length,
      },
    })
    return { result, coreMessages }
  } catch (err) {
    console.error(err)
    // if a cancellation is performed, do not throw an exception, otherwise the content will be overwritten.
    if (controller.signal.aborted) {
      await traceRun.end({
        outputs: {
          aborted: true,
          contentPartTypes: Array.from(new Set(result.contentParts?.map((part) => part.type) ?? [])),
        },
      })
      return { result, coreMessages }
    }
    await traceRun.end({
      error: getLangSmithErrorMessage(err),
      metadata: {
        aborted: false,
      },
    })
    throw err
  }
}
