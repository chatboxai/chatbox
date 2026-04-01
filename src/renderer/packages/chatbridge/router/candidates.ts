import {
  getReviewedAppCatalog,
  resolveReviewedAppEligibility,
  type ReviewedAppCatalogEntry,
  type ReviewedAppEligibilityDecision,
  type ReviewedAppRouterCandidate,
  type ChatBridgeEligibilityContext,
} from '@shared/chatbridge'

export interface ChatBridgeRouterCatalog {
  context: ChatBridgeEligibilityContext | null
  contextIssues: string[]
  candidates: ReviewedAppRouterCandidate[]
  excluded: ReviewedAppEligibilityDecision[]
}

export function getReviewedAppRouterCatalog(
  contextInput: unknown,
  entries: ReviewedAppCatalogEntry[] = getReviewedAppCatalog()
): ChatBridgeRouterCatalog {
  const result = resolveReviewedAppEligibility(entries, contextInput)

  return {
    context: result.context,
    contextIssues: result.contextIssues,
    candidates: result.candidates,
    excluded: result.decisions.filter((decision) => !decision.eligible),
  }
}
