import { arrayMove } from '@dnd-kit/sortable'
import * as Sentry from '@sentry/react'
import { getDefaultStore } from 'jotai'
import { identity, omit, pickBy } from 'lodash'
import * as defaults from 'src/shared/defaults'
import { getModel } from 'src/shared/models'
import type { OnResultChangeWithCancel } from 'src/shared/models/types'
import { v4 as uuidv4 } from 'uuid'
import { createModelDependencies } from '@/adapters'
import * as dom from '@/hooks/dom'
import { languageNameMap } from '@/i18n/locales'
import * as appleAppStore from '@/packages/apple_app_store'
import { generateImage, generateText, streamText } from '@/packages/model-calls'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import { estimateTokensFromMessages } from '@/packages/token'
import { router } from '@/router'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { sortSessions } from '@/utils/session-utils'
import { trackEvent } from '@/utils/track'
import {
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  ChatboxAIAPIError,
  NetworkError,
} from '../../shared/models/errors'
import {
  copyMessage,
  copyThreads,
  createMessage,
  type ExportChatFormat,
  type ExportChatScope,
  type Message,
  type MessageImagePart,
  type MessagePicture,
  type ModelProvider,
  type Session,
  type SessionMeta,
  type SessionSettings,
  type SessionThread,
  type SessionType,
  type Settings,
} from '../../shared/types'
import { cloneMessage, countMessageWords, getMessageText, mergeMessages } from '../../shared/utils/message'
import * as promptFormat from '../packages/prompts'
import platform from '../platform'
import storage from '../storage'
import * as atoms from './atoms'
import * as chatStore from './chatStore'
import * as scrollActions from './scrollActions'
import { exportChat, initEmptyChatSession, initEmptyPictureSession } from './sessionHelpers'
import * as settingActions from './settingActions'
import { settingsStore } from './settingsStore'
import { uiStore } from './uiStore'

/**
 * 跟踪生成事件
 */
function trackGenerateEvent(
  settings: SessionSettings,
  globalSettings: Settings,
  sessionType: SessionType | undefined,
  options?: { operationType?: 'send_message' | 'regenerate' }
) {
  // 获取更有意义的 provider 标识
  let providerIdentifier = settings.provider
  if (settings.provider?.startsWith('custom-provider-')) {
    // 对于自定义 provider，使用 apiHost 作为标识
    const providerSettings = globalSettings.providers?.[settings.provider]
    if (providerSettings?.apiHost) {
      try {
        const url = new URL(providerSettings.apiHost)
        providerIdentifier = `custom:${url.hostname}`
      } catch {
        providerIdentifier = `custom:${providerSettings.apiHost}`
      }
    } else {
      providerIdentifier = 'custom:unknown'
    }
  }

  const webBrowsing = uiStore.getState().inputBoxWebBrowsingMode

  trackEvent('generate', {
    provider: providerIdentifier,
    model: settings.modelId || 'unknown',
    operation_type: options?.operationType || 'unknown',
    web_browsing_enabled: webBrowsing ? 'true' : 'false',
    session_type: sessionType || 'chat',
  })
}

/**
 * 创建一个新的会话
 * @param newSession
 */
async function create(newSession: Omit<Session, 'id'>) {
  const session = await chatStore.createSession(newSession)
  switchCurrentSession(session.id)
  return session
}

/**
 * 修改会话名称
 */
export async function modifyNameAndThreadName(sessionId: string, name: string) {
  await chatStore.updateSession(sessionId, { name, threadName: name })
}

/**
 * 修改会话的当前话题名称
 */
export async function modifyThreadName(sessionId: string, threadName: string) {
  await chatStore.updateSession(sessionId, { threadName })
}

/**
 * 创建一个空的会话
 */
export async function createEmpty(type: 'chat' | 'picture') {
  let newSession: Session
  switch (type) {
    case 'chat':
      newSession = await create(initEmptyChatSession())
      break
    case 'picture':
      newSession = await create(initEmptyPictureSession())
      break
    default:
      throw new Error(`Unknown session type: ${type}`)
  }
  switchCurrentSession(newSession.id)
  return newSession
}

/**
 * 创建 n 个空图片消息（loading 中，用于占位）
 * @param n 空消息数量
 * @returns
 */
export function createLoadingPictures(n: number): MessagePicture[] {
  const ret: MessagePicture[] = []
  for (let i = 0; i < n; i++) {
    ret.push({ loading: true })
  }
  return ret
}

/**
 * 切换当前会话，根据 id
 * @param sessionId
 */
export function switchCurrentSession(sessionId: string) {
  const store = getDefaultStore()
  store.set(atoms.currentSessionIdAtom, sessionId)
  router.navigate({
    to: `/session/${sessionId}`,
  })
  // scrollActions.scrollToBottom() // 切换会话时自动滚动到底部
  scrollActions.clearAutoScroll() // 切换会话时清除自动滚动
}

export async function reorderSessions(oldIndex: number, newIndex: number) {
  console.debug('sessionActions', 'reorderSessions', oldIndex, newIndex)
  await chatStore.updateSessionList((sessions) => {
    if (!sessions) {
      throw new Error('Session list not found')
    }
    /**
     * 1. transform to session showing order
     * 2. adjust item order
     * 3. transform to storage order to save
     *  */
    const sortedSessions = sortSessions(sessions)
    return sortSessions(arrayMove(sortedSessions, oldIndex, newIndex))
  })
}

/**
 * 切换当前会话，根据排序后的索引
 * @param index
 * @returns
 */
export async function switchToIndex(index: number) {
  const sessions = await chatStore.listSessionsMeta()
  const target = sessions[index]
  if (!target) {
    return
  }
  switchCurrentSession(target.id)
}

/**
 * 将当前会话切换到下一个，根据排序后到会话列表顺序
 * @param reversed 是否反向切换到上一个
 * @returns
 */
