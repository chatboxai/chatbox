import { Router } from 'express'

const router = Router()

interface ForecastItem {
  dt: number
  main: { temp_max: number; temp_min: number }
  weather: Array<{ description: string; icon: string }>
}

interface OWMCurrentResponse {
  name: string
  main: { temp: number; feels_like: number; humidity: number }
  weather: Array<{ description: string; icon: string }>
  wind: { speed: number; deg: number }
}

interface OWMForecastResponse {
  list: ForecastItem[]
}

// GET /api/internal/weather?location=Tokyo
// Proxies to OpenWeatherMap with server-side API key.
// Returns weather data to the iframe without exposing the key.
// No auth required — this is an internal proxy, not a user-facing endpoint.
router.get('/weather', async (req, res) => {
  const location = req.query.location as string | undefined
  if (!location) {
    res.status(400).json({ error: 'location query parameter required' })
    return
  }

  const apiKey = process.env.WEATHER_API_KEY

  // If no API key, return mock data so the demo still works
  if (!apiKey) {
    res.json({
      location,
      temperature: 22,
      feelsLike: 20,
      humidity: 65,
      description: 'partly cloudy (mock — no WEATHER_API_KEY configured)',
      icon: '02d',
      wind: { speed: 3.5, direction: 180 },
      forecast: [
        { day: 'Tomorrow', high: 24, low: 18, description: 'sunny', icon: '01d' },
        { day: 'Day 3', high: 21, low: 16, description: 'light rain', icon: '10d' },
        { day: 'Day 4', high: 23, low: 17, description: 'cloudy', icon: '03d' },
        { day: 'Day 5', high: 25, low: 19, description: 'clear sky', icon: '01d' },
      ],
      mock: true,
    })
    return
  }

  try {
    const [currentRes, forecastRes] = await Promise.all([
      fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=metric&appid=${apiKey}`,
      ),
      fetch(
        `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(location)}&units=metric&cnt=4&appid=${apiKey}`,
      ),
    ])

    if (!currentRes.ok) {
      if (currentRes.status === 401 || currentRes.status === 403) {
        // Invalid/expired API key — fall through to mock data
        console.warn('[Weather] API key rejected (status %d), returning mock data', currentRes.status)
        res.json({
          location,
          temperature: 22,
          feelsLike: 20,
          humidity: 65,
          description: 'partly cloudy (mock — WEATHER_API_KEY invalid)',
          icon: '02d',
          wind: { speed: 3.5, direction: 180 },
          forecast: [
            { day: 'Tomorrow', high: 24, low: 18, description: 'sunny', icon: '01d' },
            { day: 'Day 3', high: 21, low: 16, description: 'light rain', icon: '10d' },
            { day: 'Day 4', high: 23, low: 17, description: 'cloudy', icon: '03d' },
            { day: 'Day 5', high: 25, low: 19, description: 'clear sky', icon: '01d' },
          ],
          mock: true,
        })
        return
      }
      res.status(currentRes.status).json({ error: `Weather API error: ${currentRes.statusText}` })
      return
    }

    const current = (await currentRes.json()) as OWMCurrentResponse
    const forecastData = forecastRes.ok ? ((await forecastRes.json()) as OWMForecastResponse) : null

    res.json({
      location: current.name,
      temperature: Math.round(current.main.temp),
      feelsLike: Math.round(current.main.feels_like),
      humidity: current.main.humidity,
      description: current.weather[0]?.description ?? 'unknown',
      icon: current.weather[0]?.icon ?? '01d',
      wind: { speed: current.wind?.speed, direction: current.wind?.deg },
      forecast:
        forecastData?.list?.map((item) => ({
          day: new Date(item.dt * 1000).toLocaleDateString('en-US', { weekday: 'short' }),
          high: Math.round(item.main.temp_max),
          low: Math.round(item.main.temp_min),
          description: item.weather[0]?.description ?? 'unknown',
          icon: item.weather[0]?.icon ?? '01d',
        })) ?? [],
      mock: false,
    })
  } catch (err) {
    console.error('[Weather] API error:', err)
    res.status(500).json({ error: 'Failed to fetch weather data' })
  }
})

export default router
