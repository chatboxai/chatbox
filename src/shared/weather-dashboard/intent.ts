import type { Message } from '../types'

export const WEATHER_DASHBOARD_HOST_FLOW = 'weather-dashboard' as const
export const WEATHER_DASHBOARD_MODEL_NAME = 'Weather Dashboard' as const

type WeatherDashboardHostStatus = 'awaiting-location' | 'route-ready'
type WeatherDashboardHostReason = 'missing-location' | 'ambiguous-location' | 'single-location-required'

export type WeatherDashboardHostState = {
  hostFlow: typeof WEATHER_DASHBOARD_HOST_FLOW
  status: WeatherDashboardHostStatus
  originalRequest: string
  reason?: WeatherDashboardHostReason
  locationQuery?: string
}

export type WeatherDashboardTurnResult =
  | { kind: 'none' }
  | {
      kind: 'clarify-location' | 'clarify-ambiguous-location' | 'clarify-single-location'
      message: string
      state: WeatherDashboardHostState
    }
  | {
      kind: 'route-ready'
      message: string
      state: WeatherDashboardHostState
    }

const WEATHER_REQUEST_PATTERN =
  /\b(weather|forecast|temperature|temp|rain|snow|wind|humid(?:ity)?|conditions?|sunny|cloudy|storm|precipitation)\b/i

const NON_SPECIFIC_LOCATION_PATTERNS = [
  /^here$/i,
  /^my (?:location|area)$/i,
  /^near me$/i,
  /^around me$/i,
  /^where i am$/i,
  /^outside$/i,
  /^today$/i,
  /^tomorrow$/i,
  /^tonight$/i,
  /^this weekend$/i,
]

const AMBIGUOUS_LOCATION_NAMES = new Set([
  'alexandria',
  'arlington',
  'athens',
  'auburn',
  'berlin',
  'burlington',
  'cambridge',
  'clinton',
  'columbus',
  'franklin',
  'georgetown',
  'greenville',
  'jackson',
  'madison',
  'manchester',
  'paris',
  'portland',
  'richmond',
  'rochester',
  'salem',
  'springfield',
  'victoria',
])

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function stripTrailingPunctuation(input: string): string {
  return input.replace(/[.?!,:;]+$/g, '').trim()
}

function stripTrailingTimeQualifier(input: string): string {
  return input.replace(/\b(today|tomorrow|tonight|right now|this weekend)\b$/i, '').trim()
}

function cleanLocationCandidate(input: string): string {
  const withoutLeadIn = input.replace(/^(?:in|for|at)\s+/i, '').trim()
  return stripTrailingTimeQualifier(stripTrailingPunctuation(withoutLeadIn))
}

function looksLikeWeatherRequest(input: string): boolean {
  return WEATHER_REQUEST_PATTERN.test(input)
}

