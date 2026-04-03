import { z } from 'zod'
import type { MessageAppPart } from '../types/session'
import {
  ReviewedAppEligibilityDecisionSchema,
  ReviewedAppRouterCandidateSchema,
  type ReviewedAppEligibilityDecision,
  type ReviewedAppRouterCandidate,
} from './eligibility'
import {
  ChatBridgeHostRuntimeSchema,
  getChatBridgeHostRuntimeLabel,
  getReviewedAppSupportedHostRuntimes,
  type ChatBridgeHostRuntime,
} from './manifest'

const MIN_MATCHED_TERM_LENGTH = 3
const MIN_RELEVANT_ROUTE_SCORE = 2
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'for',
  'from',
  'help',
  'how',
  'i',
  'in',
  'into',
  'is',
  'me',
  'my',
  'of',
  'on',
  'open',
  'please',
  'show',
  'start',
  'the',
  'to',
  'use',
  'with',
])

export const CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION = 2 as const
export const CHATBRIDGE_ROUTE_ARTIFACT_STATE_SCHEMA_VERSION = 1 as const
export const CHATBRIDGE_ROUTE_ARTIFACT_STATE_VALUES_KEY = 'chatbridgeRouteArtifactState' as const

export const ChatBridgeRouteDecisionKindSchema = z.enum(['invoke', 'clarify', 'refuse'])
export type ChatBridgeRouteDecisionKind = z.infer<typeof ChatBridgeRouteDecisionKindSchema>

export const ChatBridgeRouteDecisionReasonCodeSchema = z.enum([
  'explicit-app-match',
  'needs-confirmation',
  'ambiguous-match',
  'runtime-unsupported',
  'no-eligible-apps',
  'no-confident-match',
  'invalid-prompt',
])
export type ChatBridgeRouteDecisionReasonCode = z.infer<typeof ChatBridgeRouteDecisionReasonCodeSchema>

export const ChatBridgeRouteArtifactStatusSchema = z.enum(['pending', 'launch-requested', 'chat-only', 'launch-failed'])

export type ChatBridgeRouteArtifactStatus = z.infer<typeof ChatBridgeRouteArtifactStatusSchema>

export const ChatBridgeRouteArtifactStateSchema = z
  .object({
    schemaVersion: z
      .literal(CHATBRIDGE_ROUTE_ARTIFACT_STATE_SCHEMA_VERSION)
      .default(CHATBRIDGE_ROUTE_ARTIFACT_STATE_SCHEMA_VERSION),
    status: ChatBridgeRouteArtifactStatusSchema,
    selectedAppId: z.string().min(1).optional(),
    selectedAppName: z.string().min(1).optional(),
    statusLabel: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
  })
  .strict()

export type ChatBridgeRouteArtifactState = z.infer<typeof ChatBridgeRouteArtifactStateSchema>

export const ChatBridgeRouteCandidateMatchSchema = z
  .object({
    appId: z.string().min(1),
    appName: z.string().min(1),
    matchedContexts: z.array(z.string()).default([]),
    matchedTerms: z.array(z.string()).default([]),
    score: z.number().int().nonnegative(),
    exactAppMatch: z.boolean().default(false),
    exactToolMatch: z.boolean().default(false),
  })
  .strict()

export type ChatBridgeRouteCandidateMatch = z.infer<typeof ChatBridgeRouteCandidateMatchSchema>

export const ChatBridgeRouteRuntimeBlockSchema = z
  .object({
    hostRuntime: ChatBridgeHostRuntimeSchema,
    supportedHostRuntimes: z.array(ChatBridgeHostRuntimeSchema).min(1),
  })
  .strict()
export type ChatBridgeRouteRuntimeBlock = z.infer<typeof ChatBridgeRouteRuntimeBlockSchema>

export const ChatBridgeRouteDecisionSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION),
    hostRuntime: ChatBridgeHostRuntimeSchema,
    kind: ChatBridgeRouteDecisionKindSchema,
    reasonCode: ChatBridgeRouteDecisionReasonCodeSchema,
    prompt: z.string().min(1),
    summary: z.string().min(1),
    selectedAppId: z.string().min(1).optional(),
    matches: z.array(ChatBridgeRouteCandidateMatchSchema).max(3).default([]),
    runtimeBlock: ChatBridgeRouteRuntimeBlockSchema.optional(),
  })
  .strict()

export type ChatBridgeRouteDecision = z.infer<typeof ChatBridgeRouteDecisionSchema>

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeForSearch(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      normalizeForSearch(value)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= MIN_MATCHED_TERM_LENGTH && !STOP_WORDS.has(token))
    )
  )
}

