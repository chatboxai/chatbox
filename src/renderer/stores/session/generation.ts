import * as Sentry from '@sentry/react'
import { getModel } from '@shared/models'
import { AIProviderNoImplementedPaintError, ApiError, BaseError, NetworkError, OCRError } from '@shared/models/errors'
import type { OnResultChangeWithCancel } from '@shared/models/types'
import {
  type CompactionPoint,
  createMessage,
  type Message,
  type MessageImagePart,
  type MessagePicture,
  ModelProviderEnum,
  type SessionSettings,
  type SessionType,
  type Settings,
} from '@shared/types'
import { cloneMessage, getMessageText, mergeMessages } from '@shared/utils/message'
import { identity, pickBy } from 'lodash'
import { createModelDependencies } from '@/adapters'
import * as appleAppStore from '@/packages/apple_app_store'
import { applyChatBridgeAppContext } from '@/packages/chatbridge/context'
import { buildContextForAI } from '@/packages/context-management'
import {
  buildAttachmentWrapperPrefix,
  buildAttachmentWrapperSuffix,
  MAX_INLINE_FILE_LINES,
  PREVIEW_LINES,
} from '@/packages/context-management/attachment-payload'
import { generateImage, streamText } from '@/packages/model-calls'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import { estimateTokensFromMessages } from '@/packages/token'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { trackEvent } from '@/utils/track'
import * as chatStore from '../chatStore'
import { settingsStore } from '../settingsStore'
import { uiStore } from '../uiStore'
import { createNewFork, findMessageLocation } from './forks'
import { insertMessageAfter, modifyMessage } from './messages'

/**
 * Get session-level web browsing setting
 * Returns user's explicit setting if set, otherwise returns default based on provider
 */
export function getSessionWebBrowsing(sessionId: string, provider: string | undefined): boolean {
  const sessionValue = uiStore.getState().sessionWebBrowsingMap[sessionId]
  if (sessionValue !== undefined) {
    return sessionValue
  }
  // Default: true for ChatboxAI, false for others
  return provider === ModelProviderEnum.ChatboxAI
}

/**
 * Track generation event
 */
function trackGenerateEvent(
  sessionId: string,
  settings: SessionSettings,
  globalSettings: Settings,
  sessionType: SessionType | undefined,
  options?: { operationType?: 'send_message' | 'regenerate' }
) {
  // Get a more meaningful provider identifier
  let providerIdentifier = settings.provider
  if (settings.provider?.startsWith('custom-provider-')) {
    // For custom providers, use apiHost as identifier
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

  const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)

  trackEvent('generate', {
    provider: providerIdentifier,
    model: settings.modelId || 'unknown',
    operation_type: options?.operationType || 'unknown',
    web_browsing_enabled: webBrowsing ? 'true' : 'false',
    session_type: sessionType || 'chat',
  })
}

/**
 * Create n empty picture messages (loading state, for placeholders)
 * @param n Number of empty messages
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
 * Execute message generation, will modify message state
 * @param sessionId
 * @param targetMsg
 * @returns
 */