function isNonSpecificLocation(input: string): boolean {
  const normalized = normalizeText(stripTrailingPunctuation(input))
  return NON_SPECIFIC_LOCATION_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isMultiLocationRequest(input: string): boolean {
  return /\b(and|vs\.?|versus|between)\b/i.test(input)
}

function hasLocationQualifier(input: string): boolean {
  if (input.includes(',')) {
    return true
  }

  return /\b([A-Z]{2}|usa|uk|canada|france|germany|japan|india|china|australia|brazil|mexico|illinois|massachusetts|ohio|texas|oregon|maine|california|washington|district of columbia|new york)\b/i.test(
    input
  )
}

function isAmbiguousLocation(input: string): boolean {
  const normalized = normalizeText(stripTrailingPunctuation(input)).toLowerCase()
  if (!normalized || hasLocationQualifier(input)) {
    return false
  }
  return AMBIGUOUS_LOCATION_NAMES.has(normalized)
}

function extractLocationFromWeatherRequest(input: string): string | null {
  const normalized = normalizeText(input)

  const trailingQualifierMatch = normalized.match(/\b(?:in|for|at)\s+(.+)$/i)
  if (trailingQualifierMatch?.[1]) {
    return cleanLocationCandidate(trailingQualifierMatch[1])
  }

  const leadingLocationMatch = normalized.match(
    /^(.+?)\s+(?:weather|forecast)(?:\s+(?:today|tomorrow|tonight|right now|this weekend))?$/i
  )
  if (leadingLocationMatch?.[1]) {
    return cleanLocationCandidate(leadingLocationMatch[1])
  }

  return null
}

function extractLocationFromReply(input: string): string {
  return cleanLocationCandidate(
    normalizeText(input).replace(/^(?:it'?s|it is)\s+/i, '').replace(/^(?:for me )/i, '').trim()
  )
}

function createClarificationState(
  originalRequest: string,
  reason: WeatherDashboardHostReason,
  locationQuery?: string
): WeatherDashboardHostState {
  return {
    hostFlow: WEATHER_DASHBOARD_HOST_FLOW,
    status: 'awaiting-location',
    originalRequest,
    reason,
    locationQuery,
  }
}

function createReadyState(originalRequest: string, locationQuery: string): WeatherDashboardHostState {
  return {
    hostFlow: WEATHER_DASHBOARD_HOST_FLOW,
    status: 'route-ready',
    originalRequest,
    locationQuery,
  }
}

function resolveLocationCandidate(candidate: string | null, originalRequest: string): WeatherDashboardTurnResult {
  if (!candidate || isNonSpecificLocation(candidate)) {
    return {
      kind: 'clarify-location',
      message:
        'Weather Dashboard needs a location. Reply with a city, optionally with state or country, like Chicago or Springfield, IL.',
      state: createClarificationState(originalRequest, 'missing-location'),
    }
  }

  if (isMultiLocationRequest(candidate)) {
    return {
      kind: 'clarify-single-location',
      message: 'Weather Dashboard supports one location at a time. Reply with a single city, optionally with state or country.',
      state: createClarificationState(originalRequest, 'single-location-required'),
    }
  }

  if (isAmbiguousLocation(candidate)) {
    return {
      kind: 'clarify-ambiguous-location',
      message: `I found multiple possible matches for ${candidate}. Reply with a more specific location, like ${candidate}, IL or ${candidate}, MA.`,
      state: createClarificationState(originalRequest, 'ambiguous-location', candidate),
    }
  }

  return {
    kind: 'route-ready',
    message: `Weather Dashboard route ready for ${candidate}.`,
    state: createReadyState(originalRequest, candidate),
  }
}

export function isWeatherDashboardHostState(values: unknown): values is WeatherDashboardHostState {
  if (!values || typeof values !== 'object') {
    return false
  }

  const candidate = values as Partial<WeatherDashboardHostState>
  return (
    candidate.hostFlow === WEATHER_DASHBOARD_HOST_FLOW &&
    (candidate.status === 'awaiting-location' || candidate.status === 'route-ready') &&
    typeof candidate.originalRequest === 'string'
  )
}

export function getLatestWeatherDashboardHostState(messages: Message[]): WeatherDashboardHostState | null {
  const lastMessage = messages.at(-1)
  if (!lastMessage || lastMessage.role !== 'assistant') {
    return null
  }

  for (const part of lastMessage.contentParts ?? []) {
    if (part.type === 'info' && isWeatherDashboardHostState(part.values)) {
      return part.values
    }
  }

  return null
}

export function resolveWeatherDashboardTurn(messages: Message[], userText: string): WeatherDashboardTurnResult {
  const normalizedUserText = normalizeText(userText)
  if (!normalizedUserText) {
    return { kind: 'none' }
  }

  const pendingState = getLatestWeatherDashboardHostState(messages)
  if (pendingState?.status === 'awaiting-location' && !looksLikeWeatherRequest(normalizedUserText)) {
    return resolveLocationCandidate(extractLocationFromReply(normalizedUserText), pendingState.originalRequest)
  }

  if (!looksLikeWeatherRequest(normalizedUserText)) {
    return { kind: 'none' }
  }

  return resolveLocationCandidate(extractLocationFromWeatherRequest(normalizedUserText), normalizedUserText)
}
