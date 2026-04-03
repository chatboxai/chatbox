import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  ChatBridgeWeatherDashboardQuerySchema,
  ChatBridgeWeatherDashboardResultSchema,
  createWeatherDashboardDegradedSnapshot,
  createWeatherDashboardReadySnapshot,
  createWeatherDashboardUnavailableSnapshot,
  getWeatherConditionLabel,
  normalizeWeatherLocationHint,
  resolveWeatherUnits,
  type ChatBridgeWeatherDashboardQuery,
  type ChatBridgeWeatherDashboardResult,
  type WeatherDashboardCurrentConditions,
  type WeatherDashboardForecastDay,
  type WeatherDashboardSnapshot,
} from '../../../shared/chatbridge/apps/weather-dashboard'
import { createNoopLangSmithAdapter, type LangSmithAdapter } from '../../../shared/utils/langsmith_adapter'
import { langsmith } from '../../adapters/langsmith'

type FetchLike = typeof fetch

type CreateChatBridgeWeatherServiceOptions = {
  fetch?: FetchLike
  now?: () => number
  cacheTtlMs?: number
  traceAdapter?: LangSmithAdapter
}

type CachedWeatherSnapshot = {
  snapshot: WeatherDashboardSnapshot
  expiresAt: number
}

type OpenMeteoGeocodeResult = {
  latitude: number
  longitude: number
  timezone: string
  name: string
  country?: string
  admin1?: string
}

const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 6_000

const OpenMeteoGeocodeResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            latitude: z.number(),
            longitude: z.number(),
            timezone: z.string().trim().min(1),
            name: z.string().trim().min(1),
            country: z.string().trim().min(1).optional(),
            admin1: z.string().trim().min(1).optional(),
          })
          .strict()
      )
      .optional(),
  })
  .strict()

const OpenMeteoForecastResponseSchema = z
  .object({
    timezone: z.string().trim().min(1),
    current: z
      .object({
        temperature_2m: z.number(),
        apparent_temperature: z.number().optional(),
        weather_code: z.number().int().nonnegative(),
        wind_speed_10m: z.number().nonnegative().optional(),
      })
      .strict(),
    daily: z
      .object({
        time: z.array(z.string().trim().min(1)).min(1),
        weather_code: z.array(z.number().int().nonnegative()).min(1),
        temperature_2m_max: z.array(z.number()).min(1),
        temperature_2m_min: z.array(z.number()).min(1),
        precipitation_probability_max: z.array(z.number().min(0).max(100)).optional(),
      })
      .strict(),
  })
  .strict()

class WeatherGatewayError extends Error {
  public readonly code: 'upstream-timeout' | 'upstream-error' | 'invalid-response'

  constructor(code: 'upstream-timeout' | 'upstream-error' | 'invalid-response', message: string) {
    super(message)
    this.code = code
  }
}

function createCacheKey(location: string, units: ReturnType<typeof resolveWeatherUnits>) {
  return `${units}:${location.trim().toLowerCase()}`
}

function composeLocationName(location: OpenMeteoGeocodeResult) {
  return [location.name, location.admin1, location.country].filter(Boolean).join(', ')
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeoutId),
  }
}

async function fetchJson(fetchImpl: FetchLike, url: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { signal, dispose } = createTimeoutSignal(timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal,
    })

    if (!response.ok) {
      const details = await response.text().catch(() => '')
      throw new WeatherGatewayError(
        'upstream-error',
        `Weather provider returned ${response.status}${details ? `: ${details}` : ''}`
      )
    }

    return await response.json()
  } catch (error) {
    if (error instanceof WeatherGatewayError) {
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new WeatherGatewayError('upstream-timeout', 'Weather provider timed out before the host received a response.')
    }

    throw new WeatherGatewayError(
      'upstream-error',
      error instanceof Error ? error.message : 'Weather provider request failed.'
    )
  } finally {
    dispose()
  }
}

function normalizeGeocodeResult(payload: unknown) {
  const parsed = OpenMeteoGeocodeResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new WeatherGatewayError('invalid-response', 'Weather location lookup returned an invalid response shape.')
  }

  return parsed.data.results?.[0]
}

