import { z } from 'zod'
import type { MessageAppPart } from '../types/session'
import {
  ReviewedAppRouterCandidateSchema,
  type ReviewedAppRouterCandidate,
} from './eligibility'

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

export const CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION = 1 as const

export const ChatBridgeRouteDecisionKindSchema = z.enum(['invoke', 'clarify', 'refuse'])
export type ChatBridgeRouteDecisionKind = z.infer<typeof ChatBridgeRouteDecisionKindSchema>

export const ChatBridgeRouteDecisionReasonCodeSchema = z.enum([
  'explicit-app-match',
  'needs-confirmation',
  'ambiguous-match',
  'no-eligible-apps',
  'no-confident-match',
  'invalid-prompt',
])
export type ChatBridgeRouteDecisionReasonCode = z.infer<typeof ChatBridgeRouteDecisionReasonCodeSchema>

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

export const ChatBridgeRouteDecisionSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION),
    kind: ChatBridgeRouteDecisionKindSchema,
    reasonCode: ChatBridgeRouteDecisionReasonCodeSchema,
    prompt: z.string().min(1),
    summary: z.string().min(1),
    selectedAppId: z.string().min(1).optional(),
    matches: z.array(ChatBridgeRouteCandidateMatchSchema).max(3).default([]),
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
  return Array.from(
    new Set(
      values
        .map((value) => (value ? normalizeForSearch(value) : ''))
        .filter(Boolean)
    )
  )
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

  const appPhrases = createPhraseVariants(candidate.entry.manifest.name, candidate.entry.manifest.appId.replace(/-/g, ' '))
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

function sortMatches(matches: ChatBridgeRouteCandidateMatch[]): ChatBridgeRouteCandidateMatch[] {
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

function buildClarifySummary(selected: ChatBridgeRouteCandidateMatch, alternates: ChatBridgeRouteCandidateMatch[]): string {
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

export function resolveReviewedAppRouteDecision(
  candidates: ReviewedAppRouterCandidate[],
  promptInput: unknown
): ChatBridgeRouteDecision {
  const prompt = typeof promptInput === 'string' ? normalizeWhitespace(promptInput) : ''

  if (!prompt) {
    return {
      schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
      kind: 'refuse',
      reasonCode: 'invalid-prompt',
      prompt: 'The user request was empty or invalid.',
      summary: 'The host kept routing in chat because the request was empty or invalid.',
      matches: [],
    }
  }

  if (candidates.length === 0) {
    return {
      schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
      kind: 'refuse',
      reasonCode: 'no-eligible-apps',
      prompt,
      summary: 'No reviewed apps are currently eligible for this host context, so the request stays in chat.',
      matches: [],
    }
  }

  const promptTokens = tokenize(prompt)
  const matches = sortMatches(candidates.map((candidate) => scoreReviewedAppCandidate(prompt, promptTokens, candidate))).slice(
    0,
    3
  )
  const relevantMatches = matches.filter((match) => match.score >= MIN_RELEVANT_ROUTE_SCORE)
  const topMatch = relevantMatches[0]
  const secondMatch = relevantMatches[1]

  if (!topMatch) {
    return {
      schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
      kind: 'refuse',
      reasonCode: 'no-confident-match',
      prompt,
      summary: 'No reviewed app is a confident fit for this request, so the host will keep helping in chat instead of forcing a launch.',
      matches,
    }
  }

  const topMatchIsExplicit = topMatch.exactAppMatch || topMatch.exactToolMatch
  const topMatchClearlyAhead = !secondMatch || topMatch.score - secondMatch.score >= 3

  if (topMatchIsExplicit && topMatchClearlyAhead) {
    return {
      schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
      kind: 'invoke',
      reasonCode: 'explicit-app-match',
      prompt,
      summary: `The host found a clear reviewed-app match and can open ${topMatch.appName} without guessing.`,
      selectedAppId: topMatch.appId,
      matches,
    }
  }

  const alternates = secondMatch ? relevantMatches.slice(1, 3) : []
  return {
    schemaVersion: CHATBRIDGE_ROUTE_DECISION_SCHEMA_VERSION,
    kind: 'clarify',
    reasonCode: secondMatch ? 'ambiguous-match' : 'needs-confirmation',
    prompt,
    summary: buildClarifySummary(topMatch, alternates),
    selectedAppId: topMatch.appId,
    matches,
  }
}

export function getChatBridgeRouteDecision(
  part: Pick<MessageAppPart, 'values'>
): ChatBridgeRouteDecision | null {
  const parsed = ChatBridgeRouteDecisionSchema.safeParse(part.values?.chatbridgeRouteDecision)
  return parsed.success ? parsed.data : null
}

export function createChatBridgeRouteMessagePart(decision: ChatBridgeRouteDecision): MessageAppPart {
  const selected = getSelectedMatch(decision.matches, decision.selectedAppId)
  const appId = selected?.appId ?? 'chatbridge-router'
  const appName = selected?.appName ?? 'ChatBridge'
  const title =
    decision.kind === 'invoke'
      ? `${appName} is ready`
      : decision.kind === 'clarify'
        ? 'Choose the next step'
        : 'Keep this in chat'
  const statusText =
    decision.kind === 'invoke' ? 'Launch app' : decision.kind === 'clarify' ? 'Clarify' : 'Chat only'

  return {
    type: 'app',
    appId,
    appName,
    appInstanceId: `route:${decision.kind}:${appId}`,
    lifecycle: 'ready',
    summary: decision.summary,
    title,
    statusText,
    values: {
      chatbridgeRouteDecision: decision,
    },
  }
}