function createPhraseVariants(...values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (value ? normalizeForSearch(value) : '')).filter(Boolean)))
}

function matchesPhrase(prompt: string, phrases: string[]): boolean {
  return phrases.some((phrase) => phrase.length > 0 && prompt.includes(phrase))
}

function getWeightedTokens(candidate: ReviewedAppRouterCandidate): Map<string, number> {
  const weightedTokens = new Map<string, number>()

  const addTokens = (values: string[], weight: number) => {
    for (const value of values) {
      weightedTokens.set(value, Math.max(weightedTokens.get(value) ?? 0, weight))
    }
  }

  addTokens(
    tokenize(candidate.entry.manifest.name).concat(tokenize(candidate.entry.manifest.appId.replace(/-/g, ' '))),
    3
  )
  addTokens(
    candidate.entry.manifest.toolSchemas.flatMap((tool) =>
      tokenize([tool.name.replace(/[_:-]/g, ' '), tool.title, tool.description].filter(Boolean).join(' '))
    ),
    2
  )
  addTokens(
    candidate.entry.manifest.permissions.flatMap((permission) =>
      tokenize(`${permission.resource} ${permission.purpose} ${permission.id.replace(/[._:-]/g, ' ')}`)
    ),
    1
  )

  return weightedTokens
}

function scoreReviewedAppCandidate(
  prompt: string,
  promptTokens: string[],
  candidate: ReviewedAppRouterCandidate
): ChatBridgeRouteCandidateMatch {
  const promptSearch = normalizeForSearch(prompt)
  const weightedTokens = getWeightedTokens(candidate)
  const matchedTerms: string[] = []
  let score = 0

  for (const token of promptTokens) {
    const weight = weightedTokens.get(token)
    if (!weight) {
      continue
    }
    matchedTerms.push(token)
    score += weight
  }

  const appPhrases = createPhraseVariants(
    candidate.entry.manifest.name,
    candidate.entry.manifest.appId.replace(/-/g, ' ')
  )
  const toolPhrases = candidate.entry.manifest.toolSchemas.flatMap((tool) =>
    createPhraseVariants(tool.name.replace(/[_:-]/g, ' '), tool.title, tool.description)
  )

  const exactAppMatch = matchesPhrase(promptSearch, appPhrases)
  const exactToolMatch = matchesPhrase(promptSearch, toolPhrases)

  if (exactAppMatch) {
    score += 6
  }
  if (exactToolMatch) {
    score += 4
  }

  return {
    appId: candidate.entry.manifest.appId,
    appName: candidate.entry.manifest.name,
    matchedContexts: candidate.matchedContexts,
    matchedTerms,
    score,
    exactAppMatch,
    exactToolMatch,
  }
}

function sortMatches<T extends ChatBridgeRouteCandidateMatch>(matches: T[]): T[] {
  return [...matches].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    if (left.exactAppMatch !== right.exactAppMatch) {
      return left.exactAppMatch ? -1 : 1
    }
    if (left.exactToolMatch !== right.exactToolMatch) {
      return left.exactToolMatch ? -1 : 1
    }
    return left.appName.localeCompare(right.appName)
  })
}

function getSelectedMatch(
  matches: ChatBridgeRouteCandidateMatch[],
  selectedAppId?: string
): ChatBridgeRouteCandidateMatch | null {
  if (!selectedAppId) {
    return null
  }

  return matches.find((match) => match.appId === selectedAppId) ?? null
}

function buildClarifySummary(
  selected: ChatBridgeRouteCandidateMatch,
  alternates: ChatBridgeRouteCandidateMatch[]
): string {
  if (alternates.length === 0) {
    return `This request may fit ${selected.appName}, but the host wants confirmation before launching a reviewed app.`
  }

  const alternateNames = alternates.map((match) => match.appName)
  const formattedAlternates =
    alternateNames.length === 1
      ? alternateNames[0]
      : `${alternateNames.slice(0, -1).join(', ')} or ${alternateNames[alternateNames.length - 1]}`

  return `This request could fit ${selected.appName} or ${formattedAlternates}, so the host is asking before launching anything.`
}

type ScoredRouteMatch = ChatBridgeRouteCandidateMatch & {
  runtimeUnsupported?: boolean
  supportedHostRuntimes?: ChatBridgeHostRuntime[]
}