function normalizeForecastSnapshot(
  payload: unknown,
  options: { units: ReturnType<typeof resolveWeatherUnits>; timezone: string }
): { current: WeatherDashboardCurrentConditions; forecast: WeatherDashboardForecastDay[] } {
  const parsed = OpenMeteoForecastResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new WeatherGatewayError('invalid-response', 'Weather forecast response failed schema validation.')
  }

  const forecast = parsed.data
  const current: WeatherDashboardCurrentConditions = {
    temperature: forecast.current.temperature_2m,
    apparentTemperature: forecast.current.apparent_temperature,
    weatherCode: forecast.current.weather_code,
    conditionLabel: getWeatherConditionLabel(forecast.current.weather_code),
    windSpeed: forecast.current.wind_speed_10m,
  }

  const forecastLength = Math.min(
    4,
    forecast.daily.time.length,
    forecast.daily.weather_code.length,
    forecast.daily.temperature_2m_max.length,
    forecast.daily.temperature_2m_min.length
  )

  if (forecastLength === 0) {
    throw new WeatherGatewayError('invalid-response', 'Weather forecast response did not include any daily forecast rows.')
  }

  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: options.timezone || undefined,
  })

  const dailyForecast: WeatherDashboardForecastDay[] = Array.from({ length: forecastLength }, (_, index) => {
    const dateKey = forecast.daily.time[index]!
    const parsedDate = new Date(`${dateKey}T12:00:00Z`)
    const dayLabel = Number.isNaN(parsedDate.valueOf()) ? dateKey : dayFormatter.format(parsedDate)

    return {
      dateKey,
      dayLabel,
      high: forecast.daily.temperature_2m_max[index]!,
      low: forecast.daily.temperature_2m_min[index]!,
      weatherCode: forecast.daily.weather_code[index]!,
      conditionLabel: getWeatherConditionLabel(forecast.daily.weather_code[index]!),
      precipitationChance: forecast.daily.precipitation_probability_max?.[index],
    }
  })

  return {
    current,
    forecast: dailyForecast,
  }
}