export async function switchToNext(reversed?: boolean) {
  const sessions = await chatStore.listSessionsMeta()
  if (!sessions) {
    return
  }
  const store = getDefaultStore()
  const currentSessionId = store.get(atoms.currentSessionIdAtom)
  const currentIndex = sessions.findIndex((s) => s.id === currentSessionId)
  if (currentIndex < 0) {
    switchCurrentSession(sessions[0].id)
    return
  }
  let targetIndex = reversed ? currentIndex - 1 : currentIndex + 1
  if (targetIndex >= sessions.length) {
    targetIndex = 0
  }
  if (targetIndex < 0) {
    targetIndex = sessions.length - 1
  }
  const target = sessions[targetIndex]
  switchCurrentSession(target.id)
}

/**
 * 编辑历史话题(目前只支持修改名称)
 * @param sessionId 会话 id
 * @param threadId 历史话题 id
 * @param newThread  Pick<Partial<SessionThread>, 'name'>
 * @returns
 */
export async function editThread(sessionId: string, threadId: string, newThread: Pick<Partial<SessionThread>, 'name'>) {
  const session = await chatStore.getSession(sessionId)
  if (!session || !session.threads) return

  // 特殊情况： 如果修改的是当前的话题，则直接修改当前会话的threadName, 而不是name
  if (threadId === sessionId) {
    await chatStore.updateSession(sessionId, { threadName: newThread.name })
    return
  }

  const targetThread = session.threads.find((t) => t.id === threadId)
  if (!targetThread) return

  const threads = session.threads.map((t) => {
    if (t.id !== threadId) return t
    return { ...t, ...newThread }
  })

  await chatStore.updateSession(sessionId, { threads })
}

/**
 * 删除历史话题
 * @param sessionId 会话 id
 * @param threadId 历史话题 id
 */
export async function removeThread(sessionId: string, threadId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  if (sessionId === threadId) {
    await removeCurrentThread(sessionId)
    return
  }
  return await chatStore.updateSession(sessionId, {
    threads: session.threads?.filter((t) => t.id !== threadId),
  })
}

/**
 * 清空会话中的所有消息，仅保留 system prompt
 * @param sessionId
 * @returns
 */
export async function clear(sessionId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  session.messages.forEach((msg) => {
    msg?.cancel?.()
  })
  return await chatStore.updateSessionWithMessages(session.id, {
    messages: session.messages.filter((m) => m.role === 'system').slice(0, 1),
    threads: undefined,
  })
}

async function copySession(
  sourceMeta: SessionMeta & {
    name?: Session['name']
    messages?: Session['messages']
    threads?: Session['threads']
    threadName?: Session['threadName']
  }
) {
  const source = await chatStore.getSession(sourceMeta.id)
  if (!source) {
    throw new Error(`Session ${sourceMeta.id} not found`)
  }
  const newSession = {
    ...omit(source, 'id', 'messages', 'threads', 'messageForksHash'),
    ...(sourceMeta.name ? { name: sourceMeta.name } : {}),
    messages: sourceMeta.messages ? sourceMeta.messages.map(copyMessage) : source.messages.map(copyMessage),
    threads: sourceMeta.threads ? copyThreads(sourceMeta.threads) : source.threads,
    messageForksHash: undefined, // 不复制分叉数据
    ...(sourceMeta.threadName ? { threadName: sourceMeta.threadName } : {}),
  }
  return await chatStore.createSession(newSession, source.id)
}

/**
 * 复制会话
 * @param source
 */
export async function copyAndSwitchSession(source: SessionMeta) {
  const newSession = await copySession(source)
  switchCurrentSession(newSession.id)
}

/**
 * 将会话中的当前消息移动到历史记录中，并清空上下文
 * @param sessionId
 */
export async function refreshContextAndCreateNewThread(sessionId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  for (const m of session.messages) {
    m?.cancel?.()
  }
  const newThread: SessionThread = {
    id: uuidv4(),
    name: session.threadName || session.name,
    messages: session.messages,
    createdAt: Date.now(),
  }

  let systemPrompt = session.messages.find((m) => m.role === 'system')
  if (systemPrompt) {
    systemPrompt = createMessage('system', getMessageText(systemPrompt))
  }
  await chatStore.updateSessionWithMessages(session.id, {
    ...session,
    threads: session.threads ? [...session.threads, newThread] : [newThread],
    messages: systemPrompt ? [systemPrompt] : [createMessage('system', defaults.getDefaultPrompt())],
    threadName: '',
  })
}

export async function startNewThread(sessionId: string) {
  await refreshContextAndCreateNewThread(sessionId)
  // 自动滚动到底部并自动聚焦到输入框
  setTimeout(() => {
    scrollActions.scrollToBottom()
    dom.focusMessageInput()
  }, 100)
}

/**
 * 压缩当前会话并创建新话题，保留压缩后的上下文
 * @param sessionId 会话ID
 * @param summary 压缩后的总结内容
 */
export async function compressAndCreateThread(sessionId: string, summary: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }

  // 取消所有正在进行的消息生成
  for (const m of session.messages) {
    m?.cancel?.()
  }

  // 创建包含所有消息的新话题
  const newThread: SessionThread = {
    id: uuidv4(),
    name: session.threadName || session.name,
    messages: session.messages,
    createdAt: Date.now(),
  }

  // 获取原始的系统提示（如果存在）
  const systemPrompt = session.messages.find((m) => m.role === 'system')
  let systemPromptText = ''
  if (systemPrompt) {
    systemPromptText = getMessageText(systemPrompt)
  }

  // 创建新的消息列表，包含原始系统提示和压缩后的上下文
  const newMessages: Message[] = []

  // 如果有系统提示，先添加系统提示
  if (systemPromptText) {
    newMessages.push(createMessage('system', systemPromptText))
  }

  // 添加压缩后的上下文作为系统消息
  const compressionContext = `Previous conversation summary:\n\n${summary}`
  newMessages.push(createMessage('user', compressionContext))

  // 保存会话
  await chatStore.updateSessionWithMessages(session.id, {
    ...session,
    threads: session.threads ? [...session.threads, newThread] : [newThread],
    messages: newMessages,
    threadName: '',
    messageForksHash: undefined,
  })

  // 自动滚动到底部并自动聚焦到输入框
  setTimeout(() => {
    scrollActions.scrollToBottom()
    dom.focusMessageInput()
  }, 100)
}