export async function generate(
  sessionId: string,
  targetMsg: Message,
  options?: { operationType?: 'send_message' | 'regenerate' }
) {
  // Get dependent data
  const session = await chatStore.getSession(sessionId)
  const settings = await chatStore.getSessionSettings(sessionId)
  const globalSettings = settingsStore.getState().getSettings()
  const configs = await platform.getConfig()
  if (!session || !settings) {
    return
  }

  // Track generation event
  trackGenerateEvent(sessionId, settings, globalSettings, session.type, options)

  // Reset message state to initial state
  targetMsg = {
    ...targetMsg,
    // FIXME: For picture message generation, need to show placeholder
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
  // }, 50) // Wait for message render to complete before scrolling to bottom

  // Get the message list where target message is located (may be historical messages), get target message index
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
    const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)
    switch (session.type) {
      // Chat message generation
      case 'chat':
      case undefined: {
        const startTime = Date.now()
        let firstTokenLatency: number | undefined
        const persistInterval = 2000
        let lastPersistTimestamp = Date.now()
        const promptMsgs = await genMessageContext(
          settings,
          messages.slice(0, targetMsgIx),
          model.isSupportToolUse('read-file'),
          { compactionPoints: session.compactionPoints }
        )
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

        const { result } = await streamText(model, {
          sessionId: session.id,
          messages: promptMsgs,
          onResultChangeWithCancel: modifyMessageCache,
          onStatusChange: (status) => {
            targetMsg = {
              ...targetMsg,
              status: status ? [status] : [],
            }
            void modifyMessage(sessionId, targetMsg, false, true)
          },
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
      // Picture message generation
      case 'picture': {
        // Take the most recent user message before the current message as prompt
        const userMessage = messages.slice(0, targetMsgIx).findLast((m) => m.role === 'user')
        if (!userMessage) {
          // Should not happen - user message not found
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
            // Image needs to be stored in indexedDB, if using OpenAI's image link directly, the link will expire over time
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
    const isExpectedOCRError = error instanceof OCRError && error.cause instanceof BaseError
    if (
      !(
        error instanceof ApiError ||
        error instanceof NetworkError ||
        error instanceof AIProviderNoImplementedPaintError ||
        isExpectedOCRError
      )
    ) {
      Sentry.captureException(error) // unexpected error should be reported
    }
    let errorCode: number | undefined
    if (err instanceof BaseError) {
      errorCode = err.code
    }
    const ocrError = error instanceof OCRError ? error : undefined
    const causeError = ocrError?.cause
    targetMsg = {
      ...targetMsg,
      generating: false,
      cancel: undefined,
      errorCode: ocrError ? (causeError instanceof BaseError ? causeError.code : errorCode) : errorCode,
      error: `${error.message}`,
      errorExtra: {
        aiProvider: ocrError ? ocrError.ocrProvider : settings.provider,
        host:
          error instanceof NetworkError ? error.host : causeError instanceof NetworkError ? causeError.host : undefined,
        responseBody:
          error instanceof ApiError
            ? error.responseBody
            : causeError instanceof ApiError
              ? causeError.responseBody
              : undefined,
      },
      status: [],
    }
    await modifyMessage(sessionId, targetMsg, true)
  }
}

/**
 * Insert and generate a new message below the target message
 * @param sessionId Session ID
 * @param msgId Message ID
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
    // If target message is the first message, regenerate directly
    await generate(sessionId, msg, { operationType: 'regenerate' })
    return
  }
  const forkMessage = location.list[previousMessageIndex]
  await createNewFork(sessionId, forkMessage.id)
  return runGenerateMore(sessionId, forkMessage.id)
}

/**
 * Build message context for prompt
 * Process message list, including:
 * - Use buildContextForAI to build context based on compaction points (if provided)
 * - Limit context message count based on maxContextMessageCount
 * - Add ATTACHMENT_FILE tag for file attachments
 * - Add ATTACHMENT_FILE tag for link attachments
 *
 * @param settings Session settings
 * @param msgs Original message list
 * @param modelSupportToolUseForFile Whether model supports file reading tool (if supported, file content is not directly included)
 * @param options Optional configuration
 * @param options.storageAdapter Optional storage adapter for reading file content (defaults to storage.getBlob)
 * @param options.compactionPoints Optional compaction points for building context from compression point
 * @returns Processed message list
 */
export async function genMessageContext(
  settings: SessionSettings,
  msgs: Message[],
  modelSupportToolUseForFile: boolean,
  options?: {
    storageAdapter?: { getBlob: (key: string) => Promise<string> }
    compactionPoints?: CompactionPoint[]
  }
) {
  const storageAdapter = options?.storageAdapter
  const compactionPoints = options?.compactionPoints
  const storageGetBlob = storageAdapter?.getBlob ?? ((key: string) => storage.getBlob(key).catch(() => ''))
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

  // Step 1: Apply compaction-based context building if compactionPoints are provided
  // This will return messages starting from the latest compaction point (with summary prepended)
  // and apply tool-call cleanup for older messages
  let contextMessages = msgs
  if (compactionPoints && compactionPoints.length > 0) {
    contextMessages = buildContextForAI({
      messages: msgs,
      compactionPoints,
      keepToolCallRounds: 2,
      sessionSettings: settings,
    })
  } else {
    contextMessages = applyChatBridgeAppContext(msgs, msgs)
  }

  // Pre-fetch all blob contents in parallel to avoid N+1 sequential fetches
  const allStorageKeys = new Set<string>()
  for (const msg of contextMessages) {
    if (msg.files) {
      for (const file of msg.files) {
        if (file.storageKey) {
          allStorageKeys.add(file.storageKey)
        }
      }
    }
    if (msg.links) {
      for (const link of msg.links) {
        if (link.storageKey) {
          allStorageKeys.add(link.storageKey)
        }
      }
    }
  }
  const blobContents = new Map<string, string>()
  if (allStorageKeys.size > 0) {
    const keys = Array.from(allStorageKeys)
    const contents = await Promise.all(keys.map((key) => storageGetBlob(key)))
    keys.forEach((key, index) => {
      blobContents.set(key, contents[index] ?? '')
    })
  }

  const head = contextMessages[0]?.role === 'system' ? contextMessages[0] : undefined
  const workingMsgs = head ? contextMessages.slice(1) : contextMessages

  let _totalLen = head ? (head.tokenCount ?? estimateTokensFromMessages([head])) : 0
  let prompts: Message[] = []
  for (let i = workingMsgs.length - 1; i >= 0; i--) {
    let msg = workingMsgs[i]
    // Skip error messages
    if (msg.error || msg.errorCode) {
      continue
    }
    const size = (msg.tokenCount ?? estimateTokensFromMessages([msg])) + 20 // 20 as estimated error compensation
    // Only OpenAI supports context tokens limit
    if (settings.provider === 'openai') {
      // if (size + totalLen > openaiMaxContextTokens) {
      //     break
      // }
    }
    if (
      maxContextMessageCount < Number.MAX_SAFE_INTEGER &&
      prompts.length >= maxContextMessageCount + 1 // +1 to keep user's last input message
    ) {
      break
    }

    let attachmentIndex = 1
    if (msg.files && msg.files.length > 0) {
      for (const file of msg.files) {
        if (file.storageKey) {
          msg = cloneMessage(msg)
          const content = blobContents.get(file.storageKey) ?? ''
          if (content) {
            const fileLines = content.split('\n').length
            const shouldUseToolForThisFile = modelSupportToolUseForFile && fileLines > MAX_INLINE_FILE_LINES

            const prefix = buildAttachmentWrapperPrefix({
              attachmentIndex: attachmentIndex++,
              fileName: file.name,
              fileKey: file.storageKey,
              fileLines,
              fileSize: content.length,
            })

            let contentToAdd = content
            let isTruncated = false
            if (shouldUseToolForThisFile) {
              const lines = content.split('\n')
              contentToAdd = lines.slice(0, PREVIEW_LINES).join('\n')
              isTruncated = true
            }

            const suffix = buildAttachmentWrapperSuffix({
              isTruncated,
              previewLines: isTruncated ? PREVIEW_LINES : undefined,
              totalLines: isTruncated ? fileLines : undefined,
              fileKey: isTruncated ? file.storageKey : undefined,
            })

            const attachment = prefix + contentToAdd + '\n' + suffix
            msg = mergeMessages(msg, createMessage(msg.role, attachment))
          }
        }
      }
    }
    if (msg.links && msg.links.length > 0) {
      for (const link of msg.links) {
        if (link.storageKey) {
          msg = cloneMessage(msg)
          const content = blobContents.get(link.storageKey) ?? ''
          if (content) {
            const linkLines = content.split('\n').length
            const shouldUseToolForThisLink = modelSupportToolUseForFile && linkLines > MAX_INLINE_FILE_LINES

            const prefix = buildAttachmentWrapperPrefix({
              attachmentIndex: attachmentIndex++,
              fileName: link.title,
              fileKey: link.storageKey,
              fileLines: linkLines,
              fileSize: content.length,
            })

            let contentToAdd = content
            let isTruncated = false
            if (shouldUseToolForThisLink) {
              const lines = content.split('\n')
              contentToAdd = lines.slice(0, PREVIEW_LINES).join('\n')
              isTruncated = true
            }

            const suffix = buildAttachmentWrapperSuffix({
              isTruncated,
              previewLines: isTruncated ? PREVIEW_LINES : undefined,
              totalLines: isTruncated ? linkLines : undefined,
              fileKey: isTruncated ? link.storageKey : undefined,
            })

            const attachment = prefix + contentToAdd + '\n' + suffix
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

/**
 * Find the thread message list that a message belongs to
 * @param sessionId Session ID
 * @param messageId Message ID
 * @returns The thread message list containing the message
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
