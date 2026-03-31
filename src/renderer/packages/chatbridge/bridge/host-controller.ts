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

export type BridgeTraceEvent =
  | { type: 'session.attached' }
  | { type: 'session.ready' }
  | { type: 'host.render.sent'; renderId: string }
  | { type: 'app.event.accepted'; eventKind: BridgeAppEvent['kind'] }
  | { type: 'app.event.rejected'; eventKind: BridgeAppEvent['kind']; reason: BridgeEventValidationReason }

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

  const readyPromise = new Promise<void>((resolve) => {
    readyResolver = resolve
  })

  function emitTrace(trace: BridgeTraceEvent) {
    options.onTrace?.(trace)
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
        emitTrace({
          type: 'app.event.rejected',
          eventKind: event.kind,
          reason: acknowledged.reason,
        })
        return
      }

      session = acknowledged.session
      isReady = true
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
      emitTrace({
        type: 'app.event.rejected',
        eventKind: event.kind,
        reason: accepted.reason,
      })
      return
    }

    session = accepted.session
    options.onAcceptedAppEvent?.(event)
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
      attachedPort?.close()
      attachedPort = null
    },
  }
}