/**
 * 切换到历史记录中的某个上下文，原有上下文存储到历史记录中
 * @param sessionId
 * @param threadId
 */
export async function switchThread(sessionId: string, threadId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session || !session.threads) {
    return
  }
  const target = session.threads.find((h) => h.id === threadId)
  if (!target) {
    return
  }
  for (const m of session.messages) {
    m?.cancel?.()
  }
  const newThreads = session.threads.filter((h) => h.id !== threadId)
  newThreads.push({
    id: uuidv4(),
    name: session.threadName || session.name,
    messages: session.messages,
    createdAt: Date.now(),
  })
  await chatStore.updateSessionWithMessages(session.id, {
    ...session,
    threads: newThreads,
    messages: target.messages,
    threadName: target.name,
  })
  setTimeout(() => scrollActions.scrollToBottom('smooth'), 300)
}

/**
 * 删除某个会话的当前话题。如果该会话存在历史话题，则会回退到上一个话题；如果该会话没有历史话题，则会清空当前会话
 */
export async function removeCurrentThread(sessionId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  const updatedSession: Session = {
    ...session,
    messages: session.messages.filter((m) => m.role === 'system').slice(0, 1), // 仅保留一条系统提示
    threadName: undefined,
  }
  if (session.threads && session.threads.length > 0) {
    const lastThread = session.threads[session.threads.length - 1]
    updatedSession.messages = lastThread.messages
    updatedSession.threads = session.threads.slice(0, session.threads.length - 1)
    updatedSession.threadName = lastThread.name
  }
  await chatStore.updateSession(session.id, updatedSession)
}

export async function moveThreadToConversations(sessionId: string, threadId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  if (session.id === threadId) {
    await moveCurrentThreadToConversations(sessionId)
    return
  }
  const targetThread = session.threads?.find((t) => t.id === threadId)
  if (!targetThread) {
    return
  }
  const newSession = await copySession({
    ...session,
    name: targetThread.name,
    messages: targetThread.messages,
    threads: [],
    threadName: undefined,
  })
  await removeThread(sessionId, threadId)
  switchCurrentSession(newSession.id)
}

export async function moveCurrentThreadToConversations(sessionId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  const newSession = await copySession({
    ...session,
    name: session.threadName || session.name,
    messages: session.messages,
    threads: [],
    threadName: undefined,
  })
  await removeCurrentThread(sessionId)
  switchCurrentSession(newSession.id)
}

/**
 * 在当前主题的最后插入一条消息。
 * @param sessionId
 * @param msg
 */
export async function insertMessage(sessionId: string, msg: Message) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  msg.wordCount = countMessageWords(msg)
  msg.tokenCount = estimateTokensFromMessages([msg])
  return await chatStore.insertMessage(session.id, msg)
}

/**
 * 在某条消息后面插入新消息。如果消息在历史主题中，也能支持插入
 * @param sessionId
 * @param msg
 * @param afterMsgId
 */
export async function insertMessageAfter(sessionId: string, msg: Message, afterMsgId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  msg.wordCount = countMessageWords(msg)
  msg.tokenCount = estimateTokensFromMessages([msg])

  await chatStore.insertMessage(sessionId, msg, afterMsgId)
}

/**
 * 根据 id 修改消息。如果消息在历史主题中，也能支持修改
 * @param sessionId
 * @param updated
 * @param refreshCounting
 */
export async function modifyMessage(
  sessionId: string,
  updated: Message,
  refreshCounting?: boolean,
  updateOnlyCache?: boolean
) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  if (refreshCounting) {
    updated.wordCount = countMessageWords(updated)
    updated.tokenCount = estimateTokensFromMessages([updated])
    updated.tokenCountMap = undefined
  }

  // 更新消息时间戳
  updated.timestamp = Date.now()
  if (updateOnlyCache) {
    await chatStore.updateMessageCache(sessionId, updated.id, updated)
  } else {
    await chatStore.updateMessage(sessionId, updated.id, updated)
  }
}

/**
 * 在会话中删除消息。如果消息存在于历史主题中，也能支持删除
 * @param sessionId
 * @param messageId
 */
export async function removeMessage(sessionId: string, messageId: string) {
  await chatStore.removeMessage(sessionId, messageId)
}
/**
 * 在会话中发送新用户消息，并根据需要生成回复
 * @param params
 */
