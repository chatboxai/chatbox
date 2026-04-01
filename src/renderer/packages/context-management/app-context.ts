import { ChatBridgeAppRecordSnapshotSchema, type ChatBridgeAppRecordSnapshot } from '@shared/chatbridge/app-records'
import type { ChatBridgeAppInstanceStatus } from '@shared/chatbridge/instance'

type ChatBridgeAppContextUnavailableReason = 'stale' | 'error' | 'cancelled' | 'missing-summary'

export type ChatBridgeAppContextSelection =
  | {
      state: 'active' | 'recent'
      appId: string
      appInstanceId: string
      lifecycle: ChatBridgeAppInstanceStatus
      summaryForModel: string
    }
  | {
      state: 'unavailable'
      appId: string
      appInstanceId: string
      lifecycle: ChatBridgeAppInstanceStatus
      reason: ChatBridgeAppContextUnavailableReason
    }

function normalizeSummary(summary?: string) {
  const normalized = summary?.trim()
  return normalized ? normalized : null
}

function getLatestInstance(snapshot: ChatBridgeAppRecordSnapshot) {
  return (
    [...snapshot.instances].sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt - left.updatedAt
      }
      if (left.lastEventAt !== right.lastEventAt) {
        return right.lastEventAt - left.lastEventAt
      }
      return right.createdAt - left.createdAt
    })[0] ?? null
  )
}

function getUnavailableReason(status: ChatBridgeAppInstanceStatus): ChatBridgeAppContextUnavailableReason {
  if (status === 'stale') {
    return 'stale'
  }
  if (status === 'error') {
    return 'error'
  }
  if (status === 'cancelled') {
    return 'cancelled'
  }
  return 'missing-summary'
}

export function resolveChatBridgeAppContext(
  records?: ChatBridgeAppRecordSnapshot | null
): ChatBridgeAppContextSelection | null {
  const parsedRecords = ChatBridgeAppRecordSnapshotSchema.safeParse(records)
  if (!parsedRecords.success) {
    return null
  }

  const latestInstance = getLatestInstance(parsedRecords.data)
  if (!latestInstance) {
    return null
  }

  const summaryForModel = normalizeSummary(latestInstance.summaryForModel)

  if (
    (latestInstance.status === 'launching' ||
      latestInstance.status === 'ready' ||
      latestInstance.status === 'active') &&
    summaryForModel
  ) {
    return {
      state: 'active',
      appId: latestInstance.appId,
      appInstanceId: latestInstance.id,
      lifecycle: latestInstance.status,
      summaryForModel,
    }
  }

  if (latestInstance.status === 'complete' && summaryForModel) {
    return {
      state: 'recent',
      appId: latestInstance.appId,
      appInstanceId: latestInstance.id,
      lifecycle: latestInstance.status,
      summaryForModel,
    }
  }

  return {
    state: 'unavailable',
    appId: latestInstance.appId,
    appInstanceId: latestInstance.id,
    lifecycle: latestInstance.status,
    reason: getUnavailableReason(latestInstance.status),
  }
}

function buildUnavailableGuidance(reason: ChatBridgeAppContextUnavailableReason) {
  switch (reason) {
    case 'stale':
      return 'The host marks the latest app state as stale. Do not pretend you can see exact current app state. Ask the user to reopen or resume the app if exact state matters.'
    case 'error':
      return 'The latest app instance ended in an error state without a safe model-visible summary. Do not invent recovery details; ask the user to retry or reopen the app if exact state matters.'
    case 'cancelled':
      return 'The latest app instance was cancelled. Do not assume work completed successfully; ask the user whether they want to reopen or restart the app.'
    case 'missing-summary':
    default:
      return 'The host does not have a normalized summary for the latest app instance yet. Do not pretend you can see exact current app state. Ask the user to reopen or resume the app if exact state matters.'
  }
}

export function buildChatBridgeAppContextPrompt(records?: ChatBridgeAppRecordSnapshot | null): string | null {
  const selection = resolveChatBridgeAppContext(records)
  if (!selection) {
    return null
  }

  if (selection.state === 'active') {
    return [
      'ChatBridge active app context (host-owned and normalized):',
      `- App ID: ${selection.appId}`,
      `- App instance ID: ${selection.appInstanceId}`,
      `- Lifecycle: ${selection.lifecycle}`,
      `- Summary: ${selection.summaryForModel}`,
      'Use only this bounded host summary for app-aware follow-up continuity. Do not assume any app state that is not stated here.',
    ].join('\n')
  }

  if (selection.state === 'recent') {
    return [
      'ChatBridge recent app context (host-owned and normalized):',
      `- App ID: ${selection.appId}`,
      `- App instance ID: ${selection.appInstanceId}`,
      `- Lifecycle: ${selection.lifecycle}`,
      `- Summary: ${selection.summaryForModel}`,
      'Treat this as the most recent completed app context, not a live active runtime. Ask the user to reopen the app if they need an updated state.',
    ].join('\n')
  }

  if (selection.state === 'unavailable') {
    return [
      'ChatBridge latest app context is unavailable:',
      `- App ID: ${selection.appId}`,
      `- App instance ID: ${selection.appInstanceId}`,
      `- Lifecycle: ${selection.lifecycle}`,
      buildUnavailableGuidance(selection.reason),
    ].join('\n')
  }

  return null
}
