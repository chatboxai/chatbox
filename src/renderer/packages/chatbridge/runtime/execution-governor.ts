import type { ToolSet } from 'ai'
import type {
  ChatBridgeExecutionGovernorArtifactKind,
  ChatBridgeExecutionGovernorRouteResolution,
  ChatBridgeExecutionGovernorTracePayload,
} from '@shared/chatbridge'
import { wrapChatBridgeHostTools } from '@shared/chatbridge'
import type { Message, MessageContentParts, MessageInfoPart } from '@shared/types'
import { createNoopLangSmithAdapter, type LangSmithAdapter } from '@shared/utils/langsmith_adapter'
import { upsertReviewedAppLaunchParts } from '../reviewed-app-launch'
import { createReviewedAppRouteArtifact } from '../router/decision'
import { createReviewedSingleAppToolSet } from '../single-app-tools'

type PrepareChatBridgeExecutionGovernorOptions = {
  messages: Message[]
  baseTools: ToolSet
  modelSupportsToolUse: boolean
  sessionId?: string
  traceAdapter?: Pick<LangSmithAdapter, 'recordEvent'>
  traceParentRunId?: string
  correlationMetadata?: Record<string, unknown>
}

type NormalizeChatBridgeExecutionGovernorContentPartsOptions = {
  reviewedRouteArtifact?: MessageContentParts[number]
}

type PreparedChatBridgeExecutionGovernorResult = {
  tools: ToolSet
  reviewedRouteArtifact?: MessageContentParts[number]
  routeResolution?: ChatBridgeExecutionGovernorRouteResolution
}

function toArtifactKind(reviewedRouteArtifact?: MessageContentParts[number]): ChatBridgeExecutionGovernorArtifactKind {
  if (reviewedRouteArtifact?.type !== 'app') {
    return null
  }

  const values = reviewedRouteArtifact.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return null
  }

  const decisionKind = (values as { chatbridgeRouteDecision?: { kind?: unknown } }).chatbridgeRouteDecision?.kind
  return decisionKind === 'clarify' || decisionKind === 'refuse' ? decisionKind : null
}

function createTracePayload(input: {
  routeDecision: ChatBridgeExecutionGovernorRouteResolution['routeDecision']
  selection: ChatBridgeExecutionGovernorRouteResolution['selection']
  selectionSource: ChatBridgeExecutionGovernorRouteResolution['selectionSource']
  toolNames: string[]
  reviewedRouteArtifact?: MessageContentParts[number]
}): ChatBridgeExecutionGovernorTracePayload {
  return {
    decisionKind: input.routeDecision.kind,
    reasonCode: input.routeDecision.reasonCode,
    selectedAppId: input.routeDecision.selectedAppId ?? null,
    selectionStatus: input.selection.status,
    selectionSource: input.selectionSource,
    toolNames: input.toolNames,
    artifactInserted: Boolean(input.reviewedRouteArtifact),
    artifactKind: toArtifactKind(input.reviewedRouteArtifact),
  }
}

export function prepareToolsForExecution(tools: ToolSet, sessionId?: string): ToolSet {
  return wrapChatBridgeHostTools(tools, { sessionId })
}

export function prepareChatBridgeExecutionGovernor(
  options: PrepareChatBridgeExecutionGovernorOptions
): PreparedChatBridgeExecutionGovernorResult {
  if (!options.modelSupportsToolUse) {
    return {
      tools: prepareToolsForExecution(options.baseTools, options.sessionId),
    }
  }

  const traceAdapter = options.traceAdapter ?? createNoopLangSmithAdapter()
  const reviewedToolSet = createReviewedSingleAppToolSet({ messages: options.messages })
  const toolNames = Object.keys(reviewedToolSet.tools).sort()
  const reviewedRouteArtifact =
    !reviewedToolSet.suppressRouteArtifact &&
    toolNames.length === 0 &&
    (reviewedToolSet.routeDecision.kind === 'clarify' || reviewedToolSet.routeDecision.kind === 'refuse')
      ? createReviewedAppRouteArtifact(reviewedToolSet.routeDecision)
      : undefined
  const tracePayload = createTracePayload({
    routeDecision: reviewedToolSet.routeDecision,
    selection: reviewedToolSet.selection,
    selectionSource: reviewedToolSet.selectionSource,
    toolNames,
    reviewedRouteArtifact,
  })
  const routeResolution: ChatBridgeExecutionGovernorRouteResolution = {
    routeDecision: reviewedToolSet.routeDecision,
    selection: reviewedToolSet.selection,
    selectionSource: reviewedToolSet.selectionSource,
    toolNames,
    tracePayload,
  }

  void traceAdapter
    .recordEvent({
      name: 'chatbridge.routing.reviewed-app-decision',
      runType: 'tool',
      parentRunId: options.traceParentRunId,
      inputs: {
        prompt: reviewedToolSet.routeDecision.prompt,
      },
      outputs: tracePayload,
      metadata: {
        ...options.correlationMetadata,
        operation: 'chatbridgeReviewedAppRouteDecision',
      },
      tags: [
        'chatbox',
        'renderer',
        'chatbridge',
        'routing',
        `decision:${reviewedToolSet.routeDecision.kind}`,
        `selection-source:${reviewedToolSet.selectionSource}`,
      ],
    })
    .catch((error) => {
      console.debug('Failed to record ChatBridge reviewed route decision trace event.', error)
    })

  return {
    tools: prepareToolsForExecution(
      toolNames.length > 0
        ? {
            ...options.baseTools,
            ...reviewedToolSet.tools,
          }
        : options.baseTools,
      options.sessionId
    ),
    reviewedRouteArtifact,
    routeResolution,
  }
}

export function normalizeChatBridgeExecutionGovernorContentParts(
  infoParts: MessageInfoPart[],
  contentParts: MessageContentParts,
  options: NormalizeChatBridgeExecutionGovernorContentPartsOptions = {}
) {
  return upsertReviewedAppLaunchParts([
    ...infoParts,
    ...(options.reviewedRouteArtifact ? [options.reviewedRouteArtifact] : []),
    ...contentParts,
  ])
}
