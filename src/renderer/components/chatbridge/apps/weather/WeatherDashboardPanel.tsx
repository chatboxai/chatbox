import { Button, Loader, Text } from '@mantine/core'
import type { WeatherDashboardSnapshot } from '@shared/chatbridge'

interface WeatherDashboardPanelProps {
  snapshot: WeatherDashboardSnapshot
  refreshing: boolean
  onRefresh: () => void
}

function getStatusBadgeClasses(snapshot: WeatherDashboardPanelProps['snapshot']) {
  if (snapshot.status === 'ready') {
    return 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300'
  }

  if (snapshot.status === 'degraded') {
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
  }

  if (snapshot.status === 'unavailable') {
    return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
  }

  return 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200'
}

export function WeatherDashboardPanel({ snapshot, refreshing, onRefresh }: WeatherDashboardPanelProps) {
  const hasCurrentData = Boolean(snapshot.current)
  const showForecast = snapshot.forecast.length > 0

  return (
    <div data-testid="weather-dashboard-panel" className="w-full overflow-hidden rounded-[24px] border border-chatbox-border-primary">
      <div className="bg-chatbox-background-primary p-4">
        <div className="overflow-hidden rounded-[24px] border border-sky-200 bg-[linear-gradient(145deg,rgba(224,242,254,0.95),rgba(255,255,255,0.98))] p-5 dark:border-sky-900/60 dark:bg-[linear-gradient(145deg,rgba(12,74,110,0.38),rgba(15,23,42,0.92))]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Text size="xs" fw={700} className="uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">
                Reviewed flagship app
              </Text>
              <Text size="xl" fw={800} className="mt-1 text-chatbox-primary">
                {snapshot.locationName}
              </Text>
              <Text size="sm" c="dimmed" className="mt-2 max-w-[52ch] whitespace-pre-wrap">
                {snapshot.headline}
              </Text>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${getStatusBadgeClasses(snapshot)}`}
              >
                {snapshot.statusText}
              </span>
              <Button
                variant={snapshot.status === 'degraded' || snapshot.status === 'unavailable' ? 'filled' : 'light'}
                size="compact-sm"
                loading={refreshing}
                onClick={onRefresh}
              >
                Refresh weather
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.9fr)]">
            <section className="rounded-[22px] border border-white/80 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-chatbox-tertiary">
                    Now
                  </Text>
                  {hasCurrentData ? (
                    <>
                      <Text className="mt-2 text-[42px] font-black leading-none text-chatbox-primary">
                        {snapshot.current ? `${Math.round(snapshot.current.temperature)}°` : '--'}
                      </Text>
                      <Text size="sm" c="dimmed" className="mt-2">
                        {snapshot.current?.conditionLabel ?? 'Current conditions unavailable'}
                      </Text>
                    </>
                  ) : (
                    <div className="mt-5 flex items-center gap-3">
                      <Loader size="sm" />
                      <Text size="sm" c="dimmed">
                        {snapshot.status === 'loading'
                          ? 'The host is fetching current conditions.'
                          : 'Current conditions are not available for this request.'}
                      </Text>
                    </div>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary px-3 py-2">
                    <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-chatbox-tertiary">
                      Host status
                    </Text>
                    <Text size="sm" fw={700} className="mt-1 text-chatbox-primary">
                      {snapshot.dataStateLabel}
                    </Text>
                    <Text size="xs" c="dimmed" className="mt-1">
                      {snapshot.lastUpdatedLabel}
                    </Text>
                  </div>
                  <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary px-3 py-2">
                    <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-chatbox-tertiary">
                      Source
                    </Text>
                    <Text size="sm" fw={700} className="mt-1 text-chatbox-primary">
                      {snapshot.sourceLabel}
                    </Text>
                    <Text size="xs" c="dimmed" className="mt-1">
                      {snapshot.refreshHint}
                    </Text>
                  </div>
                </div>
              </div>

              {hasCurrentData ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary px-3 py-3">
                    <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-chatbox-tertiary">
                      Feels like
                    </Text>
                    <Text size="sm" fw={700} className="mt-1 text-chatbox-primary">
                      {typeof snapshot.current?.apparentTemperature === 'number'
                        ? `${Math.round(snapshot.current.apparentTemperature)}°`
                        : 'Unavailable'}
                    </Text>
                  </div>
                  <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary px-3 py-3">
                    <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-chatbox-tertiary">
                      Wind
                    </Text>
                    <Text size="sm" fw={700} className="mt-1 text-chatbox-primary">
                      {typeof snapshot.current?.windSpeed === 'number'
                        ? `${Math.round(snapshot.current.windSpeed)} ${snapshot.units === 'imperial' ? 'mph' : 'km/h'}`
                        : 'Unavailable'}
                    </Text>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-[22px] border border-white/80 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
              <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-chatbox-tertiary">
                Next 4 days
              </Text>
              {showForecast ? (
                <div className="mt-3 grid gap-2">
                  {snapshot.forecast.map((day) => (
                    <div
                      key={`${day.dateKey}-${day.dayLabel}`}
                      className="flex items-center justify-between gap-3 rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-secondary px-3 py-3"
                    >
                      <div className="min-w-0">
                        <Text size="sm" fw={700} className="text-chatbox-primary">
                          {day.dayLabel}
                        </Text>
                        <Text size="xs" c="dimmed" className="mt-1">
                          {day.conditionLabel}
                          {typeof day.precipitationChance === 'number' ? ` · ${Math.round(day.precipitationChance)}% precip` : ''}
                        </Text>
                      </div>
                      <Text size="sm" fw={700} className="whitespace-nowrap text-chatbox-primary">
                        {Math.round(day.high)}° / {Math.round(day.low)}°
                      </Text>
                    </div>
                  ))}
                </div>
              ) : (
                <Text size="sm" c="dimmed" className="mt-3">
                  {snapshot.status === 'loading'
                    ? 'The host is still assembling the short forecast.'
                    : 'Short forecast details are not available for this request.'}
                </Text>
              )}
            </section>
          </div>
        </div>

        {snapshot.degraded ? (
          <div
            role="alert"
            className="mt-4 rounded-[20px] border border-amber-300 bg-amber-50/90 p-4 dark:border-amber-700 dark:bg-amber-950/20"
          >
            <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300">
              {snapshot.degraded.title}
            </Text>
            <Text size="sm" fw={700} className="mt-2 whitespace-pre-wrap text-chatbox-primary">
              {snapshot.degraded.message}
            </Text>
          </div>
        ) : (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 rounded-[20px] border border-sky-200 bg-sky-50/80 p-4 dark:border-sky-800 dark:bg-sky-950/20"
          >
            <Text size="xs" fw={700} className="uppercase tracking-[0.08em] text-sky-700 dark:text-sky-300">
              Saved for follow-up chat
            </Text>
            <Text size="sm" className="mt-2 whitespace-pre-wrap text-chatbox-primary">
              {snapshot.summary}
            </Text>
          </div>
        )}
      </div>
    </div>
  )
}
