import { describe, expect, it, vi } from 'vitest'
import { createChatBridgeWeatherService } from './index'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

describe('chatbridge weather service', () => {
  it('normalizes a weather request into a ready dashboard snapshot', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://geocoding-api.open-meteo.com')) {
        return jsonResponse({
          results: [
            {
              name: 'Chicago',
              latitude: 41.8756,
              longitude: -87.6244,
              timezone: 'America/Chicago',
              country: 'United States',
              admin1: 'Illinois',
            },
          ],
        })
      }

      return jsonResponse({
        timezone: 'America/Chicago',
        current: {
          temperature_2m: 72.2,
          apparent_temperature: 70.6,
          weather_code: 1,
          wind_speed_10m: 9.1,
        },
        daily: {
          time: ['2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05'],
          weather_code: [1, 2, 3, 61],
          temperature_2m_max: [74, 76, 71, 66],
          temperature_2m_min: [58, 60, 54, 51],
          precipitation_probability_max: [10, 20, 30, 55],
        },
      })
    })

    const service = createChatBridgeWeatherService({
      fetch: fetchMock as typeof fetch,
      now: () => 1_717_000_000_000,
    })

    const result = await service.fetchDashboard({
      request: 'Open Weather Dashboard for Chicago and show the forecast.',
    })

    expect(result.snapshot).toMatchObject({
      status: 'ready',
      locationName: 'Chicago, Illinois, United States',
      cacheStatus: 'miss',
      current: {
        conditionLabel: 'Mostly clear',
      },
    })
    expect(result.snapshot.summary).toContain('Chicago, Illinois, United States')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns a cache hit on repeated requests without refresh', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://geocoding-api.open-meteo.com')) {
        return jsonResponse({
          results: [
            {
              name: 'Chicago',
              latitude: 41.8756,
              longitude: -87.6244,
              timezone: 'America/Chicago',
              country: 'United States',
              admin1: 'Illinois',
            },
          ],
        })
      }

      return jsonResponse({
        timezone: 'America/Chicago',
        current: {
          temperature_2m: 72.2,
          apparent_temperature: 70.6,
          weather_code: 1,
          wind_speed_10m: 9.1,
        },
        daily: {
          time: ['2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05'],
          weather_code: [1, 2, 3, 61],
          temperature_2m_max: [74, 76, 71, 66],
          temperature_2m_min: [58, 60, 54, 51],
          precipitation_probability_max: [10, 20, 30, 55],
        },
      })
    })

    const service = createChatBridgeWeatherService({
      fetch: fetchMock as typeof fetch,
      now: () => 1_717_000_000_000,
      cacheTtlMs: 60_000,
    })

    await service.fetchDashboard({
      request: 'Show me weather in Chicago.',
    })
    const cached = await service.fetchDashboard({
      request: 'Show me weather in Chicago.',
    })

    expect(cached.snapshot.cacheStatus).toBe('hit')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the last good snapshot when refresh fails upstream', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        jsonResponse({
          results: [
            {
              name: 'Chicago',
              latitude: 41.8756,
              longitude: -87.6244,
              timezone: 'America/Chicago',
              country: 'United States',
              admin1: 'Illinois',
            },
          ],
        })
      )
      .mockImplementationOnce(async () =>
        jsonResponse({
          timezone: 'America/Chicago',
          current: {
            temperature_2m: 68,
            apparent_temperature: 66,
            weather_code: 3,
            wind_speed_10m: 12,
          },
          daily: {
            time: ['2026-04-02'],
            weather_code: [3],
            temperature_2m_max: [69],
            temperature_2m_min: [55],
            precipitation_probability_max: [40],
          },
        })
      )
      .mockImplementationOnce(async () =>
        jsonResponse({
          results: [
            {
              name: 'Chicago',
              latitude: 41.8756,
              longitude: -87.6244,
              timezone: 'America/Chicago',
              country: 'United States',
              admin1: 'Illinois',
            },
          ],
        })
      )
      .mockImplementationOnce(async () => {
        throw new Error('socket hung up')
      })

    const service = createChatBridgeWeatherService({
      fetch: fetchMock as typeof fetch,
      now: () => 1_717_000_000_000,
      cacheTtlMs: 60_000,
    })

    await service.fetchDashboard({
      request: 'Refresh weather in Chicago.',
    })
    const degraded = await service.fetchDashboard({
      request: 'Refresh weather in Chicago.',
      refresh: true,
    })

    expect(degraded.snapshot).toMatchObject({
      status: 'degraded',
      cacheStatus: 'stale-fallback',
      statusText: 'Showing cached snapshot',
      degraded: {
        usingStaleSnapshot: true,
      },
    })
  })

  it('returns an unavailable snapshot when the request has no usable location', async () => {
    const service = createChatBridgeWeatherService({
      fetch: vi.fn() as typeof fetch,
      now: () => 1_717_000_000_000,
    })

    const result = await service.fetchDashboard({
      request: 'Open Weather Dashboard.',
    })

    expect(result.snapshot).toMatchObject({
      status: 'unavailable',
      degraded: {
        reason: 'missing-location',
      },
    })
  })
})
