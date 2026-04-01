import {
  createChatBridgeRouteMessagePart,
  getReviewedAppCatalog,
  resolveReviewedAppRouteDecision,
  type ChatBridgeRouteDecision,
  type ReviewedAppCatalogEntry,
} from '@shared/chatbridge'
import { getReviewedAppRouterCatalog, type ChatBridgeRouterCatalog } from './candidates'

export interface ReviewedAppRouteDecisionResult {
  catalog: ChatBridgeRouterCatalog
  decision: ChatBridgeRouteDecision
}

export function getReviewedAppRouteDecision(options: {
  promptInput: unknown
  contextInput: unknown
  entries?: ReviewedAppCatalogEntry[]
}): ReviewedAppRouteDecisionResult {
  const catalog = getReviewedAppRouterCatalog(options.contextInput, options.entries ?? getReviewedAppCatalog())

  return {
    catalog,
    decision: resolveReviewedAppRouteDecision(catalog.candidates, options.promptInput),
  }
}

export function createReviewedAppRouteArtifact(decision: ChatBridgeRouteDecision) {
  return createChatBridgeRouteMessagePart(decision)
}
