import { getModel } from '@shared/models'
import { ChatboxAIAPIError, OCRError } from '@shared/models/errors'
import { sequenceMessages } from '@shared/utils/message'
import { getModelSettings } from '@shared/utils/model_settings'
import { tool, type ModelMessage, type ToolSet } from 'ai'
import { z } from 'zod'
import { t } from 'i18next'
import { uniqueId } from 'lodash'
import { createModelDependencies } from '@/adapters'
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
import { chatBridgeController } from '../chatbridge/controller'
import { chatBridgeStore } from '@/stores/chatBridgeStore'

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
  params: { providerOptions?: ProviderOptions; onStatusChange?: OnStatusChange }
) {
  if (!result?.searchResults?.length || result.type === 'none') {
    const chatResult = await model.chat(coreMessages, {
      signal: controller.signal,
      onResultChange,
      onStatusChange: params.onStatusChange,
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
  })
  return { result: chatResult, coreMessages }
}

async function ocrMessages(messages: Message[]) {
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
    await imageOCR(ocrModel, messages)
  } catch (err) {
    throw new OCRError(ocrProviderName, err instanceof Error ? err : new Error(`${err}`))
  }
}

/**
 * 这里是供UI层调用，集中处理了模型的联网搜索、工具调用、系统消息等逻辑
 */
export async function streamText(
  model: ModelInterface,
  params: {
    sessionId?: string
    messages: Message[]
    onResultChangeWithCancel: OnResultChangeWithCancel
    onStatusChange?: OnStatusChange
    providerOptions?: ProviderOptions
    knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
    webBrowsing?: boolean
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
    // 在系统提示中添加知识库名称，方便模型理解
    toolSetInstructions,
    model.isSupportSystemMessage() ? 'system' : 'user'
  )

  if (!model.isSupportSystemMessage()) {
    params.messages = params.messages.map((m) => ({ ...m, role: m.role === 'system' ? 'user' : m.role }))
  }

  // 2. sequence messages to fix the order, prevent model API 400 errors
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

    // ChatBridge: inject activate_app meta-tool AND registered app tools.
    // App tools are injected here so the LLM can call them in the same turn as
    // activate_app. Handlers poll for the iframe invoker (registered by ChatBridgeFrame
    // after React mounts the iframe) so they work even if activate_app fired first.
    const chatBridgeRegistry = chatBridgeStore.getState().registry
    if (chatBridgeRegistry.length > 0) {
      const appListSummary = chatBridgeRegistry.map((a) => `${a.name} (${a.description})`).join(', ')
      tools.activate_app = tool({
        description: `Activate a third-party application. Available apps: ${appListSummary}. Call this when the user wants to use one of these apps.`,
        inputSchema: z.object({
          appName: z.string().describe('Name of the app to activate'),
        }),
        execute: async ({ appName }) => {
          const app = chatBridgeRegistry.find((a) => a.name.toLowerCase() === appName.toLowerCase())
          if (!app) {
            return {
              error: `App "${appName}" not found. Available: ${chatBridgeRegistry.map((a) => a.name).join(', ')}`,
            }
          }
          if (!sessionId) {
            return { error: 'Session ID not available' }
          }
          await chatBridgeController.activate(sessionId, app)
          return {
            status: 'activated',
            app: app.name,
            tools: app.tools.map((t) => t.name),
            description: app.description,
          }
        },
      })

      // Inject only the active app's tools (not all registered apps).
      // This reduces token cost and prevents Claude from calling tools for suspended apps.
      const activeAppName = sessionId ? chatBridgeStore.getState().getActiveApp(sessionId) : null
      const activeApps = activeAppName
        ? chatBridgeRegistry.filter((a) => a.name === activeAppName)
        : []
      for (const app of activeApps) {
        for (const appTool of app.tools) {
          if (tools[appTool.name]) continue // don't shadow existing tools
          const params = appTool.parameters as Record<string, unknown>
          const properties = (params.properties as Record<string, { type?: string; description?: string; enum?: string[] }>) ?? {}
          const required = (params.required as string[]) ?? []
          const zodShape: Record<string, z.ZodTypeAny> = {}
          for (const [key, val] of Object.entries(properties)) {
            let zodType: z.ZodTypeAny
            if (val.enum?.length) {
              zodType = z.enum(val.enum as [string, ...string[]])
            } else if (val.type === 'number') {
              zodType = z.number()
            } else if (val.type === 'boolean') {
              zodType = z.boolean()
            } else {
              zodType = z.string()
            }
            if (val.description) zodType = zodType.describe(val.description)
            if (!required.includes(key)) zodType = zodType.optional()
            zodShape[key] = zodType
          }
          const inputSchema = Object.keys(zodShape).length > 0 ? z.object(zodShape) : z.object({})
          // Capture loop variables for the closure
          const capturedAppName = app.name
          const capturedToolName = appTool.name
          const capturedDescription = appTool.description
          tools[capturedToolName] = tool({
            description: `[${capturedAppName}] ${capturedDescription}`,
            inputSchema,
            execute: async (toolParams) => {
              if (!sessionId) return { error: 'Session not available' }
              // Poll until ChatBridgeFrame mounts and registers the invoker.
              // The await lets React's render cycle run between polls.
              let invoker = chatBridgeStore.getState().getToolInvoker(sessionId)
              if (!invoker) {
                const deadline = Date.now() + 8_000
                while (!invoker && Date.now() < deadline) {
                  await new Promise<void>((r) => setTimeout(r, 100))
                  invoker = chatBridgeStore.getState().getToolInvoker(sessionId)
                }
              }
              if (!invoker) {
                return { error: `${capturedAppName} app is not ready. Ensure activate_app was called first.` }
              }
              const toolCallId = `cb-${Date.now()}-${Math.random().toString(36).slice(2)}`
              try {
                return await invoker(toolCallId, capturedToolName, toolParams)
              } catch (err) {
                return { error: err instanceof Error ? err.message : 'Tool invocation failed' }
              }
            },
          })
        }
      }
    }

    console.debug('tools', tools)

    result = await model.chat(coreMessages, {
      sessionId,
      signal: controller.signal,
      onResultChange,
      onStatusChange: params.onStatusChange,
      providerOptions: params.providerOptions,
      tools,
    })

    return { result, coreMessages }
  } catch (err) {
    console.error(err)
    // if a cancellation is performed, do not throw an exception, otherwise the content will be overwritten.
    if (controller.signal.aborted) {
      return { result, coreMessages }
    }
    throw err
  }
}
