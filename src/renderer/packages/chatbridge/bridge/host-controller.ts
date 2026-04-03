import {
  type BridgeAppEvent,
  BridgeAppEventSchema,
  type BridgeEventValidationReason,
  BridgeHostBootstrapMessageSchema,
  BridgeHostRenderMessageSchema,
  BridgeHostSyncContextMessageSchema,
  type BridgeSessionCapability,
  acknowledgeBridgeSession,
  acceptBridgeAppEvent,
  createBridgeSession,
  type BridgeReadyEvent,
  type BridgeSessionState,
} from '@shared/chatbridge/bridge-session'
import type { ChatBridgeAuditEvent } from '@shared/chatbridge/audit'
import {
  recordChatBridgeObservabilityEvent,
  type ChatBridgeObservabilityEvent,
} from '@shared/chatbridge/observability'
import {
  createChatBridgeBridgeRejectionRecoveryContract,
  createChatBridgeMalformedBridgeRecoveryContract,
  createChatBridgeRecoveryAuditEvent,
  createChatBridgeRuntimeCrashRecoveryContract,
  createChatBridgeTimeoutRecoveryContract,
  type ChatBridgeRecoveryContract,
  type ChatBridgeRecoveryFailureClass,
  type ChatBridgeRecoverySource,
} from '@shared/chatbridge/recovery-contract'
import { createNoopLangSmithAdapter, type LangSmithAdapter } from '@shared/utils/langsmith_adapter'

export type BridgeTraceEvent =
  | { type: 'session.attached' }
  | { type: 'session.ready' }
  | { type: 'host.render.sent'; renderId: string }
  | { type: 'app.event.accepted'; eventKind: BridgeAppEvent['kind'] }
  | { type: 'app.event.rejected'; eventKind: BridgeAppEvent['kind']; reason: BridgeEventValidationReason }
  | { type: 'app.event.invalid'; rawKind?: string; issues: string[] }
  | {
      type: 'recovery.required'
      failureClass: ChatBridgeRecoveryFailureClass
      source: ChatBridgeRecoverySource
      traceCode: string
    }

export interface BridgeMessagePortLike {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown): void
  start?: () => void
  close(): void
}

export interface BridgeMessageChannelLike {
  port1: BridgeMessagePortLike
  port2: BridgeMessagePortLike
}

export interface BridgeTargetWindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer?: BridgeMessagePortLike[]): void
}

type BridgeHostControllerOptions = {
  appId: string
  appName?: string
  appVersion?: string
  appInstanceId: string
  expectedOrigin: string
  bootstrapTargetOrigin?: string
  capabilities: BridgeSessionCapability[]
  createMessageChannel?: () => BridgeMessageChannelLike
  createId?: () => string
  now?: () => number
  ttlMs?: number
  traceParentRunId?: string
  onTrace?: (trace: BridgeTraceEvent) => void
  onReady?: (event: BridgeReadyEvent) => void
  onAcceptedAppEvent?: (event: Exclude<BridgeAppEvent, BridgeReadyEvent>) => void
  onRejectedAppEvent?: (event: BridgeAppEvent, reason: BridgeEventValidationReason) => void
  onInvalidAppEvent?: (rawEvent: unknown, issues: string[]) => void
  onRecoveryDecision?: (decision: ChatBridgeRecoveryContract) => void
  onRecoveryAudit?: (event: ChatBridgeAuditEvent) => void
  onObservabilityEvent?: (event: ChatBridgeObservabilityEvent) => void
  traceAdapter?: LangSmithAdapter
}

function defaultMessageChannelFactory(): BridgeMessageChannelLike {
  const channel = new MessageChannel()
  return channel as unknown as BridgeMessageChannelLike
}

