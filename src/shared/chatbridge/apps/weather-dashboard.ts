import { z } from 'zod'

export const WEATHER_DASHBOARD_APP_ID = 'weather-dashboard'
export const WEATHER_DASHBOARD_APP_NAME = 'Weather Dashboard'
export const WEATHER_DASHBOARD_SNAPSHOT_SCHEMA_VERSION = 1 as const

export const WeatherDashboardUnitsSchema = z.enum(['imperial', 'metric'])
export type WeatherDashboardUnits = z.infer<typeof WeatherDashboardUnitsSchema>

export const WeatherDashboardStatusSchema = z.enum(['loading', 'ready', 'degraded', 'unavailable'])
export type WeatherDashboardStatus = z.infer<typeof WeatherDashboardStatusSchema>

export const WeatherDashboardCacheStatusSchema = z.enum(['none', 'miss', 'hit', 'refreshed', 'stale-fallback'])
export type WeatherDashboardCacheStatus = z.infer<typeof WeatherDashboardCacheStatusSchema>

export const WeatherDashboardDegradedReasonSchema = z.enum([
  'missing-location',
  'location-not-found',
  'upstream-timeout',
  'upstream-error',
  'invalid-response',
])
export type WeatherDashboardDegradedReason = z.infer<typeof WeatherDashboardDegradedReasonSchema>

export const WeatherDashboardCurrentConditionsSchema = z
  .object({
    temperature: z.number(),
    apparentTemperature: z.number().optional(),
    weatherCode: z.number().int().nonnegative(),
    conditionLabel: z.string().trim().min(1),
    windSpeed: z.number().nonnegative().optional(),
  })
  .strict()
export type WeatherDashboardCurrentConditions = z.infer<typeof WeatherDashboardCurrentConditionsSchema>

export const WeatherDashboardForecastDaySchema = z
  .object({
    dateKey: z.string().trim().min(1),
    dayLabel: z.string().trim().min(1),
    high: z.number(),
    low: z.number(),
    weatherCode: z.number().int().nonnegative(),
    conditionLabel: z.string().trim().min(1),
    precipitationChance: z.number().min(0).max(100).optional(),
  })
  .strict()
export type WeatherDashboardForecastDay = z.infer<typeof WeatherDashboardForecastDaySchema>

export const WeatherDashboardDegradedStateSchema = z
  .object({
    reason: WeatherDashboardDegradedReasonSchema,
    title: z.string().trim().min(1),
    message: z.string().trim().min(1),
    retryable: z.boolean(),
    usingStaleSnapshot: z.boolean().default(false),
  })
  .strict()
export type WeatherDashboardDegradedState = z.infer<typeof WeatherDashboardDegradedStateSchema>

export const WeatherDashboardSnapshotSchema = z
  .object({
    schemaVersion: z.literal(WEATHER_DASHBOARD_SNAPSHOT_SCHEMA_VERSION),
    appId: z.literal(WEATHER_DASHBOARD_APP_ID),
    request: z.string().trim().min(1).optional(),
    locationQuery: z.string().trim().min(1).optional(),
    locationName: z.string().trim().min(1),
    timezone: z.string().trim().min(1).optional(),
    units: WeatherDashboardUnitsSchema,
    status: WeatherDashboardStatusSchema,
    statusText: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    headline: z.string().trim().min(1),
    dataStateLabel: z.string().trim().min(1),
    lastUpdatedLabel: z.string().trim().min(1),
    sourceLabel: z.string().trim().min(1),
    cacheStatus: WeatherDashboardCacheStatusSchema,
    refreshHint: z.string().trim().min(1),
    updatedAt: z.number().int().nonnegative(),
    current: WeatherDashboardCurrentConditionsSchema.optional(),
    forecast: z.array(WeatherDashboardForecastDaySchema).max(4).default([]),
    degraded: WeatherDashboardDegradedStateSchema.optional(),
  })
  .strict()
export type WeatherDashboardSnapshot = z.infer<typeof WeatherDashboardSnapshotSchema>

export const ChatBridgeWeatherDashboardQuerySchema = z
  .object({
    request: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),
    units: WeatherDashboardUnitsSchema.optional(),
    refresh: z.boolean().default(false),
    traceParentRunId: z.string().trim().min(1).optional(),
  })
  .strict()
export type ChatBridgeWeatherDashboardQuery = z.infer<typeof ChatBridgeWeatherDashboardQuerySchema>

