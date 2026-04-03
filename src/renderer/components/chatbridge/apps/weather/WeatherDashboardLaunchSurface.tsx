import { CHATBRIDGE_LANGSMITH_PROJECT_NAME } from '@shared/models/tracing'
import {
  ChatBridgeWeatherDashboardResultSchema,
  WeatherDashboardSnapshotSchema,
  createWeatherDashboardDegradedSnapshot,
  createWeatherDashboardLoadingSnapshot,
  normalizeWeatherLocationHint,
  resolveWeatherUnits,
  type ChatBridgeWeatherDashboardResult,
  type ChatBridgeReviewedAppLaunch,
  type WeatherDashboardSnapshot,
} from '@shared/chatbridge'
import type { LangSmithRunHandle } from '@shared/utils/langsmith_adapter'
import type { MessageAppPart } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { langsmith } from '@/adapters/langsmith'
import {
  persistReviewedAppLaunchBootstrap,
  persistReviewedAppLaunchBridgeEvent,
  persistReviewedAppLaunchBridgeReady,
} from '@/packages/chatbridge/reviewed-app-launch'
import { WeatherDashboardPanel } from './WeatherDashboardPanel'

interface WeatherDashboardLaunchSurfaceProps {
  part: MessageAppPart
  launch: ChatBridgeReviewedAppLaunch
  sessionId?: string
  messageId?: string
}

function parsePartSnapshot(snapshot: unknown) {
  const parsed = WeatherDashboardSnapshotSchema.safeParse(snapshot)
  return parsed.success ? parsed.data : null
}

function createFallbackSnapshot(launch: ChatBridgeReviewedAppLaunch, updatedAt = Date.now()) {
  const locationQuery = normalizeWeatherLocationHint(launch.location, launch.request)
  const units = resolveWeatherUnits(launch.request)

  return createWeatherDashboardDegradedSnapshot({
    request: launch.request,
    locationQuery,
    locationName: locationQuery ?? 'Weather Dashboard',
    units,
    updatedAt,
    degraded: {
      reason: 'upstream-error',
      title: 'Desktop host required',
      message: 'Weather Dashboard requires the desktop host bridge to fetch live weather data.',
      retryable: false,
      usingStaleSnapshot: false,
    },
  })
}