function getRuntimeUnsupportedMatch(
  prompt: string,
  promptTokens: string[],
  decision: ReviewedAppEligibilityDecision
): ScoredRouteMatch | null {
  const runtimeUnsupported = decision.reasons.some((reason) => reason.code === 'runtime-unsupported')
  if (!runtimeUnsupported) {
    return null
  }

  return {
    ...scoreReviewedAppCandidate(prompt, promptTokens, {
      entry: decision.entry,
      matchedContexts: decision.matchedContexts,
    }),
    runtimeUnsupported: true,
    supportedHostRuntimes: getReviewedAppSupportedHostRuntimes(decision.entry),
  }
}

export function resolveReviewedAppRouteDecision(
  candidates: ReviewedAppRouterCandidate[],
  promptInput: unknown,
  options: {
    excluded?: ReviewedAppEligibilityDecision[]
    hostRuntime?: ChatBridgeHostRuntime
  } = {}
): ChatBridgeRouteDecision {
  const prompt = typeof promptInput === 'string' ? normalizeWhitespace(promptInput) : ''
  const hostRuntime = options.hostRuntime ?? 'desktop-electron'

  if (!prompt) {
    return {
      schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
      hostRuntime,
      kind: 'refuse',
      reasonCode: 'invalid-prompt',
      prompt: 'The user request was empty or invalid.',
      summary: 'The host kept routing in chat because the request was empty or invalid.',
      matches: [],
    }
  }

  const promptTokens = tokenize(prompt)
  const eligibleMatches = sortMatches(
    candidates.map((candidate) => scoreReviewedAppCandidate(prompt, promptTokens, candidate))
  ).slice(0, 3)
  const runtimeUnsupportedMatches = sortMatches(
    (options.excluded ?? [])
      .map((decision) => getRuntimeUnsupportedMatch(prompt, promptTokens, decision))
      .filter((match): match is ScoredRouteMatch => match !== null)
  ).slice(0, 3)
  const combinedMatches: ScoredRouteMatch[] = sortMatches<ScoredRouteMatch>([
    ...eligibleMatches,
    ...runtimeUnsupportedMatches,
  ]).slice(0, 3)
  const combinedRelevantMatches = combinedMatches.filter((match) => match.score >= MIN_RELEVANT_ROUTE_SCORE)
  const topCombinedMatch = combinedRelevantMatches[0]

  if (topCombinedMatch?.runtimeUnsupported) {
    const runtimeBlock: ChatBridgeRouteRuntimeBlock = {
      hostRuntime,
      supportedHostRuntimes: topCombinedMatch.supportedHostRuntimes ?? ['desktop-electron'],
    }
    const supportedLabels = runtimeBlock.supportedHostRuntimes.map((runtime) => getChatBridgeHostRuntimeLabel(runtime))
    const supportedLabel =
      supportedLabels.length === 1
        ? supportedLabels[0]
        : `${supportedLabels.slice(0, -1).join(', ')} or ${supportedLabels[supportedLabels.length - 1]}`

    return {
      schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
      hostRuntime,
      kind: 'refuse',
      reasonCode: 'runtime-unsupported',
      prompt,
      summary: `${topCombinedMatch.appName} matches this request, but it only launches in ${supportedLabel} right now.`,
      selectedAppId: topCombinedMatch.appId,
      matches: combinedRelevantMatches,
      runtimeBlock,
    }
  }

  const relevantEligibleMatches = eligibleMatches.filter((match) => match.score >= MIN_RELEVANT_ROUTE_SCORE)
  const topMatch = relevantEligibleMatches[0]
  const secondMatch = relevantEligibleMatches[1]

  if (!topMatch) {
    return {
      schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
      hostRuntime,
      kind: 'refuse',
      reasonCode: candidates.length === 0 ? 'no-eligible-apps' : 'no-confident-match',
      prompt,
      summary:
        candidates.length === 0
          ? 'No reviewed apps are currently eligible for this host context, so the request stays in chat.'
          : 'No reviewed app is a confident fit for this request, so the host will keep helping in chat instead of forcing a launch.',
      matches: relevantEligibleMatches,
    }
  }

  const topMatchIsExplicit = topMatch.exactAppMatch || topMatch.exactToolMatch
  const topMatchClearlyAhead = !secondMatch || topMatch.score - secondMatch.score >= 3

  if (topMatchIsExplicit && topMatchClearlyAhead) {
    return {
      schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
      hostRuntime,
      kind: 'invoke',
      reasonCode: 'explicit-app-match',
      prompt,
      summary: `The host found a clear reviewed-app match and can open ${topMatch.appName} without guessing.`,
      selectedAppId: topMatch.appId,
      matches: relevantEligibleMatches,
    }
  }

  const alternates = secondMatch ? relevantEligibleMatches.slice(1, 3) : []
  return {
    schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
    hostRuntime,
    kind: 'clarify',
    reasonCode: secondMatch ? 'ambiguous-match' : 'needs-confirmation',
    prompt,
    summary: buildClarifySummary(topMatch, alternates),
    selectedAppId: topMatch.appId,
    matches: relevantEligibleMatches,
  }
}

