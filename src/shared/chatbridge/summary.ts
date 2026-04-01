import type { ChatBridgeCompletionPayload } from './completion'

const SENSITIVE_OUTCOME_KEY_PATTERN = /(token|secret|password|credential|cookie|authorization|email|api[_-]?key|refresh)/i
const MAX_DETAIL_ENTRIES = 3

type NormalizeChatBridgeCompletionSummaryInput = {
  appId: string
  appName?: string
  payload: ChatBridgeCompletionPayload
}

type NormalizedChatBridgeSummary = {
  summaryForModel: string
  redactedKeys: string[]
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function getAppLabel(input: Pick<NormalizeChatBridgeCompletionSummaryInput, 'appId' | 'appName'>): string {
  const appName = input.appName?.trim()
  if (appName) {
    return appName
  }

  const appId = input.appId.trim()
  return appId || 'App'
}

function buildLeadText(appLabel: string, payload: ChatBridgeCompletionPayload): string {
  const suggestedText = payload.suggestedSummary?.text ? normalizeWhitespace(payload.suggestedSummary.text) : ''
  const suggestedTitle = payload.suggestedSummary?.title ? normalizeWhitespace(payload.suggestedSummary.title) : ''

  if (suggestedText) {
    return suggestedTitle ? `${suggestedTitle}: ${suggestedText}` : suggestedText
  }

  switch (payload.status) {
    case 'success':
      return `${appLabel} completed successfully.`
    case 'interrupted':
      return `${appLabel} was interrupted: ${normalizeWhitespace(payload.reason)}.`
    case 'failed':
      return `${appLabel} failed with ${normalizeWhitespace(payload.error.code)}: ${normalizeWhitespace(payload.error.message)}.`
  }
}

function formatOutcomeValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = normalizeWhitespace(value)
    return normalized || null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

function collectApprovedOutcomeDetails(payload: ChatBridgeCompletionPayload): { details: string[]; redactedKeys: string[] } {
  const details: string[] = []
  const redactedKeys: string[] = []

  if (!payload.outcomeData) {
    return { details, redactedKeys }
  }

  for (const [key, value] of Object.entries(payload.outcomeData)) {
    if (SENSITIVE_OUTCOME_KEY_PATTERN.test(key)) {
      redactedKeys.push(key)
      continue
    }

    const formattedValue = formatOutcomeValue(value)
    if (!formattedValue) {
      continue
    }

    details.push(`${key}: ${formattedValue}`)
    if (details.length >= MAX_DETAIL_ENTRIES) {
      break
    }
  }

  return { details, redactedKeys }
}

function buildResumabilityText(payload: ChatBridgeCompletionPayload): string | null {
  if (!('resumability' in payload) || !payload.resumability?.resumable) {
    return null
  }

  const segments = ['Resumable checkpoint available.']
  if (payload.resumability.checkpointId) {
    segments.push(`checkpointId: ${normalizeWhitespace(payload.resumability.checkpointId)}.`)
  }
  if (payload.resumability.resumeHint) {
    segments.push(normalizeWhitespace(payload.resumability.resumeHint))
  }
  return segments.join(' ')
}

export function normalizeChatBridgeCompletionSummaryForModel(
  input: NormalizeChatBridgeCompletionSummaryInput
): NormalizedChatBridgeSummary {
  const appLabel = getAppLabel(input)
  const leadText = buildLeadText(appLabel, input.payload)
  const { details, redactedKeys } = collectApprovedOutcomeDetails(input.payload)
  const resumabilityText = buildResumabilityText(input.payload)

  const summaryParts = [
    leadText,
    details.length > 0 ? `Approved details: ${details.join('; ')}.` : null,
    resumabilityText,
  ].filter((part): part is string => Boolean(part))

  return {
    summaryForModel: normalizeWhitespace(summaryParts.join(' ')),
    redactedKeys,
  }
}