export async function submitNewUserMessage(
  sessionId: string,
  params: { newUserMsg: Message; needGenerating: boolean }
) {
  const session = await chatStore.getSession(sessionId)
  const settings = await chatStore.getSessionSettings(sessionId)
  if (!session || !settings) {
    return
  }
  const { newUserMsg, needGenerating } = params
  const webBrowsing = uiStore.getState().inputBoxWebBrowsingMode

  // 先在聊天列表中插入发送的用户消息
  await insertMessage(sessionId, newUserMsg)

  const globalSettings = settingsStore.getState().getSettings()
  const isPro = settingActions.isPro()
  const remoteConfig = settingActions.getRemoteConfig()

  // 根据需要，插入空白的回复消息
  let newAssistantMsg = createMessage('assistant', '')
  if (newUserMsg.files && newUserMsg.files.length > 0) {
    if (!newAssistantMsg.status) {
      newAssistantMsg.status = []
    }
    newAssistantMsg.status.push({
      type: 'sending_file',
      mode: isPro ? 'advanced' : 'local',
    })
  }
  if (newUserMsg.links && newUserMsg.links.length > 0) {
    if (!newAssistantMsg.status) {
      newAssistantMsg.status = []
    }
    newAssistantMsg.status.push({
      type: 'loading_webpage',
      mode: isPro ? 'advanced' : 'local',
    })
  }
  if (needGenerating) {
    newAssistantMsg.generating = true
    await insertMessage(sessionId, newAssistantMsg)
  }

  try {
    // 如果本次消息开启了联网问答，需要检查当前模型是否支持
    // 桌面版&手机端总是支持联网问答，不再需要检查模型是否支持
    const dependencies = await createModelDependencies()
    const model = getModel(settings, globalSettings, { uuid: '' }, dependencies)
    if (webBrowsing && platform.type === 'web' && !model.isSupportToolUse()) {
      if (remoteConfig.setting_chatboxai_first) {
        throw ChatboxAIAPIError.fromCodeName('model_not_support_web_browsing', 'model_not_support_web_browsing')
      } else {
        throw ChatboxAIAPIError.fromCodeName('model_not_support_web_browsing_2', 'model_not_support_web_browsing_2')
      }
    }

    // Files and links are now preprocessed in InputBox with storage keys, so no need to process them here
    // Just verify they have storage keys
    if (newUserMsg.files?.length) {
      const missingStorageKeys = newUserMsg.files.filter((f) => !f.storageKey)
      if (missingStorageKeys.length > 0) {
        console.warn('Files without storage keys found:', missingStorageKeys)
      }
    }
    if (newUserMsg.links?.length) {
      const missingStorageKeys = newUserMsg.links.filter((l) => !l.storageKey)
      if (missingStorageKeys.length > 0) {
        console.warn('Links without storage keys found:', missingStorageKeys)
      }
    }
  } catch (err: unknown) {
    // 如果文件上传失败，一定会出现带有错误信息的回复消息
    const error = !(err instanceof Error) ? new Error(`${err}`) : err
    if (
      !(
        error instanceof ApiError ||
        error instanceof NetworkError ||
        error instanceof AIProviderNoImplementedPaintError
      )
    ) {
      Sentry.captureException(error) // unexpected error should be reported
    }
    if (!(err instanceof ApiError || err instanceof NetworkError || err instanceof AIProviderNoImplementedPaintError)) {
      Sentry.captureException(err) // unexpected error should be reported
    }
    let errorCode: number | undefined
    if (err instanceof BaseError) {
      errorCode = err.code
    }

    newAssistantMsg = {
      ...newAssistantMsg,
      generating: false,
      cancel: undefined,
      model: await getModelDisplayName(settings, globalSettings, 'chat'),
      contentParts: [{ type: 'text', text: '' }],
      errorCode,
      error: `${error.message}`, // 这么写是为了避免类型问题
      status: [],
    }
    if (needGenerating) {
      await modifyMessage(sessionId, newAssistantMsg)
    } else {
      await insertMessage(sessionId, newAssistantMsg)
    }
    return // 文件上传失败，不再继续生成回复
  }
  // 根据需要，生成这条回复消息
  if (needGenerating) {
    return generate(sessionId, newAssistantMsg, { operationType: 'send_message' })
  }
}

/**
 * 执行消息生成，会修改消息的状态
 * @param sessionId
 * @param targetMsg
 * @returns
 */