export function getChatBridgeRouteDecision(part: Pick<MessageAppPart, 'values'>): ChatBridgeRouteDecision | null {
  const parsed = ChatBridgeRouteDecisionSchema.safeParse(part.values?.chatbridgeRouteDecision)
  return parsed.success ? parsed.data : null
}

export function readChatBridgeRouteArtifactState(values: Record<string, unknown> | undefined) {
  const parsed = ChatBridgeRouteArtifactStateSchema.safeParse(values?.[CHATBRIDGE_ROUTE_ARTIFACT_STATE_VALUES_KEY])
  return parsed.success ? parsed.data : null
}

export function getChatBridgeRouteArtifactState(
  part: Pick<MessageAppPart, 'values'>
): ChatBridgeRouteArtifactState | null {
  return readChatBridgeRouteArtifactState(
    part.values && typeof part.values === 'object' ? (part.values as Record<string, unknown>) : undefined
  )
}

export function writeChatBridgeRouteArtifactStateValues(
  values: Record<string, unknown> | undefined,
  state: ChatBridgeRouteArtifactState
) {
  return {
    ...(values || {}),
    [CHATBRIDGE_ROUTE_ARTIFACT_STATE_VALUES_KEY]: ChatBridgeRouteArtifactStateSchema.parse(state),
  }
}

export function createChatBridgeRouteMessagePart(decision: ChatBridgeRouteDecision): MessageAppPart {
  const selected = getSelectedMatch(decision.matches, decision.selectedAppId)
  const appId = selected?.appId ?? 'chatbridge-router'
  const appName = selected?.appName ?? 'ChatBridge'
  const isRuntimeUnsupported = decision.reasonCode === 'runtime-unsupported'
  const routeArtifactValues = writeChatBridgeRouteArtifactStateValues(
    {
      chatbridgeRouteDecision: decision,
    },
    {
      schemaVersion: CHATBRIDGE_ROUTE_ARTIFACT_STATE_SCHEMA_VERSION,
      status: 'pending',
    }
  )

  if (isRuntimeUnsupported) {
    const supportedHostRuntimes = decision.runtimeBlock?.supportedHostRuntimes ?? ['desktop-electron']
    const supportedRuntimeLabels = supportedHostRuntimes.map((runtime) => getChatBridgeHostRuntimeLabel(runtime))
    const supportedRuntimeSummary =
      supportedRuntimeLabels.length === 1
        ? supportedRuntimeLabels[0]
        : `${supportedRuntimeLabels.slice(0, -1).join(', ')} or ${supportedRuntimeLabels[supportedRuntimeLabels.length - 1]}`

    return {
      type: 'app',
      appId,
      appName,
      appInstanceId: `route:${decision.reasonCode}:${appId}`,
      lifecycle: 'error',
      summary: decision.summary,
      title: `${appName} is unavailable here`,
      description: `${appName} matches this request, but this ${getChatBridgeHostRuntimeLabel(decision.hostRuntime).toLowerCase()} host cannot launch it yet.`,
      statusText: decision.hostRuntime === 'web-browser' ? 'Desktop only' : 'Unavailable',
      fallbackTitle: 'Supported runtime required',
      fallbackText: `Current runtime: ${getChatBridgeHostRuntimeLabel(decision.hostRuntime)}. Supported runtimes: ${supportedRuntimeSummary}. The host kept the request in chat instead of attempting a broken launch.`,
      values: routeArtifactValues,
    }
  }

  const title =
    decision.kind === 'invoke'
      ? `${appName} is ready`
      : decision.kind === 'clarify'
        ? 'Choose the next step'
        : 'Keep this in chat'
  const statusText = decision.kind === 'invoke' ? 'Launch app' : decision.kind === 'clarify' ? 'Clarify' : 'Chat only'

  return {
    type: 'app',
    appId,
    appName,
    appInstanceId: `route:${decision.kind}:${appId}`,
    lifecycle: 'ready',
    summary: decision.summary,
    title,
    statusText,
    values: routeArtifactValues,
  }
}
