import {
  type BridgeAppEvent,
  BridgeAppEventSchema,
  type BridgeEventValidationReason,
  BridgeHostBootstrapMessageSchema,
  BridgeHostRenderMessageSchema,
  type BridgeSessionCapability,
  acknowledgeBridgeSession,
  acceptBridgeAppEvent,
  createBridgeSession,
  type BridgeReadyEvent,
  type BridgeSessionState,
} from '@shared/chatbridge/bridge-session'
import type { ChatBridgeAuditEvent } from '@shared/chatbridge/audit'
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
  appInstanceId: string
  expectedOrigin: string
  bootstrapTargetOrigin?: string
  capabilities: BridgeSessionCapability[]
  createMessageChannel?: () => BridgeMessageChannelLike
  createId?: () => string
  now?: () => number
  ttlMs?: number
  onTrace?: (trace: BridgeTraceEvent) => void
  onAcceptedAppEvent?: (event: Exclude<BridgeAppEvent, BridgeReadyEvent>) => void
  onRejectedAppEvent?: (event: BridgeAppEvent, reason: BridgeEventValidationReason) => void
  onInvalidAppEvent?: (rawEvent: unknown, issues: string[]) => void
  onRecoveryDecision?: (decision: ChatBridgeRecoveryContract) => void
  onRecoveryAudit?: (event: ChatBridgeAuditEvent) => void
}

function defaultMessageChannelFactory(): BridgeMessageChannelLike {
  const channel = new MessageChannel()
  return channel as unknown as BridgeMessageChannelLike
}

export function createBridgeHostController(options: BridgeHostControllerOptions) {
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
    emitTrace({
      type: 'recovery.required',
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
    emitTrace({
      type: 'host.render.sent',
      renderId: renderMessage.renderId,
    })
  }

  function handleAppEvent(event: BridgeAppEvent) {
    if (event.kind === 'app.ready') {
      const acknowledged = acknowledgeBridgeSession(session, event, {
        now: options.now,
      })

      if (!acknowledged.accepted) {
        options.onRejectedAppEvent?.(event, acknowledged.reason)
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
        return
      }

      session = acknowledged.session
      isReady = true
      readySettled = true
      clearReadyTimeout()
      readyResolver?.()
      emitTrace({ type: 'session.ready' })
      sendPendingHtml()
      return
    }

    const accepted = acceptBridgeAppEvent(session, event, {
      now: options.now,
    })

    if (!accepted.accepted) {
      options.onRejectedAppEvent?.(event, accepted.reason)
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
      return
    }

    session = accepted.session
    options.onAcceptedAppEvent?.(event)
    if (event.kind === 'app.error') {
      emitRecovery(
        createChatBridgeRuntimeCrashRecoveryContract({
          appId: options.appId,
          appInstanceId: options.appInstanceId,
          bridgeSessionId: event.bridgeSessionId,
          error: event.error,
        })
      )
    }
    emitTrace({
      type: 'app.event.accepted',
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
          return
        }
        handleAppEvent(parsed.data)
      }

      const bootstrapMessage = BridgeHostBootstrapMessageSchema.parse({
        kind: 'host.bootstrap',
        envelope,
      })

      targetWindow.postMessage(bootstrapMessage, options.bootstrapTargetOrigin ?? envelope.expectedOrigin, [channel.port2])
      emitTrace({ type: 'session.attached' })
      scheduleReadyTimeout()
    },
    waitForReady() {
      return readyPromise
    },
    renderHtml(html: string) {
      pendingHtml = html
      sendPendingHtml()
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