async function generate(
  sessionId: string,
  targetMsg: Message,
  options?: { operationType?: 'send_message' | 'regenerate' }
) {
  // 获得依赖的数据
  const session = await chatStore.getSession(sessionId)
  const settings = await chatStore.getSessionSettings(sessionId)
  const globalSettings = settingsStore.getState().getSettings()
  const configs = await platform.getConfig()
  if (!session || !settings) {
    return
  }

  // 跟踪生成事件
  trackGenerateEvent(settings, globalSettings, session.type, options)

  // 将消息的状态修改成初始状态
  targetMsg = {
    ...targetMsg,
    // FIXME: 图片消息生成时，需要展示 placeholder
    // pictures: session.type === 'picture' ? createLoadingPictures(settings.imageGenerateNum) : targetMsg.pictures,
    cancel: undefined,
    aiProvider: settings.provider,
    model: await getModelDisplayName(settings, globalSettings, session.type || 'chat'),
    style: session.type === 'picture' ? settings.dalleStyle : undefined,
    generating: true,
    errorCode: undefined,
    error: undefined,
    errorExtra: undefined,
    status: [],
    firstTokenLatency: undefined,
    // Set isStreamingMode once during Message initialization (constant property)
    isStreamingMode: settings.stream !== false,
  }

  await modifyMessage(sessionId, targetMsg)
  // setTimeout(() => {
  //   scrollActions.scrollToMessage(targetMsg.id, 'end')
  // }, 50) // 等待消息渲染完成后再滚动到底部，否则会出现滚动不到底部的问题

  // 获取目标消息所在的消息列表（可能是历史消息），获取目标消息的索引
  let messages = session.messages
  let targetMsgIx = messages.findIndex((m) => m.id === targetMsg.id)
  if (targetMsgIx <= 0) {
    if (!session.threads) {
      return
    }
    for (const t of session.threads) {
      messages = t.messages
      targetMsgIx = messages.findIndex((m) => m.id === targetMsg.id)
      if (targetMsgIx > 0) {
        break
      }
    }
    if (targetMsgIx <= 0) {
      return
    }
  }

  try {
    const dependencies = await createModelDependencies()
    const model = getModel(settings, globalSettings, configs, dependencies)
    const sessionKnowledgeBaseMap = uiStore.getState().sessionKnowledgeBaseMap
    const knowledgeBase = sessionKnowledgeBaseMap[sessionId]
    const webBrowsing = uiStore.getState().inputBoxWebBrowsingMode
    switch (session.type) {
      // 对话消息生成
      case 'chat':
      case undefined: {
        const startTime = Date.now()
        let firstTokenLatency: number | undefined
        const persistInterval = 2000
        let lastPersistTimestamp = Date.now()
        const promptMsgs = await genMessageContext(settings, messages.slice(0, targetMsgIx), model.isSupportToolUse())
        const modifyMessageCache: OnResultChangeWithCancel = async (updated) => {
          const textLength = getMessageText(targetMsg, true, true).length
          if (!firstTokenLatency && textLength > 0) {
            firstTokenLatency = Date.now() - startTime
          }
          targetMsg = {
            ...targetMsg,
            ...pickBy(updated, identity),
            status: textLength > 0 ? [] : targetMsg.status,
            firstTokenLatency,
          }
          // update cache on each chunk and persist to storage periodically
          const shouldPersist = Date.now() - lastPersistTimestamp >= persistInterval
          await modifyMessage(sessionId, targetMsg, false, !shouldPersist)
          if (shouldPersist) {
            lastPersistTimestamp = Date.now()
          }
        }

        const result = await streamText(model, {
          sessionId: session.id,
          messages: promptMsgs,
          onResultChangeWithCancel: modifyMessageCache,
          providerOptions: settings.providerOptions,
          knowledgeBase,
          webBrowsing,
        })
        targetMsg = {
          ...targetMsg,
          generating: false,
          cancel: undefined,
          tokensUsed: targetMsg.tokensUsed ?? estimateTokensFromMessages([...promptMsgs, targetMsg]),
          status: [],
          finishReason: result.finishReason,
          usage: result.usage,
        }
        await modifyMessage(sessionId, targetMsg, true)
        break
      }
      // 图片消息生成
      case 'picture': {
        // 取当前消息之前最近的一条用户消息作为 prompt
        const userMessage = messages.slice(0, targetMsgIx).findLast((m) => m.role === 'user')
        if (!userMessage) {
          // 不应该找不到用户消息
          throw new Error('No user message found')
        }

        const insertImage = async (image: MessageImagePart) => {
          targetMsg.contentParts.push(image)
          targetMsg.status = []
          await modifyMessage(sessionId, targetMsg, true)
        }
        await generateImage(
          model,
          {
            message: userMessage,
            num: settings.imageGenerateNum || 1,
          },
          async (picBase64) => {
            const storageKey = StorageKeyGenerator.picture(`${session.id}:${targetMsg.id}`)
            // 图片需要存储到 indexedDB，如果直接使用 OpenAI 返回的图片链接，图片链接将随着时间而失效
            await storage.setBlob(storageKey, picBase64)
            await insertImage({ type: 'image', storageKey })
          }
        )
        targetMsg = {
          ...targetMsg,
          generating: false,
          cancel: undefined,
          status: [],
        }
        await modifyMessage(sessionId, targetMsg, true)
        break
      }
      default:
        throw new Error(`Unknown session type: ${session.type}, generate failed`)
    }
    appleAppStore.tickAfterMessageGenerated()
  } catch (err: unknown) {
    const error = !(err instanceof Error) ? new Error(`${err}`) : err
    if (
      !(
        error instanceof ApiError ||
        error instanceof NetworkError ||
        error instanceof AIProviderNoImplementedPaintError
      )
    ) {
      Sentry.captureException(error) // unexpected error should be reported
    }
    if (!(err instanceof ApiError || err instanceof NetworkError || err instanceof AIProviderNoImplementedPaintError)) {
      Sentry.captureException(err) // unexpected error should be reported
    }
    let errorCode: number | undefined
    if (err instanceof BaseError) {
      errorCode = err.code
    }
    targetMsg = {
      ...targetMsg,
      generating: false,
      cancel: undefined,
      errorCode,
      error: `${error.message}`, // 这么写是为了避免类型问题
      errorExtra: {
        aiProvider: settings.provider,
        host: error instanceof NetworkError ? error.host : undefined,
        // biome-ignore lint/suspicious/noExplicitAny: FIXME: 找到有responseBody的error类型
        responseBody: (error as any).responseBody,
      },
      status: [],
    }
    await modifyMessage(sessionId, targetMsg, true)
  }
}

/**
 * 在目标消息下方插入并生成一条新消息
 * @param sessionId 会话ID
 * @param msgId 消息ID
 */
export async function generateMore(sessionId: string, msgId: string) {
  const newAssistantMsg = createMessage('assistant', '')
  newAssistantMsg.generating = true // prevent estimating token count before generating done
  await insertMessageAfter(sessionId, newAssistantMsg, msgId)
  await generate(sessionId, newAssistantMsg, { operationType: 'regenerate' })
}

export async function generateMoreInNewFork(sessionId: string, msgId: string) {
  await createNewFork(sessionId, msgId)
  await generateMore(sessionId, msgId)
}

type MessageLocation = { list: Message[]; index: number }

function findMessageLocation(session: Session, messageId: string): MessageLocation | null {
  const rootIndex = session.messages.findIndex((m) => m.id === messageId)
  if (rootIndex >= 0) {
    return { list: session.messages, index: rootIndex }
  }
  if (!session.threads) {
    return null
  }
  for (const thread of session.threads) {
    const idx = thread.messages.findIndex((m) => m.id === messageId)
    if (idx >= 0) {
      return { list: thread.messages, index: idx }
    }
  }
  return null
}

type GenerateMoreFn = (sessionId: string, msgId: string) => Promise<void>

export async function regenerateInNewFork(
  sessionId: string,
  msg: Message,
  options?: { runGenerateMore?: GenerateMoreFn }
) {
  const runGenerateMore = options?.runGenerateMore ?? generateMore
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  const location = findMessageLocation(session, msg.id)
  if (!location) {
    await generate(sessionId, msg, { operationType: 'regenerate' })
    return
  }
  const previousMessageIndex = location.index - 1
  if (previousMessageIndex < 0) {
    // 如果目标消息是第一条消息，则直接重新生成
    await generate(sessionId, msg, { operationType: 'regenerate' })
    return
  }
  const forkMessage = location.list[previousMessageIndex]
  await createNewFork(sessionId, forkMessage.id)
  return runGenerateMore(sessionId, forkMessage.id)
}

