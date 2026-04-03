import type { MessageAppPart, MessageContentParts, MessageToolCallPart } from '@shared/types'
import {
  CHATBRIDGE_ROUTE_ARTIFACT_STATE_SCHEMA_VERSION,
  ensureDefaultReviewedAppsRegistered,
  getChatBridgeRouteArtifactState,
  getChatBridgeRouteDecision,
  writeChatBridgeRouteArtifactStateValues,
  type ChatBridgeRouteArtifactState,
  type ReviewedAppCatalogEntry,
  type ReviewedSingleAppSelection,
} from '@shared/chatbridge'
import { upsertReviewedAppLaunchParts } from '../reviewed-app-launch'
import { buildReviewedSelectionInput, executeReviewedSelection, type ReviewedAppToolExecutors } from '../single-app-tools'

export type ChatBridgeRouteArtifactAction =
  | {
      kind: 'launch-app'
      appId: string
    }
  | {
      kind: 'chat-only'
    }

export type ChatBridgeRouteArtifactActionResult = {
  nextContentParts: MessageContentParts
  outcome: 'launch-requested' | 'chat-only' | 'launch-failed' | 'stale' | 'rejected'
  selectedAppId?: string
  selectedAppName?: string
  toolName?: string
  errorCode?: string
  errorMessage?: string
}

type ApplyChatBridgeRouteArtifactActionOptions = {
  contentParts: MessageContentParts
  part: MessageAppPart
  action: ChatBridgeRouteArtifactAction
  sessionId?: string
  entries?: ReviewedAppCatalogEntry[]
  executors?: ReviewedAppToolExecutors
  createToolCallId?: () => string
}

function buildSelectionForRouteAction(
  part: MessageAppPart,
  selectedAppId: string,
  entries: ReviewedAppCatalogEntry[]
): Extract<ReviewedSingleAppSelection, { status: 'matched' }> | null {
  const decision = getChatBridgeRouteDecision(part)
  if (!decision || decision.kind !== 'clarify') {
    return null
  }

  const entry = entries.find((candidate) => candidate.manifest.appId === selectedAppId)
  const selectedMatch = decision.matches.find((match) => match.appId === selectedAppId)
  const toolName = entry?.manifest.toolSchemas[0]?.name

  if (!entry || !toolName || !selectedMatch) {
    return null
  }

  return {
    status: 'matched',
    appId: entry.manifest.appId,
    appName: entry.manifest.name,
    toolName,
    matchedTerms: selectedMatch.matchedTerms,
    promptText: decision.prompt,
    catalogEntry: entry,
  }
}

function updateRoutePart(
  part: MessageAppPart,
  overrides: Partial<MessageAppPart>,
  state: Omit<ChatBridgeRouteArtifactState, 'schemaVersion'>
): MessageAppPart {
  return {
    ...part,
    ...overrides,
    values: writeChatBridgeRouteArtifactStateValues(part.values, {
      schemaVersion: CHATBRIDGE_ROUTE_ARTIFACT_STATE_SCHEMA_VERSION,
      ...state,
    }),
  }
}

function buildChatOnlyRoutePart(part: MessageAppPart): MessageAppPart {
  return updateRoutePart(
    part,
    {
      title: 'Continue in chat',
      description: 'The host kept this request in chat and did not launch a reviewed app.',
      statusText: 'Chat only',
      summary: 'The host kept the request in chat after the clarify step.',
      error: undefined,
      fallbackTitle: undefined,
      fallbackText: undefined,
    },
    {
      status: 'chat-only',
      statusLabel: 'Chat only',
      title: 'Continue in chat',
      description: 'The host kept this request in chat and did not launch a reviewed app.',
    }
  )
}

function buildLaunchRequestedRoutePart(
  part: MessageAppPart,
  selection: Extract<ReviewedSingleAppSelection, { status: 'matched' }>
): MessageAppPart {
  return updateRoutePart(
    part,
    {
      title: `Opening ${selection.appName}`,
      description: `The host recorded your choice and is opening ${selection.appName} through the reviewed launch contract.`,
      statusText: 'Opening',
      summary: `The host recorded the ${selection.appName} route choice and is opening the reviewed runtime in-thread.`,
      error: undefined,
      fallbackTitle: undefined,
      fallbackText: undefined,
    },
    {
      status: 'launch-requested',
      selectedAppId: selection.appId,
      selectedAppName: selection.appName,
      statusLabel: 'Opening',
      title: `Opening ${selection.appName}`,
      description: `The host recorded your choice and is opening ${selection.appName} through the reviewed launch contract.`,
    }
  )
}

