import {
  CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
  ensureDefaultReviewedAppsRegistered,
  getReviewedApp,
  isChatBridgeHostToolExecutionRecord,
  writeChatBridgeRecoveryContractValues,
  type BridgeAppEvent,
  type BridgeReadyEvent,
  type ChatBridgeHostToolExecutionRecord,
  type ChatBridgeRecoveryContract,
} from '@shared/chatbridge'
import type { Message, MessageAppPart, MessageContentParts, MessageToolCallPart, Session } from '@shared/types'
import { z } from 'zod'
import { createChatBridgeAppRecordStore } from './app-records'

export const CHATBRIDGE_REVIEWED_APP_LAUNCH_SCHEMA_VERSION = 1 as const
export const CHATBRIDGE_REVIEWED_APP_LAUNCH_VALUES_KEY = 'chatbridgeReviewedAppLaunch' as const

const ReviewedAppLaunchResultSchema = z.object({
  appId: z.string().trim().min(1),
  appName: z.string().trim().min(1).optional(),
  capability: z.string().trim().min(1).optional(),
  launchReady: z.boolean(),
  summary: z.string().trim().min(1),
  request: z.string().trim().min(1).optional(),
  fen: z.string().trim().min(1).optional(),
  pgn: z.string().trim().min(1).optional(),
})

const ChatBridgeReviewedAppLaunchSchema = z.object({
  schemaVersion: z.literal(CHATBRIDGE_REVIEWED_APP_LAUNCH_SCHEMA_VERSION),
  appId: z.string().trim().min(1),
  appName: z.string().trim().min(1),
  appVersion: z.string().trim().min(1),
  toolName: z.string().trim().min(1),
  capability: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1),
  request: z.string().trim().min(1).optional(),
  fen: z.string().trim().min(1).optional(),
  pgn: z.string().trim().min(1).optional(),
  uiEntry: z.string().trim().min(1).optional(),
  origin: z.string().trim().min(1).optional(),
})

export type ChatBridgeReviewedAppLaunch = z.infer<typeof ChatBridgeReviewedAppLaunchSchema>

type SessionMutationOptions = {
  now?: () => number
  createId?: () => string
}

type ReviewedAppLaunchSessionInput = SessionMutationOptions & {
  messageId: string
  part: MessageAppPart
}

type ReviewedAppLaunchBootstrapInput = ReviewedAppLaunchSessionInput & {
  bridgeSessionId: string
}

type ReviewedAppLaunchReadyInput = ReviewedAppLaunchSessionInput & {
  event: BridgeReadyEvent
}

type ReviewedAppLaunchEventInput = ReviewedAppLaunchSessionInput & {
  event: Exclude<BridgeAppEvent, BridgeReadyEvent>
}