async function _generateName(sessionId: string, modifyName: (sessionId: string, name: string) => void) {
  const session = await chatStore.getSession(sessionId)
  const globalSettings = settingsStore.getState().getSettings()
  if (!session) {
    return
  }
  const settings = {
    ...globalSettings,
    ...session.settings,
    // 图片会话使用gpt-4o-mini模型，否则会使用DALL-E-3
    ...(session.type === 'picture'
      ? {
          modelId: 'gpt-4o-mini',
        }
      : {}),
    ...(globalSettings.threadNamingModel
      ? {
          provider: globalSettings.threadNamingModel.provider as ModelProvider,
          modelId: globalSettings.threadNamingModel.model,
        }
      : {}),
  }
  const configs = await platform.getConfig()
  try {
    const dependencies = await createModelDependencies()
    const model = getModel(settings, globalSettings, configs, dependencies)
    const result = await generateText(
      model,
      promptFormat.nameConversation(
        session.messages.filter((m) => m.role !== 'system').slice(0, 4),
        languageNameMap[settings.language]
      )
    )
    let name =
      result.contentParts
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('') || ''
    name = name.replace(/['"“”]/g, '').replace(/<think>.*?<\/think>/g, '')
    // name = name.slice(0, 10)    // 限制名字长度
    modifyName(sessionId, name)
  } catch (e: unknown) {
    if (!(e instanceof ApiError || e instanceof NetworkError)) {
      Sentry.captureException(e) // unexpected error should be reported
    }
  }
}

// 全局跟踪正在进行的名称生成请求
const pendingNameGenerations = new Map<string, ReturnType<typeof setTimeout>>()
const activeNameGenerations = new Set<string>()
async function generateNameAndThreadName(sessionId: string) {
  return await _generateName(sessionId, modifyNameAndThreadName)
}

async function generateThreadName(sessionId: string) {
  return await _generateName(sessionId, modifyThreadName)
}

/**
 * 调度生成会话名称和线程名称（带去重和延迟）
 */
export function scheduleGenerateNameAndThreadName(sessionId: string) {
  const key = `name-${sessionId}`

  // 如果已经有正在进行的请求，不重复发送
  if (activeNameGenerations.has(key)) {
    return
  }

  // 清除之前的定时器
  const existingTimeout = pendingNameGenerations.get(key)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
  }

  // 设置新的定时器，延迟1秒执行
  const timeout = setTimeout(async () => {
    pendingNameGenerations.delete(key)
    activeNameGenerations.add(key)

    try {
      await generateNameAndThreadName(sessionId)
    } finally {
      activeNameGenerations.delete(key)
    }
  }, 1000)

  pendingNameGenerations.set(key, timeout)
}

/**
 * 调度生成线程名称（带去重和延迟）
 */
export function scheduleGenerateThreadName(sessionId: string) {
  const key = `thread-${sessionId}`

  // 如果已经有正在进行的请求，不重复发送
  if (activeNameGenerations.has(key)) {
    return
  }

  // 清除之前的定时器
  const existingTimeout = pendingNameGenerations.get(key)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
  }

  // 设置新的定时器，延迟1秒执行
  const timeout = setTimeout(async () => {
    pendingNameGenerations.delete(key)
    activeNameGenerations.add(key)

    try {
      await generateThreadName(sessionId)
    } finally {
      activeNameGenerations.delete(key)
    }
  }, 1000)

  pendingNameGenerations.set(key, timeout)
}
const clearSessionList = async (keepNum: number) => {
  const sessionMetaList = await chatStore.listSessionsMeta()
  const deleted = sessionMetaList?.slice(keepNum)
  if (!deleted?.length) {
    return
  }
  for (const s of deleted) {
    await chatStore.deleteSession(s.id)
  }
  await chatStore.updateSessionList((sessions) => {
    if (!sessions) {
      throw new Error('Session list not found')
    }
    return sessions.filter((s) => !deleted?.some((d) => d.id === s.id))
  })
}

/**
 * 清理会话列表，保留指定数量的会话
 * @param keepNum 保留的会话数量（顶部顺序）
 */
export async function clearConversationList(keepNum: number) {
  await clearSessionList(keepNum)
}

/**
 * 从历史消息中生成 prompt 上下文
 */
