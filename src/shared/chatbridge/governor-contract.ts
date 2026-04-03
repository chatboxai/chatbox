import type { ChatBridgeRouteDecision } from './routing'
import type { ReviewedSingleAppSelection } from './single-app-discovery'

export type ChatBridgeExecutionGovernorSelectionSource = 'route-decision' | 'natural-chess-fallback' | 'none'

export type ChatBridgeExecutionGovernorArtifactKind = 'clarify' | 'refuse' | null

export type ChatBridgeExecutionGovernorTracePayload = {
  decisionKind: ChatBridgeRouteDecision['kind']
  reasonCode: ChatBridgeRouteDecision['reasonCode']
  selectedAppId: string | null
  selectionStatus: ReviewedSingleAppSelection['status']
  selectionSource: ChatBridgeExecutionGovernorSelectionSource
  toolNames: string[]
  artifactInserted: boolean
  artifactKind: ChatBridgeExecutionGovernorArtifactKind
}

export type ChatBridgeExecutionGovernorRouteResolution = {
  routeDecision: ChatBridgeRouteDecision
  selection: ReviewedSingleAppSelection
  selectionSource: ChatBridgeExecutionGovernorSelectionSource
  toolNames: string[]
  tracePayload: ChatBridgeExecutionGovernorTracePayload
}
