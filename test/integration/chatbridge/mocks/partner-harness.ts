import type {
  BridgeAppEvent,
  BridgeEventValidationReason,
  BridgeHostBootstrapMessage,
  BridgeHostRenderMessage,
  BridgeSessionCapability,
} from '@shared/chatbridge/bridge-session'
import { BridgeHostBootstrapMessageSchema, BridgeHostRenderMessageSchema } from '@shared/chatbridge/bridge-session'
import type { ChatBridgeObservabilityEvent } from '@shared/chatbridge/observability'
import type { ChatBridgeRecoveryContract } from '@shared/chatbridge/recovery-contract'
import {
  createBridgeHostController,
  type BridgeMessageChannelLike,
  type BridgeMessagePortLike,
  type BridgeTargetWindowLike,
  type BridgeTraceEvent,
} from '@/packages/chatbridge/bridge/host-controller'

type MockPortMessageEvent = {
  data: unknown
}

export class MockPartnerHarnessMessagePort implements BridgeMessagePortLike {
  onmessage: ((event: MockPortMessageEvent) => void) | null = null

  peer: MockPartnerHarnessMessagePort | null = null

  sentMessages: unknown[] = []

  receivedMessages: unknown[] = []

  closed = false

  postMessage(message: unknown) {
    this.sentMessages.push(message)
    if (this.peer) {
      this.peer.receivedMessages.push(message)
    }
    this.peer?.onmessage?.({ data: message })
  }

  start() {}

  close() {
    this.closed = true
  }
}

export function createPartnerHarnessMessageChannel(): BridgeMessageChannelLike {
  const port1 = new MockPartnerHarnessMessagePort()
  const port2 = new MockPartnerHarnessMessagePort()
  port1.peer = port2
  port2.peer = port1
  return {
    port1,
    port2,
  }
}

function createDeterministicIds(values?: string[]) {
  if (!values || values.length === 0) {
    return undefined
  }

  const remaining = [...values]
  return () => {
    const next = remaining.shift()
    if (!next) {
      throw new Error('No deterministic IDs remaining for partner harness')
    }
    return next
  }
}

export interface ChatBridgePartnerHarnessOptions {
  appId: string
  appName?: string
  appVersion?: string
  appInstanceId: string
  expectedOrigin: string
  capabilities: BridgeSessionCapability[]
  createIds?: string[]
  now?: () => number
  ttlMs?: number
}

export function createChatBridgePartnerHarness(options: ChatBridgePartnerHarnessOptions) {
  const traces: BridgeTraceEvent[] = []
  const observabilityEvents: ChatBridgeObservabilityEvent[] = []
  const recoveryDecisions: ChatBridgeRecoveryContract[] = []
  const acceptedAppEvents: Exclude<BridgeAppEvent, { kind: 'app.ready' }>[] = []
  const rejectedAppEvents: Array<{ event: BridgeAppEvent; reason: BridgeEventValidationReason }> = []
  const invalidAppEvents: Array<{ rawEvent: unknown; issues: string[] }> = []

  let bootstrapMessage: BridgeHostBootstrapMessage | null = null
  let bootstrapTargetOrigin: string | null = null
  let appPort: MockPartnerHarnessMessagePort | null = null

  const targetWindow: BridgeTargetWindowLike = {
    postMessage(message, targetOrigin, transfer) {
      bootstrapMessage = BridgeHostBootstrapMessageSchema.parse(message)
      bootstrapTargetOrigin = targetOrigin
      appPort = transfer?.[0] as MockPartnerHarnessMessagePort
    },
  }

  const controller = createBridgeHostController({
    appId: options.appId,
    appName: options.appName,
    appVersion: options.appVersion,
    appInstanceId: options.appInstanceId,
    expectedOrigin: options.expectedOrigin,
    capabilities: options.capabilities,
    createId: createDeterministicIds(options.createIds),
    createMessageChannel: createPartnerHarnessMessageChannel,
    now: options.now,
    ttlMs: options.ttlMs,
    onTrace: (trace) => traces.push(trace),
    onObservabilityEvent: (event) => observabilityEvents.push(event),
    onRecoveryDecision: (decision) => recoveryDecisions.push(decision),
    onAcceptedAppEvent: (event) => acceptedAppEvents.push(event),
    onRejectedAppEvent: (event, reason) => rejectedAppEvents.push({ event, reason }),
    onInvalidAppEvent: (rawEvent, issues) => invalidAppEvents.push({ rawEvent, issues }),
  })

  controller.attach(targetWindow)

  return {
    controller,
    targetWindow,
    traces,
    observabilityEvents,
    recoveryDecisions,
    acceptedAppEvents,
    rejectedAppEvents,
    invalidAppEvents,
    getBootstrapMessage(): BridgeHostBootstrapMessage | null {
      return bootstrapMessage
    },
    getBootstrapTargetOrigin(): string | null {
      return bootstrapTargetOrigin
    },
    getAppPort(): MockPartnerHarnessMessagePort {
      if (!appPort) {
        throw new Error('Partner harness app port is not attached.')
      }
      return appPort
    },
    getHostRenderMessages(): BridgeHostRenderMessage[] {
      if (!appPort) {
        return []
      }

      return appPort.receivedMessages
        .map((message) => BridgeHostRenderMessageSchema.safeParse(message))
        .filter((result): result is { success: true; data: BridgeHostRenderMessage } => result.success)
        .map((result) => result.data)
    },
    sendAppEvent(event: BridgeAppEvent) {
      this.getAppPort().postMessage(event)
    },
    renderHtml(html: string) {
      controller.renderHtml(html)
    },
    waitForReady() {
      return controller.waitForReady()
    },
  }
}