async function genMessageContext(settings: SessionSettings, msgs: Message[], modelSupportToolUse: boolean) {
  const {
    // openaiMaxContextTokens,
    maxContextMessageCount,
  } = settings
  if (msgs.length === 0) {
    throw new Error('No messages to replay')
  }
  if (maxContextMessageCount === undefined) {
    throw new Error('maxContextMessageCount is not set')
  }
  const head = msgs[0].role === 'system' ? msgs[0] : undefined
  if (head) {
    msgs = msgs.slice(1)
  }
  let _totalLen = head ? estimateTokensFromMessages([head]) : 0
  let prompts: Message[] = []
  for (let i = msgs.length - 1; i >= 0; i--) {
    let msg = msgs[i]
    // 跳过错误消息
    if (msg.error || msg.errorCode) {
      continue
    }
    const size = estimateTokensFromMessages([msg]) + 20 // 20 作为预估的误差补偿
    // 只有 OpenAI 才支持上下文 tokens 数量限制
    if (settings.provider === 'openai') {
      // if (size + totalLen > openaiMaxContextTokens) {
      //     break
      // }
    }
    if (
      maxContextMessageCount < Number.MAX_SAFE_INTEGER &&
      prompts.length >= maxContextMessageCount + 1 // +1是为了保留用户最后一条输入消息
    ) {
      break
    }

    // 如果消息中包含本地文件（消息中携带有本地文件的storageKey），则将文件内容也作为 prompt 的一部分
    let attachmentIndex = 1
    if (msg.files && msg.files.length > 0) {
      for (const file of msg.files) {
        if (file.storageKey) {
          msg = cloneMessage(msg) // 复制一份消息，避免修改原始消息
          const content = await storage.getBlob(file.storageKey).catch(() => '')
          if (content) {
            let attachment = `\n\n<ATTACHMENT_FILE>\n`
            attachment += `<FILE_INDEX>File ${attachmentIndex++}</FILE_INDEX>\n`
            attachment += `<FILE_NAME>${file.storageKey}</FILE_NAME>\n`
            attachment += `<FILE_LINES>${content.split('\n').length}</FILE_LINES>\n`
            attachment += `<FILE_SIZE>${content.length} bytes</FILE_SIZE>\n`
            if (!modelSupportToolUse) {
              attachment += '<FILE_CONTENT>\n'
              attachment += `${content}\n`
              attachment += '</FILE_CONTENT>\n'
            }
            attachment += `</ATTACHMENT_FILE>\n`
            msg = mergeMessages(msg, createMessage(msg.role, attachment))
          }
        }
      }
    }
    // 如果消息中包含本地链接（消息中携带有本地链接的storageKey），则将链接内容也作为 prompt 的一部分
    if (msg.links && msg.links.length > 0) {
      for (const link of msg.links) {
        if (link.storageKey) {
          msg = cloneMessage(msg) // 复制一份消息，避免修改原始消息
          const content = await storage.getBlob(link.storageKey).catch(() => '')
          if (content) {
            let attachment = `\n\n<ATTACHMENT_FILE>\n`
            attachment += `<FILE_INDEX>${attachmentIndex++}</FILE_INDEX>\n`
            attachment += `<FILE_NAME>${link.storageKey}</FILE_NAME>\n`
            attachment += `<FILE_LINES>${content.split('\n').length}</FILE_LINES>\n`
            attachment += `<FILE_SIZE>${content.length} bytes</FILE_SIZE>\n`
            if (!modelSupportToolUse) {
              attachment += `<FILE_CONTENT>\n`
              attachment += `${content}\n`
              attachment += '</FILE_CONTENT>\n'
            }
            attachment += `</ATTACHMENT_FILE>\n`
            msg = mergeMessages(msg, createMessage(msg.role, attachment))
          }
        }
      }
    }

    prompts = [msg, ...prompts]
    _totalLen += size
  }
  if (head) {
    prompts = [head, ...prompts]
  }
  return prompts
}

// export function getSessions() {
//   const store = getDefaultStore()
//   return store.get(atoms.sessionsListAtom)
// }

// export function getSortedSessions() {
//   const store = getDefaultStore()
//   return store.get(atoms.sortedSessionsListAtom)
// }

// export async function getCurrentSession() {
//   const store = getDefaultStore()
//   const currentSessionId = store.get(atoms.currentSessionIdAtom)
//   return getSessionById(currentSessionId)
// }

// export async function getCurrentMessages() {
//   const currentSession = await getCurrentSession()
//   return currentSession?.messages || []
// }

/**
 * 寻找某个消息所在的话题消息列表
 * @param sessionId 会话ID
 * @param messageId 消息ID
 * @returns 消息所在的话题消息列表
 */
export async function getMessageThreadContext(sessionId: string, messageId: string): Promise<Message[]> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return []
  }
  if (session.messages.find((m) => m.id === messageId)) {
    return session.messages
  }
  if (!session.threads) {
    return []
  }
  for (const t of session.threads) {
    if (t.messages.find((m) => m.id === messageId)) {
      return t.messages
    }
  }
  return []
}

export async function exportSessionChat(sessionId: string, content: ExportChatScope, format: ExportChatFormat) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  await exportChat(session, content, format)
}

export async function createNewFork(sessionId: string, forkMessageId: string) {
  await chatStore.updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error('Session not found')
    }
    const patch = buildCreateForkPatch(session, forkMessageId)
    if (!patch) {
      return session
    }
    return {
      ...session,
      ...patch,
    }
  })
}

export async function switchFork(sessionId: string, forkMessageId: string, direction: 'next' | 'prev') {
  await chatStore.updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error('Session not found')
    }
    const patch = buildSwitchForkPatch(session, forkMessageId, direction)
    if (!patch) {
      return session
    }
    return {
      ...session,
      ...patch,
    } as typeof session
  })
}

type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]

function buildSwitchForkPatch(
  session: Session,
  forkMessageId: string,
  direction: 'next' | 'prev'
): Partial<Session> | null {
  const { messageForksHash } = session
  if (!messageForksHash) {
    return null
  }

  const forkEntry = messageForksHash[forkMessageId]
  if (!forkEntry || forkEntry.lists.length <= 1) {
    return null
  }

  const rootResult = switchForkInMessages(session.messages, forkEntry, forkMessageId, direction)
  if (rootResult) {
    const { messages, fork } = rootResult
    return {
      messages,
      messageForksHash: {
        ...messageForksHash,
        [forkMessageId]: fork,
      },
    }
  }

  if (!session.threads?.length) {
    return null
  }

  let updatedFork: MessageForkEntry | null = null
  const updatedThreads = session.threads.map((thread) => {
    if (updatedFork) {
      return thread
    }
    const result = switchForkInMessages(thread.messages, forkEntry, forkMessageId, direction)
    if (!result) {
      return thread
    }
    updatedFork = result.fork
    return {
      ...thread,
      messages: result.messages,
    }
  })

  if (!updatedFork) {
    return null
  }

  return {
    threads: updatedThreads,
    messageForksHash: {
      ...messageForksHash,
      [forkMessageId]: updatedFork,
    },
  }
}

