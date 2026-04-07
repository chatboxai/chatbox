import { useEffect, useRef, useState } from 'react'

interface ForecastDay {
  day: string
  high: number
  low: number
  description: string
  icon: string
}

interface WeatherData {
  location: string
  temperature: number
  feelsLike: number
  humidity: number
  description: string
  icon: string
  wind: { speed: number; direction: number }
  forecast: ForecastDay[]
  mock: boolean
}

type AppState = 'idle' | 'loading' | 'ready' | 'error'

const TOOL_SCHEMAS = [
  {
    name: 'get_current_weather',
    description:
      'Get the current weather conditions for a location. Returns temperature, humidity, wind speed, and description.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name, e.g. "Tokyo", "New York", "London"',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'get_forecast',
    description: 'Get a multi-day weather forecast for a location.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
        days: { type: 'number', description: 'Number of forecast days (default 4)' },
      },
      required: ['location'],
    },
  },
]

function getWeatherEmoji(icon: string): string {
  if (icon.startsWith('01')) return '☀️'
  if (icon.startsWith('02')) return '⛅'
  if (icon.startsWith('03') || icon.startsWith('04')) return '☁️'
  if (icon.startsWith('09') || icon.startsWith('10')) return '🌧️'
  if (icon.startsWith('11')) return '⛈️'
  if (icon.startsWith('13')) return '❄️'
  if (icon.startsWith('50')) return '🌫️'
  return '🌤️'
}

function getWindDirection(degrees: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(degrees / 45) % 8] ?? 'N'
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')

  // Keep a ref to the latest weather so message handlers always see current value
  const weatherRef = useRef<WeatherData | null>(null)
  weatherRef.current = weather

  useEffect(() => {
    // Send ready signal
    window.parent.postMessage({ type: 'ready' }, '*')

    // Register tools with the platform
    window.parent.postMessage(
      { type: 'register_tools', schemas: TOOL_SCHEMAS },
      '*',
    )
  }, [])

  useEffect(() => {
    async function handleMessage(event: MessageEvent) {
      // Validate message structure
      if (!event.data || typeof event.data.type !== 'string') return
      if (event.data.type !== 'tool_invoke') return

      const { toolCallId, toolName, params } = event.data as {
        toolCallId: string
        toolName: string
        params: { location?: string; days?: number }
      }

      if (toolName !== 'get_current_weather' && toolName !== 'get_forecast') return
      if (!params.location) {
        window.parent.postMessage(
          {
            type: 'tool_result',
            toolCallId,
            result: { error: 'location parameter is required' },
          },
          '*',
        )
        return
      }

      setAppState('loading')
      setErrorMsg('')

      try {
        const res = await fetch(
          `/api/internal/weather?location=${encodeURIComponent(params.location)}`,
        )

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }

        const data = (await res.json()) as WeatherData
        setWeather(data)
        setAppState('ready')

        // Send state_update so the platform can inject context into the LLM
        window.parent.postMessage(
          {
            type: 'state_update',
            state: {
              location: data.location,
              temperature: data.temperature,
              description: data.description,
              humidity: data.humidity,
              windSpeed: data.wind.speed,
              mock: data.mock,
            },
          },
          '*',
        )

        // Respond to the tool call
        if (toolName === 'get_current_weather') {
          window.parent.postMessage(
            {
              type: 'tool_result',
              toolCallId,
              result: {
                location: data.location,
                temperature: data.temperature,
                feelsLike: data.feelsLike,
                humidity: data.humidity,
                description: data.description,
                wind: data.wind,
                mock: data.mock,
              },
            },
            '*',
          )
        } else {
          // get_forecast
          window.parent.postMessage(
            {
              type: 'tool_result',
              toolCallId,
              result: {
                location: data.location,
                forecast: data.forecast,
                mock: data.mock,
              },
            },
            '*',
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch weather'
        console.error('[Weather] fetch error:', err)
        setErrorMsg(msg)
        setAppState('error')
        window.parent.postMessage(
          {
            type: 'tool_result',
            toolCallId,
            result: { error: msg },
          },
          '*',
        )
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px',
        gap: '12px',
        minHeight: '100vh',
        background: '#1a1a2e',
        color: '#e0e0e0',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color: '#a0c4ff',
          letterSpacing: '0.5px',
        }}
      >
        Weather Dashboard
      </div>

      {appState === 'idle' && (
        <div
          style={{
            marginTop: '40px',
            color: '#666',
            fontSize: '14px',
            textAlign: 'center',
          }}
        >
          Waiting for weather request...
        </div>
      )}

      {appState === 'loading' && (
        <div
          style={{
            marginTop: '40px',
            color: '#a0c4ff',
            fontSize: '14px',
            textAlign: 'center',
          }}
        >
          Fetching weather data...
        </div>
      )}

      {appState === 'error' && (
        <div
          style={{
            marginTop: '40px',
            color: '#ff6b6b',
            fontSize: '14px',
            textAlign: 'center',
            padding: '12px 16px',
            background: '#1e1030',
            borderRadius: '8px',
            border: '1px solid #ff6b6b44',
          }}
        >
          {errorMsg}
        </div>
      )}

      {appState === 'ready' && weather && (
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {/* Current weather card */}
          <div
            style={{
              background: '#16213e',
              borderRadius: '12px',
              border: '1px solid #0f3460',
              padding: '20px',
            }}
          >
            <div
              style={{
                fontSize: '14px',
                color: '#888',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
              }}
            >
              {weather.location}
              {weather.mock && (
                <span
                  style={{
                    marginLeft: '8px',
                    fontSize: '11px',
                    color: '#ffa94d',
                    background: '#3d2b00',
                    padding: '1px 6px',
                    borderRadius: '4px',
                  }}
                >
                  mock
                </span>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <span style={{ fontSize: '48px' }}>{getWeatherEmoji(weather.icon)}</span>
              <div>
                <div style={{ fontSize: '42px', fontWeight: 700, lineHeight: 1 }}>
                  {weather.temperature}°C
                </div>
                <div style={{ fontSize: '13px', color: '#aaa', marginTop: '4px' }}>
                  Feels like {weather.feelsLike}°C
                </div>
              </div>
            </div>

            <div
              style={{
                fontSize: '15px',
                color: '#c0c0c0',
                textTransform: 'capitalize',
                marginBottom: '12px',
              }}
            >
              {weather.description}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '16px',
                fontSize: '13px',
                color: '#888',
              }}
            >
              <span>💧 {weather.humidity}%</span>
              <span>
                💨 {weather.wind.speed} m/s {getWindDirection(weather.wind.direction)}
              </span>
            </div>
          </div>

          {/* Forecast */}
          {weather.forecast.length > 0 && (
            <div
              style={{
                background: '#16213e',
                borderRadius: '12px',
                border: '1px solid #0f3460',
                padding: '14px 16px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: '#666',
                  marginBottom: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                }}
              >
                Forecast
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {weather.forecast.map((day, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: '#aaa', width: '50px' }}>{day.day}</span>
                    <span style={{ fontSize: '18px' }}>{getWeatherEmoji(day.icon)}</span>
                    <span style={{ color: '#888', flex: 1, textAlign: 'center', fontSize: '12px' }}>
                      {day.description}
                    </span>
                    <span style={{ color: '#e0e0e0', minWidth: '60px', textAlign: 'right' }}>
                      {day.high}° / {day.low}°
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
