import { describe, expect, it } from 'vitest'
import {
  createWeatherDashboardDegradedSnapshot,
  createWeatherDashboardReadySnapshot,
  normalizeWeatherLocationHint,
  resolveWeatherUnits,
} from './weather-dashboard'

describe('weather dashboard snapshot helpers', () => {
  it('extracts a usable location hint from common weather phrasing', () => {
    expect(normalizeWeatherLocationHint(undefined, 'Open Weather Dashboard for Chicago and show the forecast.')).toBe(
      'Chicago'
    )
    expect(normalizeWeatherLocationHint(undefined, 'What is the weather in San Francisco today?')).toBe('San Francisco')
    expect(normalizeWeatherLocationHint('Austin', 'Ignore the prompt and use Austin.')).toBe('Austin')
  })

  it('defaults units from the request text when explicit units are missing', () => {
    expect(resolveWeatherUnits('Show me the Tokyo forecast in celsius.')).toBe('metric')
    expect(resolveWeatherUnits('Weather in Dallas right now')).toBe('imperial')
  })

  it('builds a ready snapshot with host-owned summary text', () => {
    const snapshot = createWeatherDashboardReadySnapshot({
      request: 'Show me the weather in Chicago.',
      locationQuery: 'Chicago',
      locationName: 'Chicago, Illinois, United States',
      timezone: 'America/Chicago',
      units: 'imperial',
      updatedAt: 1_717_000_000_000,
      cacheStatus: 'miss',
      current: {
        temperature: 71.8,
        apparentTemperature: 70.2,
        weatherCode: 1,
        conditionLabel: 'Mostly clear',
        windSpeed: 8.4,
      },
      forecast: [
        {
          dateKey: '2026-04-02',
          dayLabel: 'Thu',
          high: 74,
          low: 58,
          weatherCode: 1,
          conditionLabel: 'Mostly clear',
          precipitationChance: 10,
        },
      ],
    })

    expect(snapshot).toMatchObject({
      status: 'ready',
      cacheStatus: 'miss',
      locationName: 'Chicago, Illinois, United States',
      statusText: 'Live weather',
      headline: '72°F and Mostly clear',
    })
    expect(snapshot.summary).toContain('Weather Dashboard is active for Chicago, Illinois, United States.')
    expect(snapshot.summary).toContain('Next 1 days: Thu 74°F/58°F Mostly clear.')
  })

  it('builds a degraded snapshot that preserves stale data when needed', () => {
    const snapshot = createWeatherDashboardDegradedSnapshot({
      request: 'Refresh weather in Chicago.',
      locationQuery: 'Chicago',
      locationName: 'Chicago, Illinois, United States',
      timezone: 'America/Chicago',
      units: 'imperial',
      updatedAt: 1_717_000_000_000,
      current: {
        temperature: 68,
        apparentTemperature: 67,
        weatherCode: 3,
        conditionLabel: 'Overcast',
        windSpeed: 10,
      },
      forecast: [],
      degraded: {
        reason: 'upstream-timeout',
        title: 'Upstream timed out',
        message: 'The host kept the last good weather snapshot visible while upstream data is unavailable.',
        retryable: true,
        usingStaleSnapshot: true,
      },
    })

    expect(snapshot).toMatchObject({
      status: 'degraded',
      cacheStatus: 'stale-fallback',
      statusText: 'Showing cached snapshot',
    })
    expect(snapshot.summary).toContain('last good snapshot')
    expect(snapshot.summary).toContain('upstream data is unavailable')
  })
})