export function createBridgeHostController(options: BridgeHostControllerOptions) {
  const traceAdapter = options.traceAdapter ?? createNoopLangSmithAdapter()
  const { session: initialSession, envelope } = createBridgeSession(
    {
      appId: options.appId,
      appInstanceId: options.appInstanceId,
      expectedOrigin: options.expectedOrigin,
      capabilities: options.capabilities,
    },
    {
      createId: options.createId,
      now: options.now,
      ttlMs: options.ttlMs,
    }
  )

  let session: BridgeSessionState = initialSession
  let attachedPort: BridgeMessagePortLike | null = null
  let isReady = false
  let pendingHtml: string | null = null
  let pendingSnapshot: Record<string, unknown> | null = null
  let readyResolver: (() => void) | null = null
  let readyRejecter: ((error: Error) => void) | null = null
  let readyTimeout: ReturnType<typeof setTimeout> | null = null
  let readySettled = false

  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolver = resolve
    readyRejecter = reject
  })

  function emitTrace(trace: BridgeTraceEvent) {
    options.onTrace?.(trace)
  }

  function emitTraceEvent(name: string, metadata: Record<string, unknown>) {
    void traceAdapter.recordEvent({
      name,
      runType: 'tool',
      parentRunId: options.traceParentRunId,
      metadata: {
        appId: options.appId,
        appInstanceId: options.appInstanceId,
        bridgeSessionId: envelope.bridgeSessionId,
        ...metadata,
      },
      tags: ['chatbridge', 'bridge'],
    })
  }

  function emitObservabilityEvent(
    input: Omit<
      ChatBridgeObservabilityEvent,
      'schemaVersion' | 'appId' | 'appName' | 'version' | 'appInstanceId' | 'bridgeSessionId' | 'details'
    > & {
      details?: string[]
    }
  ) {
    const event = recordChatBridgeObservabilityEvent({
      ...input,
      appId: options.appId,
      ...(options.appName ? { appName: options.appName } : {}),
      ...(options.appVersion ? { version: options.appVersion } : {}),
      appInstanceId: options.appInstanceId,
      bridgeSessionId: envelope.bridgeSessionId,
    })
    options.onObservabilityEvent?.(event)
  }

  function clearReadyTimeout() {
    if (readyTimeout !== null) {
      clearTimeout(readyTimeout)
      readyTimeout = null
    }
  }

  function emitRecovery(decision: ChatBridgeRecoveryContract) {
    options.onRecoveryDecision?.(decision)
    options.onRecoveryAudit?.(
      createChatBridgeRecoveryAuditEvent({
        eventId: crypto.randomUUID(),
        occurredAt: options.now?.() ?? Date.now(),
        contract: decision,
      })
    )
    emitObservabilityEvent({
      eventId: crypto.randomUUID(),
      occurredAt: options.now?.() ?? Date.now(),
      kind: 'recovery-required',
      severity: decision.severity === 'terminal' ? 'error' : 'warn',
      status: 'degraded',
      traceCode: decision.observability.traceCode,
      summary: decision.summary,
      details: decision.observability.details,
    })
    emitTrace({
      type: 'recovery.required',
      failureClass: decision.failureClass,
      source: decision.source,
      traceCode: decision.observability.traceCode,
    })
    emitTraceEvent('chatbridge.bridge.recovery_required', {
      failureClass: decision.failureClass,
      source: decision.source,
      traceCode: decision.observability.traceCode,
    })
  }

  function rejectReady(decision: ChatBridgeRecoveryContract) {
    if (readySettled) {
      return
    }

    readySettled = true
    clearReadyTimeout()
    emitRecovery(decision)
    readyRejecter?.(new Error(decision.summary))
  }

  function scheduleReadyTimeout() {
    clearReadyTimeout()
    if (isReady || readySettled) {
      return
    }

    const now = options.now?.() ?? Date.now()
    const delayMs = Math.max(0, envelope.expiresAt - now)

    readyTimeout = setTimeout(() => {
      if (isReady || readySettled) {
        return
      }

      rejectReady(
        createChatBridgeTimeoutRecoveryContract({
          appId: options.appId,
          appInstanceId: options.appInstanceId,
          bridgeSessionId: envelope.bridgeSessionId,
          waitedMs: envelope.expiresAt - envelope.issuedAt,
        })
      )
    }, delayMs)
  }

  function sendPendingHtml() {
    if (!attachedPort || !isReady || pendingHtml === null) {
      return
    }

    const renderMessage = BridgeHostRenderMessageSchema.parse({
      kind: 'host.render',
      bridgeSessionId: envelope.bridgeSessionId,
      appInstanceId: envelope.appInstanceId,
      renderId: options.createId?.() ?? crypto.randomUUID(),
      html: pendingHtml,
    })

    attachedPort.postMessage(renderMessage)
    emitObservabilityEvent({
      eventId: crypto.randomUUID(),
      occurredAt: options.now?.() ?? Date.now(),
      kind: 'host-render-sent',
      severity: 'info',
      status: 'healthy',
      summary: `${options.appName ?? options.appId} received a host render update.`,
      details: [`renderId: ${renderMessage.renderId}`],
    })
    emitTrace({
      type: 'host.render.sent',
      renderId: renderMessage.renderId,
    })
    emitTraceEvent('chatbridge.bridge.host_render_sent', {
      renderId: renderMessage.renderId,
    })
  }

  function sendPendingSnapshot() {
    if (!attachedPort || !isReady || pendingSnapshot === null) {
      return
    }

    const syncMessage = BridgeHostSyncContextMessageSchema.parse({
      kind: 'host.syncContext',
      bridgeSessionId: envelope.bridgeSessionId,
      appInstanceId: envelope.appInstanceId,
      snapshot: pendingSnapshot,
    })

    attachedPort.postMessage(syncMessage)
    emitObservabilityEvent({
      eventId: crypto.randomUUID(),
      occurredAt: options.now?.() ?? Date.now(),
      kind: 'host-render-sent',
      severity: 'info',
      status: 'healthy',
      summary: `${options.appName ?? options.appId} received a host-owned state sync.`,
      details: ['message: host.syncContext'],
    })
    emitTraceEvent('chatbridge.bridge.host_sync_context_sent', {
      appId: options.appId,
    })
  }

  function handleAppEvent(event: BridgeAppEvent) {
    if (event.kind === 'app.ready') {
      const acknowledged = acknowledgeBridgeSession(session, event, {
        now: options.now,
      })

      if (!acknowledged.accepted) {
        options.onRejectedAppEvent?.(event, acknowledged.reason)
        emitObservabilityEvent({
          eventId: crypto.randomUUID(),
          occurredAt: options.now?.() ?? Date.now(),
          kind: 'app-event-rejected',
          severity: 'error',
          status: 'degraded',
          summary: `${options.appName ?? options.appId} sent an app.ready event that failed bridge validation.`,
          details: [`reason: ${acknowledged.reason}`],
        })
        emitRecovery(
          createChatBridgeBridgeRejectionRecoveryContract({
            reason: acknowledged.reason,
            event,
            appId: options.appId,
          })
        )
        emitTrace({
          type: 'app.event.rejected',
          eventKind: event.kind,
          reason: acknowledged.reason,
        })
        emitTraceEvent('chatbridge.bridge.app_event_rejected', {
          eventKind: event.kind,
          reason: acknowledged.reason,
        })
        return
      }

      session = acknowledged.session
      isReady = true
      readySettled = true
      clearReadyTimeout()
      options.onReady?.(event)
      readyResolver?.()
      emitObservabilityEvent({
        eventId: crypto.randomUUID(),
        occurredAt: options.now?.() ?? Date.now(),
        kind: 'session-ready',
        severity: 'info',
        status: 'healthy',
        summary: `${options.appName ?? options.appId} completed the bridge handshake.`,
      })
      emitTrace({ type: 'session.ready' })
      emitTraceEvent('chatbridge.bridge.session_ready', {
        eventKind: event.kind,
      })
      sendPendingHtml()
      sendPendingSnapshot()
      return
    }

    const accepted = acceptBridgeAppEvent(session, event, {
      now: options.now,
    })

    if (!accepted.accepted) {
      options.onRejectedAppEvent?.(event, accepted.reason)
      emitObservabilityEvent({
        eventId: crypto.randomUUID(),
        occurredAt: options.now?.() ?? Date.now(),
        kind: 'app-event-rejected',
        severity: 'error',
        status: 'degraded',
        summary: `${options.appName ?? options.appId} sent ${event.kind}, but the host rejected it.`,
        details: [`reason: ${accepted.reason}`],
      })
      emitRecovery(
        createChatBridgeBridgeRejectionRecoveryContract({
          reason: accepted.reason,
          event,
          appId: options.appId,
        })
      )
      emitTrace({
        type: 'app.event.rejected',
        eventKind: event.kind,
        reason: accepted.reason,
      })
      emitTraceEvent('chatbridge.bridge.app_event_rejected', {
        eventKind: event.kind,
        reason: accepted.reason,
      })
      return
    }

    session = accepted.session
    options.onAcceptedAppEvent?.(event)
    emitObservabilityEvent({
      eventId: crypto.randomUUID(),
      occurredAt: options.now?.() ?? Date.now(),
      kind: 'app-event-accepted',
      severity: event.kind === 'app.error' ? 'warn' : 'info',
      status: event.kind === 'app.error' ? 'degraded' : 'healthy',
      summary: `${options.appName ?? options.appId} sent ${event.kind} and the host accepted it.`,
      details: event.kind === 'app.complete' ? ['completion accepted'] : [],
    })
    if (event.kind === 'app.error') {
      emitTrace({
        type: 'app.event.accepted',
        eventKind: event.kind,
      })
      emitTraceEvent('chatbridge.bridge.app_event_accepted', {
        eventKind: event.kind,
      })
      emitRecovery(
        createChatBridgeRuntimeCrashRecoveryContract({
          appId: options.appId,
          appInstanceId: options.appInstanceId,
          bridgeSessionId: event.bridgeSessionId,
          error: event.error,
        })
      )
      return
    }
    emitTrace({
      type: 'app.event.accepted',
      eventKind: event.kind,
    })
    emitTraceEvent('chatbridge.bridge.app_event_accepted', {
      eventKind: event.kind,
    })
  }

  return {
    attach(targetWindow: BridgeTargetWindowLike) {
      const channel = (options.createMessageChannel ?? defaultMessageChannelFactory)()
      attachedPort = channel.port1
      attachedPort.start?.()
      attachedPort.onmessage = (event) => {
        const parsed = BridgeAppEventSchema.safeParse(event.data)
        if (!parsed.success) {
          const issues = parsed.error.issues.map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
            return `${path}: ${issue.message}`
          })
          const rawKind =
            typeof event.data === 'object' && event.data !== null && 'kind' in event.data
              ? String((event.data as { kind?: unknown }).kind)
              : undefined

          options.onInvalidAppEvent?.(event.data, issues)
          emitObservabilityEvent({
            eventId: crypto.randomUUID(),
            occurredAt: options.now?.() ?? Date.now(),
            kind: 'app-event-invalid',
            severity: 'error',
            status: 'degraded',
            summary: `${options.appName ?? options.appId} sent malformed bridge traffic.`,
            details: issues,
          })
          emitRecovery(
            createChatBridgeMalformedBridgeRecoveryContract({
              appId: options.appId,
              appInstanceId: options.appInstanceId,
              bridgeSessionId: envelope.bridgeSessionId,
              rawKind,
              issues,
            })
          )
          emitTrace({
            type: 'app.event.invalid',
            rawKind,
            issues,
          })
          emitTraceEvent('chatbridge.bridge.app_event_invalid', {
            rawKind: rawKind ?? 'unknown',
            issueCount: issues.length,
          })
          return
        }
        handleAppEvent(parsed.data)
      }

      const bootstrapMessage = BridgeHostBootstrapMessageSchema.parse({
        kind: 'host.bootstrap',
        envelope,
      })

      targetWindow.postMessage(bootstrapMessage, options.bootstrapTargetOrigin ?? envelope.expectedOrigin, [channel.port2])
      emitObservabilityEvent({
        eventId: crypto.randomUUID(),
        occurredAt: options.now?.() ?? Date.now(),
        kind: 'session-attached',
        severity: 'info',
        status: 'healthy',
        summary: `${options.appName ?? options.appId} attached a reviewed bridge session.`,
      })
      emitTrace({ type: 'session.attached' })
      emitTraceEvent('chatbridge.bridge.session_attached', {
        expectedOrigin: envelope.expectedOrigin,
      })
      scheduleReadyTimeout()
    },
    waitForReady() {
      return readyPromise
    },
    renderHtml(html: string) {
      pendingHtml = html
      sendPendingHtml()
    },
    syncContext(snapshot: Record<string, unknown>) {
      pendingSnapshot = snapshot
      sendPendingSnapshot()
    },
    getSession() {
      return session
    },
    dispose() {
      clearReadyTimeout()
      attachedPort?.close()
      attachedPort = null
    },
  }
}