function buildLaunchFailedRoutePart(
  part: MessageAppPart,
  selection: Extract<ReviewedSingleAppSelection, { status: 'matched' }>,
  errorCode?: string,
  errorMessage?: string
): MessageAppPart {
  const detail =
    errorMessage?.trim() ||
    'The host kept the failed launch explicit in the thread and did not guess another app.'

  return updateRoutePart(
    {
      ...part,
      lifecycle: 'error',
    },
    {
      title: `${selection.appName} could not open`,
      description: detail,
      statusText: 'Launch failed',
      summary: `${selection.appName} could not open from the clarify choice, so the host kept the failure inline.`,
      error: detail,
      fallbackTitle: 'Launch stayed bounded',
      fallbackText: detail,
    },
    {
      status: 'launch-failed',
      selectedAppId: selection.appId,
      selectedAppName: selection.appName,
      statusLabel: 'Launch failed',
      title: `${selection.appName} could not open`,
      description: detail,
      errorMessage: errorCode ? `${errorCode}: ${detail}` : detail,
    }
  )
}

function createToolCallPart(
  selection: Extract<ReviewedSingleAppSelection, { status: 'matched' }>,
  toolCallId: string,
  result: unknown
): MessageToolCallPart {
  return {
    type: 'tool-call',
    state:
      typeof result === 'object' &&
      result !== null &&
      'outcome' in result &&
      typeof result.outcome === 'object' &&
      result.outcome !== null &&
      'status' in result.outcome &&
      result.outcome.status === 'success'
        ? 'result'
        : 'error',
    toolCallId,
    toolName: selection.toolName,
    args: buildReviewedSelectionInput(selection),
    result,
  }
}

export async function applyChatBridgeRouteArtifactAction(
  options: ApplyChatBridgeRouteArtifactActionOptions
): Promise<ChatBridgeRouteArtifactActionResult> {
  const routeIndex = options.contentParts.findIndex(
    (candidate) => candidate.type === 'app' && candidate.appInstanceId === options.part.appInstanceId
  )
  const routeState = getChatBridgeRouteArtifactState(options.part)
  const decision = getChatBridgeRouteDecision(options.part)

  if (routeIndex === -1 || !decision) {
    return {
      nextContentParts: options.contentParts,
      outcome: 'stale',
    }
  }

  if (routeState && routeState.status !== 'pending') {
    return {
      nextContentParts: options.contentParts,
      outcome: 'stale',
      selectedAppId: routeState.selectedAppId,
      selectedAppName: routeState.selectedAppName,
    }
  }

  if (options.action.kind === 'chat-only') {
    const nextContentParts = [...options.contentParts]
    nextContentParts[routeIndex] = buildChatOnlyRoutePart(options.part)
    return {
      nextContentParts,
      outcome: 'chat-only',
    }
  }

  const entries = options.entries ?? ensureDefaultReviewedAppsRegistered()
  const selection = buildSelectionForRouteAction(options.part, options.action.appId, entries)

  if (!selection) {
    return {
      nextContentParts: options.contentParts,
      outcome: 'rejected',
      selectedAppId: options.action.appId,
      errorCode: 'invalid_route_action',
      errorMessage: 'The requested reviewed app is no longer available for this route decision.',
    }
  }

  const toolCallId = options.createToolCallId?.() ?? `route-choice:${selection.appId}:${crypto.randomUUID()}`
  const executionRecord = await executeReviewedSelection({
    selection,
    sessionId: options.sessionId,
    executors: options.executors,
    input: buildReviewedSelectionInput(selection),
    executionOptions: {
      toolCallId,
      messages: [],
    },
  })

  const nextContentParts = [...options.contentParts]
  const selectedAppId = selection.appId
  const selectedAppName = selection.appName
  const toolName = selection.toolName

  if (executionRecord.outcome.status !== 'success') {
    nextContentParts[routeIndex] = buildLaunchFailedRoutePart(
      options.part,
      selection,
      executionRecord.outcome.error?.code,
      executionRecord.outcome.error?.message
    )
    return {
      nextContentParts,
      outcome: 'launch-failed',
      selectedAppId,
      selectedAppName,
      toolName,
      errorCode: executionRecord.outcome.error?.code,
      errorMessage: executionRecord.outcome.error?.message,
    }
  }

  nextContentParts[routeIndex] = buildLaunchRequestedRoutePart(options.part, selection)
  nextContentParts.splice(routeIndex + 1, 0, createToolCallPart(selection, toolCallId, executionRecord))

  return {
    nextContentParts: upsertReviewedAppLaunchParts(nextContentParts),
    outcome: 'launch-requested',
    selectedAppId,
    selectedAppName,
    toolName,
  }
}