export function createChatBridgeWeatherService(options: CreateChatBridgeWeatherServiceOptions = {}) {
  const now = () => options.now?.() ?? Date.now()
  const fetchImpl = options.fetch ?? fetch
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const traceAdapter = options.traceAdapter ?? createNoopLangSmithAdapter()
  const cache = new Map<string, CachedWeatherSnapshot>()

  async function trace(
    name: string,
    input: {
      parentRunId?: string
      inputs?: Record<string, unknown>
      outputs?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
  ) {
    await traceAdapter.recordEvent({
      name,
      runType: 'tool',
      parentRunId: input.parentRunId,
      inputs: input.inputs,
      outputs: input.outputs,
      metadata: {
        storyId: 'CB-510',
        operation: 'weather-dashboard-fetch',
        ...input.metadata,
      },
      tags: ['chatbridge', 'weather-dashboard', 'cb-510'],
    })
  }

  function readCachedReadySnapshot(cacheKey: string) {
    const cached = cache.get(cacheKey)
    if (!cached) {
      return null
    }

    if (cached.expiresAt <= now()) {
      return cached.snapshot
    }

    return cached.snapshot
  }

  function buildCacheHitSnapshot(snapshot: WeatherDashboardSnapshot) {
    if (!snapshot.current) {
      return snapshot
    }

    return createWeatherDashboardReadySnapshot({
      request: snapshot.request,
      locationQuery: snapshot.locationQuery,
      locationName: snapshot.locationName,
      timezone: snapshot.timezone,
      units: snapshot.units,
      current: snapshot.current,
      forecast: snapshot.forecast,
      updatedAt: snapshot.updatedAt,
      cacheStatus: 'hit',
    })
  }

  async function fetchDashboard(queryInput: unknown): Promise<ChatBridgeWeatherDashboardResult> {
    const query = ChatBridgeWeatherDashboardQuerySchema.parse(queryInput)
    const units = resolveWeatherUnits(query.request, query.units)
    const locationHint = normalizeWeatherLocationHint(query.location, query.request)

    if (!locationHint) {
      const snapshot = createWeatherDashboardUnavailableSnapshot({
        request: query.request,
        locationQuery: query.location,
        units,
        updatedAt: now(),
        reason: 'missing-location',
      })
      await trace('chatbridge.weather.fetch.location_missing', {
        parentRunId: query.traceParentRunId,
        inputs: {
          request: query.request ?? null,
          location: query.location ?? null,
        },
        outputs: {
          status: snapshot.status,
        },
      })
      return ChatBridgeWeatherDashboardResultSchema.parse({ snapshot })
    }

    const cacheKey = createCacheKey(locationHint, units)
    const cachedSnapshot = readCachedReadySnapshot(cacheKey)
    const cachedEntry = cache.get(cacheKey)

    if (!query.refresh && cachedEntry && cachedEntry.expiresAt > now()) {
      const snapshot = buildCacheHitSnapshot(cachedEntry.snapshot)
      await trace('chatbridge.weather.fetch.cache_hit', {
        parentRunId: query.traceParentRunId,
        inputs: {
          location: locationHint,
          units,
        },
        outputs: {
          cacheStatus: snapshot.cacheStatus,
          locationName: snapshot.locationName,
        },
      })
      return ChatBridgeWeatherDashboardResultSchema.parse({ snapshot })
    }

    try {
      const geocodeSearch = new URL(OPEN_METEO_GEOCODE_URL)
      geocodeSearch.searchParams.set('name', locationHint)
      geocodeSearch.searchParams.set('count', '1')
      geocodeSearch.searchParams.set('format', 'json')
      geocodeSearch.searchParams.set('language', 'en')

      await trace('chatbridge.weather.fetch.started', {
        parentRunId: query.traceParentRunId,
        inputs: {
          location: locationHint,
          units,
          refresh: query.refresh,
        },
      })

      const geocodePayload = await fetchJson(fetchImpl, geocodeSearch.toString())
      const resolvedLocation = normalizeGeocodeResult(geocodePayload)

      if (!resolvedLocation) {
        const snapshot = createWeatherDashboardUnavailableSnapshot({
          request: query.request,
          locationQuery: locationHint,
          units,
          updatedAt: now(),
          reason: 'location-not-found',
        })
        await trace('chatbridge.weather.fetch.location_not_found', {
          parentRunId: query.traceParentRunId,
          outputs: {
            status: snapshot.status,
            location: locationHint,
          },
        })
        return ChatBridgeWeatherDashboardResultSchema.parse({ snapshot })
      }

      const forecastSearch = new URL(OPEN_METEO_FORECAST_URL)
      forecastSearch.searchParams.set('latitude', String(resolvedLocation.latitude))
      forecastSearch.searchParams.set('longitude', String(resolvedLocation.longitude))
      forecastSearch.searchParams.set('timezone', resolvedLocation.timezone)
      forecastSearch.searchParams.set('forecast_days', '4')
      forecastSearch.searchParams.set(
        'current',
        ['temperature_2m', 'apparent_temperature', 'weather_code', 'wind_speed_10m'].join(',')
      )
      forecastSearch.searchParams.set(
        'daily',
        ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max'].join(',')
      )
      forecastSearch.searchParams.set('temperature_unit', units === 'imperial' ? 'fahrenheit' : 'celsius')
      forecastSearch.searchParams.set('wind_speed_unit', units === 'imperial' ? 'mph' : 'kmh')

      const forecastPayload = await fetchJson(fetchImpl, forecastSearch.toString())
      const normalizedWeather = normalizeForecastSnapshot(forecastPayload, {
        units,
        timezone: resolvedLocation.timezone,
      })

      const snapshot = createWeatherDashboardReadySnapshot({
        request: query.request,
        locationQuery: locationHint,
        locationName: composeLocationName(resolvedLocation),
        timezone: resolvedLocation.timezone,
        units,
        current: normalizedWeather.current,
        forecast: normalizedWeather.forecast,
        updatedAt: now(),
        cacheStatus: query.refresh ? 'refreshed' : 'miss',
      })

      cache.set(cacheKey, {
        snapshot,
        expiresAt: now() + cacheTtlMs,
      })

      await trace('chatbridge.weather.fetch.succeeded', {
        parentRunId: query.traceParentRunId,
        outputs: {
          locationName: snapshot.locationName,
          cacheStatus: snapshot.cacheStatus,
          forecastDays: snapshot.forecast.length,
          status: snapshot.status,
        },
      })

      return ChatBridgeWeatherDashboardResultSchema.parse({ snapshot })
    } catch (error) {
      const normalizedError =
        error instanceof WeatherGatewayError
          ? error
          : new WeatherGatewayError(
              'upstream-error',
              error instanceof Error ? error.message : 'Weather provider request failed.'
            )

      const staleSnapshot =
        cachedSnapshot && cachedSnapshot.current
          ? createWeatherDashboardDegradedSnapshot({
              request: query.request,
              locationQuery: locationHint,
              locationName: cachedSnapshot.locationName,
              timezone: cachedSnapshot.timezone,
              units,
              current: cachedSnapshot.current,
              forecast: cachedSnapshot.forecast,
              updatedAt: cachedSnapshot.updatedAt,
              degraded: {
                reason: normalizedError.code,
                title: normalizedError.code === 'upstream-timeout' ? 'Upstream timed out' : 'Fresh weather unavailable',
                message: 'The host kept the last good weather snapshot visible while upstream data is unavailable.',
                retryable: true,
                usingStaleSnapshot: true,
              },
            })
          : null

      const snapshot =
        staleSnapshot ??
        createWeatherDashboardDegradedSnapshot({
          request: query.request,
          locationQuery: locationHint,
          locationName: locationHint,
          units,
          updatedAt: now(),
          degraded: {
            reason: normalizedError.code,
            title:
              normalizedError.code === 'upstream-timeout'
                ? 'Upstream timed out'
                : normalizedError.code === 'invalid-response'
                  ? 'Weather response invalid'
                  : 'Fresh weather unavailable',
            message: normalizedError.message,
            retryable: true,
            usingStaleSnapshot: false,
          },
        })

      await trace('chatbridge.weather.fetch.degraded', {
        parentRunId: query.traceParentRunId,
        outputs: {
          status: snapshot.status,
          reason: snapshot.degraded?.reason ?? normalizedError.code,
          usingStaleSnapshot: snapshot.degraded?.usingStaleSnapshot ?? false,
        },
        metadata: {
          error: normalizedError.message,
        },
      })

      return ChatBridgeWeatherDashboardResultSchema.parse({ snapshot })
    }
  }

  return {
    fetchDashboard,
  }
}

export const chatBridgeWeatherService = createChatBridgeWeatherService({
  traceAdapter: langsmith,
})

export function registerChatBridgeWeatherIpcHandlers(service = chatBridgeWeatherService) {
  ipcMain.handle('chatbridge-weather:get-dashboard', async (_event, query: ChatBridgeWeatherDashboardQuery) => {
    return await service.fetchDashboard(query)
  })
}