export function WeatherDashboardLaunchSurface({
  part,
  launch,
  sessionId,
  messageId,
}: WeatherDashboardLaunchSurfaceProps) {
  const initialSnapshot = useMemo(() => {
    const fromPart = parsePartSnapshot(part.snapshot)
    if (fromPart) {
      return fromPart
    }

    return createWeatherDashboardLoadingSnapshot({
      request: launch.request,
      locationQuery: normalizeWeatherLocationHint(launch.location, launch.request),
      units: resolveWeatherUnits(launch.request),
    })
  }, [launch.location, launch.request, part.snapshot])

  const [snapshot, setSnapshot] = useState<WeatherDashboardSnapshot>(initialSnapshot)
  const [refreshing, setRefreshing] = useState(false)
  const launchRunRef = useRef<LangSmithRunHandle | null>(null)
  const lastSnapshotRef = useRef<WeatherDashboardSnapshot>(initialSnapshot)
  const bridgeSessionIdRef = useRef(part.bridgeSessionId ?? `weather-dashboard:${part.appInstanceId}:${crypto.randomUUID()}`)
  const nextSequenceRef = useRef(1)
  const initializedRef = useRef(false)

  useEffect(() => {
    initializedRef.current = false
    bridgeSessionIdRef.current = part.bridgeSessionId ?? `weather-dashboard:${part.appInstanceId}:${crypto.randomUUID()}`
    nextSequenceRef.current = 1
  }, [part.appInstanceId])

  useEffect(() => {
    setSnapshot(initialSnapshot)
    lastSnapshotRef.current = initialSnapshot
  }, [initialSnapshot])

  async function endLaunchRun(result?: Parameters<LangSmithRunHandle['end']>[0]) {
    const activeRun = launchRunRef.current
    launchRunRef.current = null
    if (!activeRun) {
      return
    }

    await activeRun.end(result)
  }

  async function persistReadyState() {
    if (!sessionId || !messageId) {
      return
    }

    await persistReviewedAppLaunchBootstrap({
      sessionId,
      messageId,
      part,
      bridgeSessionId: bridgeSessionIdRef.current,
    })
    await persistReviewedAppLaunchBridgeReady({
      sessionId,
      messageId,
      part,
      event: {
        kind: 'app.ready',
        bridgeSessionId: bridgeSessionIdRef.current,
        appInstanceId: part.appInstanceId,
        bridgeToken: bridgeSessionIdRef.current,
        ackNonce: bridgeSessionIdRef.current,
        sequence: nextSequenceRef.current++,
      },
    })
  }

  async function persistSnapshot(nextSnapshot: WeatherDashboardSnapshot, reason: 'initial' | 'refresh' | 'fallback') {
    if (!sessionId || !messageId) {
      return
    }

    await persistReviewedAppLaunchBridgeEvent({
      sessionId,
      messageId,
      part,
      event: {
        kind: 'app.state',
        bridgeSessionId: bridgeSessionIdRef.current,
        appInstanceId: part.appInstanceId,
        bridgeToken: bridgeSessionIdRef.current,
        sequence: nextSequenceRef.current++,
        idempotencyKey: `${reason}-${nextSnapshot.updatedAt}-${nextSnapshot.cacheStatus}`,
        snapshot: nextSnapshot,
      },
    })
  }

  async function fetchSnapshot(refresh: boolean) {
    const locationQuery = normalizeWeatherLocationHint(launch.location, launch.request)
    const units = resolveWeatherUnits(launch.request)

    if (typeof window === 'undefined' || typeof window.electronAPI?.invoke !== 'function') {
      const fallbackSnapshot = createFallbackSnapshot(launch)
      setSnapshot(fallbackSnapshot)
      lastSnapshotRef.current = fallbackSnapshot
      await persistSnapshot(fallbackSnapshot, 'fallback')
      return fallbackSnapshot
    }

    const result = (await window.electronAPI.invoke('chatbridge-weather:get-dashboard', {
      request: launch.request,
      location: launch.location ?? locationQuery,
      units,
      refresh,
      traceParentRunId: launchRunRef.current?.runId,
    })) as ChatBridgeWeatherDashboardResult

    const parsed = ChatBridgeWeatherDashboardResultSchema.parse(result)
    setSnapshot(parsed.snapshot)
    lastSnapshotRef.current = parsed.snapshot
    await persistSnapshot(parsed.snapshot, refresh ? 'refresh' : 'initial')
    return parsed.snapshot
  }

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        launchRunRef.current = await langsmith.startRun({
          name: 'chatbridge.runtime.weather-dashboard',
          projectName: CHATBRIDGE_LANGSMITH_PROJECT_NAME,
          runType: 'chain',
          inputs: {
            sessionId: sessionId ?? null,
            messageId: messageId ?? null,
            appId: part.appId,
            appInstanceId: part.appInstanceId,
            request: launch.request ?? null,
            location: launch.location ?? null,
          },
          metadata: {
            operation: 'weather-dashboard-runtime',
            storyId: 'CB-510',
            uiEntry: launch.uiEntry ?? null,
          },
          tags: ['chatbridge', 'renderer', 'weather-dashboard', 'cb-510'],
        })
      } catch {
        launchRunRef.current = null
      }

      if (initializedRef.current) {
        return
      }

      initializedRef.current = true
      await persistReadyState()

      await fetchSnapshot(false)
      if (disposed) {
        return
      }
    })()

    return () => {
      disposed = true
      void endLaunchRun({
        outputs: {
          status: lastSnapshotRef.current.status,
          cacheStatus: lastSnapshotRef.current.cacheStatus,
          locationName: lastSnapshotRef.current.locationName,
        },
      })
    }
  }, [launch.location, launch.request, launch.uiEntry, messageId, part.appId, part.appInstanceId, sessionId])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchSnapshot(true)
    } finally {
      setRefreshing(false)
    }
  }

  return <WeatherDashboardPanel snapshot={snapshot} refreshing={refreshing} onRefresh={() => void handleRefresh()} />
}
