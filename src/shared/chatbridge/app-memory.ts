import type { Message, MessageAppPart } from '../types/session'
import { ChatBridgeCompletionPayloadSchema } from './completion'
import { getChatBridgeDebateArenaState, getChatBridgeDebateArenaSummaryForModel } from './debate-arena'
import { normalizeChatBridgeCompletionSummaryForModel } from './summary'
import {
  buildChatBridgeAppStateDigest,
  describeChatBridgeAppScreenshot,
  formatChatBridgeAppStateDigest,
  getLatestChatBridgeAppScreenshot,
  type ChatBridgeAppScreenshotRef,
  type ChatBridgeAppStateDigest,
} from './app-state'

export type ChatBridgeSelectedAppContext = {
  messageId: string
  appId: string
  appName?: string
  appInstanceId: string
  lifecycle: 'active' | 'complete'
  summaryForModel: string
  stateDigest?: ChatBridgeAppStateDigest
  latestScreenshot?: ChatBridgeAppScreenshotRef
}

function createSelectedAppContext(
  messageId: string,
  part: Pick<MessageAppPart, 'appId' | 'appName' | 'appInstanceId' | 'snapshot' | 'values'>,
  lifecycle: 'active' | 'complete',
  summaryForModel: string
): ChatBridgeSelectedAppContext {
  return {
    messageId,
    appId: part.appId,
    appName: part.appName,
    appInstanceId: part.appInstanceId,
    lifecycle,
    summaryForModel,
    ...(buildChatBridgeAppStateDigest(part as MessageAppPart)
      ? { stateDigest: buildChatBridgeAppStateDigest(part as MessageAppPart) ?? undefined }
      : {}),
    ...(getLatestChatBridgeAppScreenshot(part.values)
      ? { latestScreenshot: getLatestChatBridgeAppScreenshot(part.values) ?? undefined }
      : {}),
  }
}

export function getChatBridgeAppSummaryForModel(part: MessageAppPart): string | null {
  const summaryForModel = part.summaryForModel?.trim()
  if (summaryForModel) {
    return summaryForModel
  }

  const completionPayload = part.values?.chatbridgeCompletion
  const parsedCompletion = ChatBridgeCompletionPayloadSchema.safeParse(completionPayload)
  if (parsedCompletion.success) {
    return normalizeChatBridgeCompletionSummaryForModel({
      appId: part.appId,
      appName: part.appName,
      payload: parsedCompletion.data,
    }).summaryForModel
  }

  const debateArenaState = getChatBridgeDebateArenaState(part.values?.chatbridgeDebateArena)
  if (debateArenaState) {
    return getChatBridgeDebateArenaSummaryForModel(
      {
        appId: part.appId,
        appName: part.appName,
      },
      debateArenaState
    )
  }

  return null
}

export function selectChatBridgeAppContexts(messages: Message[]): ChatBridgeSelectedAppContext[] {
  const seenAppInstanceIds = new Set<string>()
  const activeSelections: ChatBridgeSelectedAppContext[] = []
  const completeSelections: ChatBridgeSelectedAppContext[] = []

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    for (let partIndex = message.contentParts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.contentParts[partIndex]
      if (part.type !== 'app') {
        continue
      }

      if (seenAppInstanceIds.has(part.appInstanceId)) {
        continue
      }

      seenAppInstanceIds.add(part.appInstanceId)

      if (
        part.lifecycle === 'stale' ||
        part.lifecycle === 'error' ||
        part.lifecycle === 'launching' ||
        part.lifecycle === 'ready'
      ) {
        continue
      }

      const summaryForModel = getChatBridgeAppSummaryForModel(part)
      if (!summaryForModel) {
        continue
      }

      if (part.lifecycle === 'active') {
        activeSelections.push(createSelectedAppContext(message.id, part, 'active', summaryForModel))
      } else if (part.lifecycle === 'complete') {
        completeSelections.push(createSelectedAppContext(message.id, part, 'complete', summaryForModel))
      }
    }
  }

  if (activeSelections.length > 0) {
    const primaryActive = activeSelections[0]
    const mostRecentComplete = completeSelections.find(
      (selection) => selection.appInstanceId !== primaryActive.appInstanceId
    )

    return mostRecentComplete ? [primaryActive, mostRecentComplete] : [primaryActive]
  }

  return completeSelections.slice(0, 2)
}

export function selectChatBridgeAppContext(messages: Message[]): ChatBridgeSelectedAppContext | null {
  return selectChatBridgeAppContexts(messages)[0] ?? null
}

export function buildChatBridgeSelectedAppContextPrompt(messages: Message[]): string | null {
  const selected = selectChatBridgeAppContexts(messages)
  if (selected.length === 0) {
    return null
  }

  return selected
    .map((selection, index) => {
      const digest = formatChatBridgeAppStateDigest(selection.stateDigest ?? null)
      const screenshot = describeChatBridgeAppScreenshot(selection.latestScreenshot ?? null)
      const lifecycleLabel = selection.lifecycle === 'active' ? 'active' : 'recently completed'

      return [
        `ChatBridge ${index === 0 ? 'primary' : 'secondary'} app continuity context (host-owned and normalized):`,
        `- App ID: ${selection.appId}`,
        `- App instance ID: ${selection.appInstanceId}`,
        `- Lifecycle: ${lifecycleLabel}`,
        `- Summary: ${selection.summaryForModel}`,
        ...(digest ? [digest] : []),
        ...(screenshot ? [`- Screenshot: ${screenshot}`] : []),
        selection.lifecycle === 'active'
          ? 'Use only this bounded host state for app-aware continuity. Do not assume app state that is not explicitly shown here.'
          : 'Treat this as the most recent completed app context, not a guaranteed live runtime.',
      ].join('\n')
    })
    .join('\n\n')
}