export const ChatBridgeWeatherDashboardResultSchema = z
  .object({
    snapshot: WeatherDashboardSnapshotSchema,
  })
  .strict()
export type ChatBridgeWeatherDashboardResult = z.infer<typeof ChatBridgeWeatherDashboardResultSchema>

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Heavy showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm and hail',
  99: 'Severe thunderstorm and hail',
}

function capitalizeWords(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase())
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function stripTrailingForecastPhrases(value: string) {
  return value
    .replace(/\b(?:and\s+show(?:\s+me)?|and\s+give(?:\s+me)?|and\s+tell(?:\s+me)?|and\s+open)\b.*$/gi, '')
    .replace(/\b(weather|forecast|temperature|conditions|today|tonight|tomorrow|right now|this week|this weekend)\b/gi, '')
    .replace(/\b(open|show|launch|check|tell me|give me|dashboard)\b/gi, '')
    .replace(/\band\b$/i, '')
    .replace(/\b(in|for|at|near)\b$/i, '')
}

function trimLeadingFiller(value: string) {
  return value
    .replace(/^(what(?:'s| is)|show me|tell me|give me|open|launch|check|can you show me|could you show me)\s+/i, '')
    .replace(/^(the\s+)?weather(\s+dashboard)?\s+/i, '')
}

export function normalizeWeatherLocationHint(location?: string, request?: string) {
  const explicitLocation = location?.trim()
  if (explicitLocation) {
    return explicitLocation
  }

  const normalizedRequest = normalizeWhitespace(request ?? '')
  if (!normalizedRequest) {
    return undefined
  }

  const patterns = [
    /\b(?:weather|forecast|conditions)\s+(?:in|for|at|near)\s+(.+?)(?:[?.!,]|$)/i,
    /\bopen\s+weather\s+dashboard\s+(?:in|for|at|near)\s+(.+?)(?:[?.!,]|$)/i,
    /\bshow\s+me\s+(?:the\s+)?(?:weather|forecast)\s+(?:in|for|at|near)\s+(.+?)(?:[?.!,]|$)/i,
    /^(.+?)\s+(?:weather|forecast|conditions)(?:[?.!,]|$)/i,
  ]

  for (const pattern of patterns) {
    const match = normalizedRequest.match(pattern)
    const candidate = match?.[1] ? stripTrailingForecastPhrases(match[1]) : ''
    const cleaned = normalizeWhitespace(candidate)
    if (cleaned) {
      return capitalizeWords(cleaned)
    }
  }

  const simplified = stripTrailingForecastPhrases(trimLeadingFiller(normalizedRequest))
  const fallback = normalizeWhitespace(simplified)
  return fallback.length >= 2 ? capitalizeWords(fallback) : undefined
}

export function resolveWeatherUnits(request?: string, units?: WeatherDashboardUnits) {
  if (units) {
    return units
  }

  const normalizedRequest = normalizeWhitespace(request ?? '').toLowerCase()
  if (/\b(celsius|metric|centigrade|km\/h|kph)\b/.test(normalizedRequest)) {
    return 'metric'
  }

  if (/\b(fahrenheit|imperial|mph)\b/.test(normalizedRequest)) {
    return 'imperial'
  }

  return 'imperial'
}

export function getWeatherConditionLabel(weatherCode: number) {
  return WEATHER_CODE_LABELS[weatherCode] ?? 'Unknown conditions'
}

export function formatWeatherTemperature(value: number, units: WeatherDashboardUnits) {
  return `${Math.round(value)}°${units === 'imperial' ? 'F' : 'C'}`
}

export function formatWeatherWindSpeed(value: number, units: WeatherDashboardUnits) {
  return `${Math.round(value)} ${units === 'imperial' ? 'mph' : 'km/h'}`
}

export function formatWeatherUpdatedAt(updatedAt: number, timezone?: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: timezone ? 'short' : undefined,
    }).format(updatedAt)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(updatedAt)
  }
}

function buildReadyStatusText(cacheStatus: WeatherDashboardCacheStatus) {
  if (cacheStatus === 'hit') {
    return 'Using cached weather'
  }

  if (cacheStatus === 'refreshed') {
    return 'Weather refreshed'
  }

  return 'Live weather'
}