type ReviewedAppLaunchRecoveryInput = ReviewedAppLaunchSessionInput & {
  contract: ChatBridgeRecoveryContract
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function getReviewedAppLaunchResult(record: ChatBridgeHostToolExecutionRecord) {
  if (record.schemaVersion !== CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION || record.outcome.status !== 'success') {
    return null
  }

  const parsed = ReviewedAppLaunchResultSchema.safeParse(record.outcome.result)
  if (!parsed.success || !parsed.data.launchReady) {
    return null
  }

  return parsed.data
}

function createReviewedAppLaunchFromToolRecord(record: ChatBridgeHostToolExecutionRecord) {
  const result = getReviewedAppLaunchResult(record)
  if (!result) {
    return null
  }

  ensureDefaultReviewedAppsRegistered()
  const catalogEntry = getReviewedApp(result.appId)
  const appName = result.appName ?? catalogEntry?.manifest.name ?? result.appId
  const appVersion = catalogEntry?.manifest.version ?? '0.1.0'

  return ChatBridgeReviewedAppLaunchSchema.parse({
    schemaVersion: CHATBRIDGE_REVIEWED_APP_LAUNCH_SCHEMA_VERSION,
    appId: result.appId,
    appName,
    appVersion,
    toolName: record.toolName,
    capability: result.capability,
    summary: result.summary,
    request: result.request,
    fen: result.fen,
    pgn: result.pgn,
    uiEntry: catalogEntry?.manifest.uiEntry,
    origin: catalogEntry?.manifest.origin,
  })
}

export function readChatBridgeReviewedAppLaunch(values: Record<string, unknown> | undefined) {
  if (!values || typeof values !== 'object') {
    return null
  }

  const parsed = ChatBridgeReviewedAppLaunchSchema.safeParse(values[CHATBRIDGE_REVIEWED_APP_LAUNCH_VALUES_KEY])
  return parsed.success ? parsed.data : null
}

export function writeChatBridgeReviewedAppLaunchValues(
  values: Record<string, unknown> | undefined,
  launch: ChatBridgeReviewedAppLaunch
) {
  return {
    ...(values || {}),
    [CHATBRIDGE_REVIEWED_APP_LAUNCH_VALUES_KEY]: ChatBridgeReviewedAppLaunchSchema.parse(launch),
  }
}

export function isChatBridgeReviewedAppLaunchPart(part: Pick<MessageAppPart, 'values'>) {
  return readChatBridgeReviewedAppLaunch(part.values) !== null
}

function buildReviewedAppLaunchPart(
  toolCallId: string,
  launch: ChatBridgeReviewedAppLaunch,
  existingPart?: MessageAppPart
): MessageAppPart {
  return {
    type: 'app',
    appId: launch.appId,
    appName: launch.appName,
    appInstanceId: existingPart?.appInstanceId ?? `reviewed-launch:${toolCallId}`,
    lifecycle: existingPart?.lifecycle ?? 'launching',
    summary: existingPart?.summary ?? launch.summary,
    summaryForModel: existingPart?.summaryForModel ?? launch.summary,
    toolCallId,
    ...(existingPart?.bridgeSessionId ? { bridgeSessionId: existingPart.bridgeSessionId } : {}),
    ...(existingPart?.snapshot ? { snapshot: existingPart.snapshot } : {}),
    values: writeChatBridgeReviewedAppLaunchValues(existingPart?.values, launch),
    ...(existingPart?.error ? { error: existingPart.error } : {}),
    title: existingPart?.title ?? `${launch.appName} launch`,
    description:
      existingPart?.description ??
      `The host is launching ${launch.appName} through the reviewed bridge runtime.`,
    statusText: existingPart?.statusText ?? 'Launching',
    fallbackTitle: existingPart?.fallbackTitle ?? `${launch.appName} fallback`,
    fallbackText:
      existingPart?.fallbackText ??
      `The host will keep ${launch.appName} launch and recovery in this thread if the runtime cannot finish starting.`,
  }
}

export function upsertReviewedAppLaunchParts(contentParts: MessageContentParts): MessageContentParts {
  const existingLaunchParts = new Map(
    contentParts
      .filter((part): part is MessageAppPart => part.type === 'app' && Boolean(part.toolCallId))
      .flatMap((part) => {
        if (!part.toolCallId || !isChatBridgeReviewedAppLaunchPart(part)) {
          return []
        }

        return [[part.toolCallId, part] as const]
      })
  )

  const launchesByToolCallId = new Map<string, ChatBridgeReviewedAppLaunch>()
  for (const part of contentParts) {
    if (part.type !== 'tool-call') {
      continue
    }

    if (!isChatBridgeHostToolExecutionRecord(part.result)) {
      continue
    }

    const launch = createReviewedAppLaunchFromToolRecord(part.result)
    if (launch) {
      launchesByToolCallId.set(part.toolCallId, launch)
    }
  }

  if (launchesByToolCallId.size === 0) {
    return contentParts
  }

  const nextContentParts: MessageContentParts = []
  for (const part of contentParts) {
    if (part.type === 'app' && part.toolCallId && launchesByToolCallId.has(part.toolCallId)) {
      continue
    }

    nextContentParts.push(part)

    if (part.type !== 'tool-call') {
      continue
    }

    const launch = launchesByToolCallId.get(part.toolCallId)
    if (!launch) {
      continue
    }

    nextContentParts.push(buildReviewedAppLaunchPart(part.toolCallId, launch, existingLaunchParts.get(part.toolCallId)))
  }

  return nextContentParts
}

function updateMessageAppParts(
  message: Message,
  appInstanceId: string,
  updater: (part: MessageAppPart) => MessageAppPart
): Message {
  let updated = false
  const contentParts = message.contentParts.map((contentPart) => {
    if (contentPart.type !== 'app' || contentPart.appInstanceId !== appInstanceId) {
      return contentPart
    }

    updated = true
    return updater(contentPart)
  })

  if (!updated) {
    return message
  }

  return {
    ...message,
    contentParts,
  }
}

function updateSessionMessageAppPart(
  session: Session,
  messageId: string,
  appInstanceId: string,
  updater: (part: MessageAppPart) => MessageAppPart
) {
  let found = false

  const messages = session.messages.map((message) => {
    if (message.id !== messageId) {
      return message
    }

    found = true
    return updateMessageAppParts(message, appInstanceId, updater)
  })

  if (found) {
    return {
      ...session,
      messages,
    }
  }

  const threads = session.threads?.map((thread) => {
    const nextMessages = thread.messages.map((message) => {
      if (message.id !== messageId) {
        return message
      }

      found = true
      return updateMessageAppParts(message, appInstanceId, updater)
    })

    return found
      ? {
          ...thread,
          messages: nextMessages,
        }
      : thread
  })

  if (!found) {
    return session
  }

  return {
    ...session,
    threads,
  }
}

function ensureLaunchRecordStore(
  session: Session,
  part: MessageAppPart,
  bridgeSessionId: string | undefined,
  options: SessionMutationOptions = {}
) {
  const store = createChatBridgeAppRecordStore({
    snapshot: session.chatBridgeAppRecords,
    now: options.now,
    createId: options.createId,
  })
  const launch = readChatBridgeReviewedAppLaunch(part.values)
  if (!launch) {
    throw new Error(`App part ${part.appInstanceId} is missing reviewed launch metadata.`)
  }

  if (!store.getInstance(part.appInstanceId)) {
    store.createInstance({
      id: part.appInstanceId,
      appId: launch.appId,
      appVersion: launch.appVersion,
      bridgeSessionId,
      owner: {
        authority: 'host',
        conversationSessionId: session.id,
        initiatedBy: 'assistant',
      },
      resumability: {
        mode: 'restartable',
        reason: 'The host can relaunch the reviewed app from the preserved launch request.',
      },
      createdAt: options.now?.() ?? Date.now(),
    })
  }

  return {
    launch,
    store,
  }
}

function getBridgeSnapshotSummary(snapshot: unknown) {
  return readString(asRecord(snapshot)?.summary)
}

function getBridgeSnapshotStatusText(snapshot: unknown) {
  return readString(asRecord(snapshot)?.statusText)
}

export function applyReviewedAppLaunchBootstrapToSession(
  session: Session,
  input: ReviewedAppLaunchBootstrapInput
) {
  const { launch, store } = ensureLaunchRecordStore(session, input.part, input.bridgeSessionId, input)
  const nextSession = updateSessionMessageAppPart(session, input.messageId, input.part.appInstanceId, (part) => ({
    ...part,
    bridgeSessionId: input.bridgeSessionId,
    lifecycle: 'launching',
    summary: part.summary ?? launch.summary,
    summaryForModel: part.summaryForModel ?? launch.summary,
    title: part.title ?? `${launch.appName} launch`,
    description:
      part.description ??
      `The host is launching ${launch.appName} through the reviewed bridge runtime.`,
    statusText: 'Launching',
  }))

  return {
    ...nextSession,
    chatBridgeAppRecords: store.snapshot(),
  }
}

export function applyReviewedAppLaunchBridgeReadyToSession(
  session: Session,
  input: ReviewedAppLaunchReadyInput
) {
  const bootstrapped = applyReviewedAppLaunchBootstrapToSession(session, {
    ...input,
    bridgeSessionId: input.event.bridgeSessionId,
  })
  const { launch, store } = ensureLaunchRecordStore(bootstrapped, input.part, input.event.bridgeSessionId, input)
  const readyResult = store.recordBridgeEvent(input.event, input.now?.() ?? Date.now())
  if (!readyResult.accepted) {
    throw new Error(`Failed to record reviewed app ready event: ${readyResult.reason}`)
  }

  const nextSession = updateSessionMessageAppPart(
    {
      ...bootstrapped,
      chatBridgeAppRecords: store.snapshot(),
    },
    input.messageId,
    input.part.appInstanceId,
    (part) => ({
      ...part,
      bridgeSessionId: input.event.bridgeSessionId,
      lifecycle: 'ready',
      summary: part.summary ?? launch.summary,
      summaryForModel: part.summaryForModel ?? launch.summary,
      description:
        part.description ??
        `${launch.appName} completed the reviewed bridge handshake and is ready inside the host-owned shell.`,
      statusText: 'Ready',
      error: undefined,
    })
  )

  return {
    ...nextSession,
    chatBridgeAppRecords: store.snapshot(),
  }
}

export function applyReviewedAppLaunchBridgeEventToSession(
  session: Session,
  input: ReviewedAppLaunchEventInput
) {
  const { launch, store } = ensureLaunchRecordStore(session, input.part, input.event.bridgeSessionId, input)
  const result = store.recordBridgeEvent(input.event, input.now?.() ?? Date.now())
  if (!result.accepted) {
    throw new Error(`Failed to record reviewed app bridge event: ${result.reason}`)
  }

  const nextSession = updateSessionMessageAppPart(
    {
      ...session,
      chatBridgeAppRecords: store.snapshot(),
    },
    input.messageId,
    input.part.appInstanceId,
    (part) => {
      if (input.event.kind === 'app.state') {
        const summary = getBridgeSnapshotSummary(input.event.snapshot) ?? part.summary ?? launch.summary
        return {
          ...part,
          lifecycle: 'active',
          bridgeSessionId: input.event.bridgeSessionId,
          summary,
          summaryForModel: summary,
          snapshot: input.event.snapshot,
          description:
            part.description ??
            `${launch.appName} is active inside the reviewed bridge runtime and remains part of the thread.`,
          statusText: getBridgeSnapshotStatusText(input.event.snapshot) ?? 'Running',
          error: undefined,
        }
      }

      if (input.event.kind === 'app.complete') {
        const suggestedSummary = readString(input.event.completion?.suggestedSummary?.text)
        const summary = suggestedSummary ?? part.summary ?? launch.summary
        return {
          ...part,
          lifecycle: 'complete',
          bridgeSessionId: input.event.bridgeSessionId,
          summary,
          summaryForModel: summary,
          description:
            part.description ??
            `${launch.appName} completed inside the reviewed bridge runtime and stayed in the thread.`,
          statusText: 'Complete',
        }
      }

      return {
        ...part,
        lifecycle: 'error',
        bridgeSessionId: input.event.bridgeSessionId,
        statusText: 'Runtime error',
        error: input.event.error ?? part.error,
      }
    }
  )

  return {
    ...nextSession,
    chatBridgeAppRecords: store.snapshot(),
  }
}

export function applyReviewedAppLaunchRecoveryToSession(
  session: Session,
  input: ReviewedAppLaunchRecoveryInput
) {
  const bridgeSessionId = input.part.bridgeSessionId ?? input.contract.correlation.bridgeSessionId
  const { launch, store } = ensureLaunchRecordStore(session, input.part, bridgeSessionId, input)
  const currentInstance = store.getInstance(input.part.appInstanceId)

  if (!currentInstance || currentInstance.status !== 'error') {
    const errorResult = store.recordHostEvent({
      appInstanceId: input.part.appInstanceId,
      kind: 'error.recorded',
      nextStatus: 'error',
      bridgeSessionId,
      createdAt: input.now?.() ?? Date.now(),
      error: {
        code: input.contract.failureClass,
        message: input.contract.summary,
        recoverable: input.contract.severity !== 'terminal',
        details: {
          traceCode: input.contract.observability.traceCode,
          source: input.contract.source,
        },
        occurredAt: input.now?.() ?? Date.now(),
      },
      payload: {
        source: input.contract.source,
        traceCode: input.contract.observability.traceCode,
      },
    })

    if (!errorResult.accepted) {
      throw new Error(`Failed to record reviewed app recovery event: ${errorResult.reason}`)
    }
  }

  const nextSession = updateSessionMessageAppPart(
    {
      ...session,
      chatBridgeAppRecords: store.snapshot(),
    },
    input.messageId,
    input.part.appInstanceId,
    (part) => ({
      ...part,
      lifecycle: 'error',
      bridgeSessionId,
      description: input.contract.description,
      statusText: input.contract.statusLabel,
      error: input.contract.summary,
      fallbackTitle: input.contract.fallbackTitle ?? part.fallbackTitle ?? `${launch.appName} fallback`,
      fallbackText: input.contract.fallbackText,
      values: writeChatBridgeRecoveryContractValues(part.values, input.contract),
    })
  )

  return {
    ...nextSession,
    chatBridgeAppRecords: store.snapshot(),
  }
}

export async function persistReviewedAppLaunchBootstrap(input: ReviewedAppLaunchBootstrapInput & { sessionId: string }) {
  const { updateSessionWithMessages } = await import('@/stores/chatStore')
  return await updateSessionWithMessages(input.sessionId, (session) => {
    if (!session) {
      throw new Error(`Session ${input.sessionId} not found while bootstrapping reviewed app launch.`)
    }

    return applyReviewedAppLaunchBootstrapToSession(session, input)
  })
}

export async function persistReviewedAppLaunchBridgeReady(input: ReviewedAppLaunchReadyInput & { sessionId: string }) {
  const { updateSessionWithMessages } = await import('@/stores/chatStore')
  return await updateSessionWithMessages(input.sessionId, (session) => {
    if (!session) {
      throw new Error(`Session ${input.sessionId} not found while recording reviewed app ready state.`)
    }

    return applyReviewedAppLaunchBridgeReadyToSession(session, input)
  })
}

export async function persistReviewedAppLaunchBridgeEvent(input: ReviewedAppLaunchEventInput & { sessionId: string }) {
  const { updateSessionWithMessages } = await import('@/stores/chatStore')
  return await updateSessionWithMessages(input.sessionId, (session) => {
    if (!session) {
      throw new Error(`Session ${input.sessionId} not found while recording reviewed app bridge event.`)
    }

    return applyReviewedAppLaunchBridgeEventToSession(session, input)
  })
}

export async function persistReviewedAppLaunchRecovery(input: ReviewedAppLaunchRecoveryInput & { sessionId: string }) {
  const { updateSessionWithMessages } = await import('@/stores/chatStore')
  return await updateSessionWithMessages(input.sessionId, (session) => {
    if (!session) {
      throw new Error(`Session ${input.sessionId} not found while recording reviewed app recovery state.`)
    }

    return applyReviewedAppLaunchRecoveryToSession(session, input)
  })
}