function switchForkInMessages(
  messages: Message[],
  forkEntry: MessageForkEntry,
  forkMessageId: string,
  direction: 'next' | 'prev'
): { messages: Message[]; fork: MessageForkEntry } | null {
  const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
  if (forkMessageIndex < 0) {
    return null
  }

  const total = forkEntry.lists.length
  const newPosition = direction === 'next' ? (forkEntry.position + 1) % total : (forkEntry.position - 1 + total) % total

  const currentTail = messages.slice(forkMessageIndex + 1)
  const branchMessages = forkEntry.lists[newPosition]?.messages ?? []

  const updatedFork: MessageForkEntry = {
    ...forkEntry,
    position: newPosition,
    lists: forkEntry.lists.map((list, index) => {
      if (index === forkEntry.position && forkEntry.position !== newPosition) {
        return {
          ...list,
          messages: currentTail,
        }
      }
      if (index === newPosition) {
        return {
          ...list,
          messages: [],
        }
      }
      return list
    }),
  }

  return {
    messages: messages.slice(0, forkMessageIndex + 1).concat(branchMessages),
    fork: updatedFork,
  }
}

function buildCreateForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () =>
      session.messageForksHash?.[forkMessageId] ?? {
        position: 0,
        lists: [
          {
            id: `fork_list_${uuidv4()}`,
            messages: [],
          },
        ],
        createdAt: Date.now(),
      },
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      const backupMessages = messages.slice(forkMessageIndex + 1)
      if (backupMessages.length === 0) {
        return null
      }

      const storedListId = `fork_list_${uuidv4()}`
      const newBranchId = `fork_list_${uuidv4()}`
      const lists = forkEntry.lists.map((list, index) =>
        index === forkEntry.position
          ? {
              id: storedListId,
              messages: backupMessages,
            }
          : list
      )
      const nextPosition = lists.length
      const updatedFork: MessageForkEntry = {
        ...forkEntry,
        position: nextPosition,
        lists: [
          ...lists,
          {
            id: newBranchId,
            messages: [],
          },
        ],
      }

      return {
        messages: messages.slice(0, forkMessageIndex + 1),
        forkEntry: updatedFork,
      }
    }
  )
}

function buildDeleteForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () => session.messageForksHash?.[forkMessageId] ?? null,
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      const trimmedMessages = messages.slice(0, forkMessageIndex + 1)
      const remainingLists = forkEntry.lists.filter((_, index) => index !== forkEntry.position)

      if (remainingLists.length === 0) {
        return {
          messages: trimmedMessages,
          forkEntry: null,
        }
      }

      const nextPosition = Math.min(forkEntry.position, remainingLists.length - 1)
      const carryMessages = remainingLists[nextPosition]?.messages ?? []
      const updatedLists = remainingLists.map((list, index) =>
        index === nextPosition
          ? {
              ...list,
              messages: [],
            }
          : list
      )

      return {
        messages: trimmedMessages.concat(carryMessages),
        forkEntry: {
          ...forkEntry,
          position: nextPosition,
          lists: updatedLists,
        },
      }
    }
  )
}

function buildExpandForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () => session.messageForksHash?.[forkMessageId] ?? null,
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      const mergedMessages = forkEntry.lists.flatMap((list) => list.messages)
      if (mergedMessages.length === 0) {
        return {
          messages,
          forkEntry: null,
        }
      }
      return {
        messages: messages.concat(mergedMessages),
        forkEntry: null,
      }
    }
  )
}

type ForkTransformResult = { messages: Message[]; forkEntry: MessageForkEntry | null }
type ForkTransform = (messages: Message[], forkEntry: MessageForkEntry) => ForkTransformResult | null

function applyForkTransform(
  session: Session,
  forkMessageId: string,
  ensureForkEntry: () => MessageForkEntry | null,
  transform: ForkTransform
): Partial<Session> | null {
  const tryTransform = (messages: Message[]): ForkTransformResult | null => {
    const forkEntry = ensureForkEntry()
    if (!forkEntry) {
      return null
    }
    return transform(messages, forkEntry)
  }

  const rootResult = tryTransform(session.messages)
  if (rootResult) {
    return {
      messages: rootResult.messages,
      messageForksHash: computeNextMessageForksHash(session.messageForksHash, forkMessageId, rootResult.forkEntry),
    }
  }

  if (!session.threads?.length) {
    return null
  }

  let updatedFork: MessageForkEntry | null = null
  let changed = false
  const updatedThreads = session.threads.map((thread) => {
    if (changed) {
      return thread
    }
    const result = tryTransform(thread.messages)
    if (!result) {
      return thread
    }
    changed = true
    updatedFork = result.forkEntry
    return {
      ...thread,
      messages: result.messages,
    }
  })

  if (!changed) {
    return null
  }

  return {
    threads: updatedThreads,
    messageForksHash: computeNextMessageForksHash(session.messageForksHash, forkMessageId, updatedFork),
  }
}

function computeNextMessageForksHash(
  current: Session['messageForksHash'],
  forkMessageId: string,
  nextEntry: MessageForkEntry | null
): Session['messageForksHash'] | undefined {
  if (nextEntry) {
    return {
      ...(current ?? {}),
      [forkMessageId]: nextEntry,
    }
  }

  if (!current || !Object.hasOwn(current, forkMessageId)) {
    return current
  }

  const { [forkMessageId]: _removed, ...rest } = current
  return Object.keys(rest).length ? rest : undefined
}

/**
 * 删除某个消息的当前分叉
 * @param forkMessageId 消息ID
 */
export async function deleteFork(sessionId: string, forkMessageId: string) {
  await chatStore.updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error('Session not found')
    }
    const patch = buildDeleteForkPatch(session, forkMessageId)
    if (!patch) {
      return session
    }
    return {
      ...session,
      ...patch,
    }
  })
}

/**
 * 将某条消息所有的分叉消息全部展开到当前消息列表中
 * @deprecated
 */
export async function expandFork(sessionId: string, forkMessageId: string) {
  await chatStore.updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error('Session not found')
    }
    const patch = buildExpandForkPatch(session, forkMessageId)
    if (!patch) {
      return session
    }
    return {
      ...session,
      ...patch,
    }
  })
}