function buildReadyDataStateLabel(cacheStatus: WeatherDashboardCacheStatus) {
  if (cacheStatus === 'hit') {
    return 'Host cache hit'
  }

  if (cacheStatus === 'refreshed') {
    return 'Fresh upstream refresh'
  }

  return 'Fresh host snapshot'
}

type CreateWeatherDashboardReadySnapshotInput = {
  request?: string
  locationQuery?: string
  locationName: string
  timezone?: string
  units: WeatherDashboardUnits
  current: WeatherDashboardCurrentConditions
  forecast?: WeatherDashboardForecastDay[]
  updatedAt?: number
  cacheStatus?: Extract<WeatherDashboardCacheStatus, 'miss' | 'hit' | 'refreshed'>
}

export function createWeatherDashboardReadySnapshot(
  input: CreateWeatherDashboardReadySnapshotInput
): WeatherDashboardSnapshot {
  const updatedAt = input.updatedAt ?? Date.now()
  const forecast = (input.forecast ?? []).slice(0, 4)
  const currentLine = `${formatWeatherTemperature(input.current.temperature, input.units)} and ${input.current.conditionLabel}`
  const feelsLikeLine =
    typeof input.current.apparentTemperature === 'number'
      ? `Feels like ${formatWeatherTemperature(input.current.apparentTemperature, input.units)}.`
      : ''
  const windLine =
    typeof input.current.windSpeed === 'number'
      ? `Wind ${formatWeatherWindSpeed(input.current.windSpeed, input.units)}.`
      : ''
  const forecastLine =
    forecast.length > 0
      ? `Next ${forecast.length} days: ${forecast
          .map(
            (day) =>
              `${day.dayLabel} ${formatWeatherTemperature(day.high, input.units)}/${formatWeatherTemperature(day.low, input.units)} ${day.conditionLabel}`
          )
          .join('; ')}.`
      : 'Short forecast is not available yet.'

  const cacheStatus = input.cacheStatus ?? 'miss'

  return WeatherDashboardSnapshotSchema.parse({
    schemaVersion: WEATHER_DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    appId: WEATHER_DASHBOARD_APP_ID,
    request: input.request?.trim() || undefined,
    locationQuery: input.locationQuery?.trim() || undefined,
    locationName: input.locationName,
    timezone: input.timezone,
    units: input.units,
    status: 'ready',
    statusText: buildReadyStatusText(cacheStatus),
    summary: `Weather Dashboard is active for ${input.locationName}. Current conditions are ${currentLine}. ${feelsLikeLine} ${windLine} ${forecastLine}`.replace(
      /\s+/g,
      ' '
    ).trim(),
    headline: currentLine,
    dataStateLabel: buildReadyDataStateLabel(cacheStatus),
    lastUpdatedLabel: `Updated ${formatWeatherUpdatedAt(updatedAt, input.timezone)}`,
    sourceLabel: 'Host weather boundary',
    cacheStatus,
    refreshHint: 'Refresh weather to recheck the host-owned upstream snapshot.',
    updatedAt,
    current: input.current,
    forecast,
  })
}

type CreateWeatherDashboardLoadingSnapshotInput = {
  request?: string
  locationQuery?: string
  units?: WeatherDashboardUnits
  updatedAt?: number
}

export function createWeatherDashboardLoadingSnapshot(
  input: CreateWeatherDashboardLoadingSnapshotInput = {}
): WeatherDashboardSnapshot {
  const updatedAt = input.updatedAt ?? Date.now()
  const locationName = input.locationQuery?.trim() || 'Resolving location'

  return WeatherDashboardSnapshotSchema.parse({
    schemaVersion: WEATHER_DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    appId: WEATHER_DASHBOARD_APP_ID,
    request: input.request?.trim() || undefined,
    locationQuery: input.locationQuery?.trim() || undefined,
    locationName,
    units: input.units ?? resolveWeatherUnits(input.request),
    status: 'loading',
    statusText: 'Loading weather',
    summary: `Weather Dashboard is requesting a host-owned weather snapshot for ${locationName}.`,
    headline: 'Fetching latest conditions',
    dataStateLabel: 'Host fetch in progress',
    lastUpdatedLabel: 'Waiting for upstream data',
    sourceLabel: 'Host weather boundary',
    cacheStatus: 'none',
    refreshHint: 'Weather details will appear here after the host finishes fetching them.',
    updatedAt,
    forecast: [],
  })
}

