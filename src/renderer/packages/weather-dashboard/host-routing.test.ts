import { createMessage, type Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  getLatestWeatherDashboardHostState,
  WEATHER_DASHBOARD_HOST_FLOW,
} from '@shared/weather-dashboard/intent'
import { interceptWeatherDashboardTurn } from './host-routing'

function makeUserMessage(text: string): Message {
  return createMessage('user', text)
}

describe('interceptWeatherDashboardTurn', () => {
  it('returns null for non-weather prompts', () => {
    const result = interceptWeatherDashboardTurn([], makeUserMessage('Tell me a joke about pigeons.'))

    expect(result).toBeNull()
  })

  it('asks for a location when the prompt does not include one', () => {
    const result = interceptWeatherDashboardTurn([], makeUserMessage("What's the weather like today?"))

    expect(result?.role).toBe('assistant')
    const state = getLatestWeatherDashboardHostState([result!])
    expect(state).toMatchObject({
      hostFlow: WEATHER_DASHBOARD_HOST_FLOW,
      status: 'awaiting-location',
      reason: 'missing-location',
      originalRequest: "What's the weather like today?",
    })
    expect(result?.contentParts[0]).toMatchObject({
      type: 'info',
    })
  })

  it('asks for a more specific location when the city is ambiguous', () => {
    const result = interceptWeatherDashboardTurn([], makeUserMessage('weather in Springfield'))

    const state = getLatestWeatherDashboardHostState([result!])
    expect(state).toMatchObject({
      status: 'awaiting-location',
      reason: 'ambiguous-location',
      locationQuery: 'Springfield',
    })
    expect(result?.contentParts[0]).toMatchObject({
      type: 'info',
      text: expect.stringContaining('multiple possible matches'),
    })
  })

  it('marks the route ready when the prompt includes a specific location', () => {
    const result = interceptWeatherDashboardTurn([], makeUserMessage('Will it rain tonight in Chicago, IL?'))

    const state = getLatestWeatherDashboardHostState([result!])
    expect(state).toMatchObject({
      status: 'route-ready',
      locationQuery: 'Chicago, IL',
      originalRequest: 'Will it rain tonight in Chicago, IL?',
    })
    expect(result?.contentParts[0]).toMatchObject({
      type: 'info',
      text: 'Weather Dashboard route ready for Chicago, IL.',
    })
  })

  it('continues a pending clarification when the user replies with a location', () => {
    const clarification = interceptWeatherDashboardTurn([], makeUserMessage('weather'))!

    const result = interceptWeatherDashboardTurn([clarification], makeUserMessage('Portland, OR'))

    const state = getLatestWeatherDashboardHostState([result!])
    expect(state).toMatchObject({
      status: 'route-ready',
      locationQuery: 'Portland, OR',
      originalRequest: 'weather',
    })
  })
})