type CreateWeatherDashboardUnavailableSnapshotInput = {
  request?: string
  locationQuery?: string
  units?: WeatherDashboardUnits
  updatedAt?: number
  reason: Extract<WeatherDashboardDegradedReason, 'missing-location' | 'location-not-found'>
}

export function createWeatherDashboardUnavailableSnapshot(
  input: CreateWeatherDashboardUnavailableSnapshotInput
): WeatherDashboardSnapshot {
  const updatedAt = input.updatedAt ?? Date.now()
  const locationName = input.locationQuery?.trim() || 'Weather Dashboard'
  const degraded =
    input.reason === 'missing-location'
      ? {
          reason: 'missing-location' as const,
          title: 'Location needed',
          message: 'Weather Dashboard needs a clearer city or place before the host can fetch weather safely.',
          retryable: true,
          usingStaleSnapshot: false,
        }
      : {
          reason: 'location-not-found' as const,
          title: 'Location not found',
          message: 'The host could not match that weather request to a real place. Try a clearer city, region, or country.',
          retryable: true,
          usingStaleSnapshot: false,
        }

  return WeatherDashboardSnapshotSchema.parse({
    schemaVersion: WEATHER_DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    appId: WEATHER_DASHBOARD_APP_ID,
    request: input.request?.trim() || undefined,
    locationQuery: input.locationQuery?.trim() || undefined,
    locationName,
    units: input.units ?? resolveWeatherUnits(input.request),
    status: 'unavailable',
    statusText: degraded.title,
    summary: `${WEATHER_DASHBOARD_APP_NAME} is waiting for a usable location before the host can fetch weather data.`,
    headline: degraded.title,
    dataStateLabel: 'Awaiting valid location',
    lastUpdatedLabel: 'No host snapshot available',
    sourceLabel: 'Host weather boundary',
    cacheStatus: 'none',
    refreshHint: 'Ask for weather in a clearer city or region to retry.',
    updatedAt,
    forecast: [],
    degraded,
  })
}

type CreateWeatherDashboardDegradedSnapshotInput = {
  request?: string
  locationQuery?: string
  locationName: string
  timezone?: string
  units: WeatherDashboardUnits
  degraded: WeatherDashboardDegradedState
  updatedAt?: number
  current?: WeatherDashboardCurrentConditions
  forecast?: WeatherDashboardForecastDay[]
}

export function createWeatherDashboardDegradedSnapshot(
  input: CreateWeatherDashboardDegradedSnapshotInput
): WeatherDashboardSnapshot {
  const updatedAt = input.updatedAt ?? Date.now()
  const forecast = (input.forecast ?? []).slice(0, 4)
  const staleSummary =
    input.degraded.usingStaleSnapshot && input.current
      ? `The host kept the last good snapshot for ${input.locationName}: ${formatWeatherTemperature(input.current.temperature, input.units)} and ${input.current.conditionLabel}.`
      : `The host could not load fresh weather for ${input.locationName}.`

  return WeatherDashboardSnapshotSchema.parse({
    schemaVersion: WEATHER_DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    appId: WEATHER_DASHBOARD_APP_ID,
    request: input.request?.trim() || undefined,
    locationQuery: input.locationQuery?.trim() || undefined,
    locationName: input.locationName,
    timezone: input.timezone,
    units: input.units,
    status: 'degraded',
    statusText: input.degraded.usingStaleSnapshot ? 'Showing cached snapshot' : input.degraded.title,
    summary: `${staleSummary} ${input.degraded.message}`.replace(/\s+/g, ' ').trim(),
    headline: input.degraded.usingStaleSnapshot ? 'Fresh weather unavailable' : input.degraded.title,
    dataStateLabel: input.degraded.usingStaleSnapshot ? 'Using last good host snapshot' : 'Upstream weather unavailable',
    lastUpdatedLabel: input.degraded.usingStaleSnapshot
      ? `Last good snapshot from ${formatWeatherUpdatedAt(updatedAt, input.timezone)}`
      : 'No fresh host snapshot available',
    sourceLabel: 'Host weather boundary',
    cacheStatus: input.degraded.usingStaleSnapshot ? 'stale-fallback' : 'none',
    refreshHint: input.degraded.retryable
      ? 'Refresh weather to ask the host for a new upstream snapshot.'
      : 'Adjust the request and try again.',
    updatedAt,
    current: input.current,
    forecast,
    degraded: input.degraded,
  })
}
