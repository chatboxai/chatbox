import { z } from 'zod'
import {
  createChatBridgeAuditEvent,
  type ChatBridgeAuditCapture,
  type ChatBridgeAuditEvent,
} from './audit'
import type { BridgeAppEvent, BridgeEventValidationReason } from './bridge-session'
import type { ChatBridgeHostToolExecutionRecord } from './tools'

export const CHATBRIDGE_RECOVERY_CONTRACT_SCHEMA_VERSION = 1 as const
const CHATBRIDGE_RECOVERY_CONTRACT_VALUES_KEY = 'chatbridgeRecoveryContract'

export const ChatBridgeRecoveryFailureClassSchema = z.enum([
  'timeout',
  'runtime-crash',
  'invalid-tool-call',
  'malformed-bridge-event',
  'bridge-protocol-rejection',
])
export type ChatBridgeRecoveryFailureClass = z.infer<typeof ChatBridgeRecoveryFailureClassSchema>

export const ChatBridgeRecoverySourceSchema = z.enum(['bridge', 'tool', 'runtime', 'host'])
export type ChatBridgeRecoverySource = z.infer<typeof ChatBridgeRecoverySourceSchema>

export const ChatBridgeRecoverySeveritySchema = z.enum(['recoverable', 'terminal'])
export type ChatBridgeRecoverySeverity = z.infer<typeof ChatBridgeRecoverySeveritySchema>

export const ChatBridgeRecoveryItemToneSchema = z.enum(['neutral', 'safe', 'warning', 'blocked'])
export type ChatBridgeRecoveryItemTone = z.infer<typeof ChatBridgeRecoveryItemToneSchema>

export const ChatBridgeRecoveryItemSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  tone: ChatBridgeRecoveryItemToneSchema.default('neutral'),
})
export type ChatBridgeRecoveryItem = z.infer<typeof ChatBridgeRecoveryItemSchema>

export const ChatBridgeRecoveryPanelSchema = z.object({
  eyebrow: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  items: z.array(ChatBridgeRecoveryItemSchema).default([]),
})
export type ChatBridgeRecoveryPanel = z.infer<typeof ChatBridgeRecoveryPanelSchema>

export const ChatBridgeRecoveryActionIdSchema = z.enum([
  'retry-completion',
  'continue-in-chat',
  'dismiss-runtime',
  'resume-from-checkpoint',
  'ask-for-explanation',
  'inspect-invalid-fields',
])
export type ChatBridgeRecoveryActionId = z.infer<typeof ChatBridgeRecoveryActionIdSchema>

export const ChatBridgeRecoveryActionSchema = z.object({
  id: ChatBridgeRecoveryActionIdSchema,
  label: z.string(),
  variant: z.enum(['primary', 'secondary']).default('secondary'),
})
export type ChatBridgeRecoveryAction = z.infer<typeof ChatBridgeRecoveryActionSchema>

export const ChatBridgeRecoveryObservabilitySchema = z
  .object({
    traceCode: z.string().trim().min(1),
    auditCategory: z.literal('lifecycle.recovery'),
    outcome: z.string().trim().min(1),
    details: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
export type ChatBridgeRecoveryObservability = z.infer<typeof ChatBridgeRecoveryObservabilitySchema>

export const ChatBridgeRecoveryCorrelationSchema = z
  .object({
    appId: z.string().trim().min(1).optional(),
    appInstanceId: z.string().trim().min(1).optional(),
    bridgeSessionId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
  })
  .strict()
export type ChatBridgeRecoveryCorrelation = z.infer<typeof ChatBridgeRecoveryCorrelationSchema>

export const ChatBridgeRecoveryContractSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_RECOVERY_CONTRACT_SCHEMA_VERSION).default(CHATBRIDGE_RECOVERY_CONTRACT_SCHEMA_VERSION),
    failureClass: ChatBridgeRecoveryFailureClassSchema,
    source: ChatBridgeRecoverySourceSchema,
    severity: ChatBridgeRecoverySeveritySchema,
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    statusLabel: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    fallbackTitle: z.string().trim().min(1).optional(),
    fallbackText: z.string().trim().min(1),
    supportPanel: ChatBridgeRecoveryPanelSchema.optional(),
    actions: z.array(ChatBridgeRecoveryActionSchema).default([]),
    observability: ChatBridgeRecoveryObservabilitySchema,
    correlation: ChatBridgeRecoveryCorrelationSchema.default({}),
  })
  .strict()
export type ChatBridgeRecoveryContract = z.infer<typeof ChatBridgeRecoveryContractSchema>

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function getAppLabel(options: { appName?: string; appId?: string }) {
  const appName = typeof options.appName === 'string' ? normalizeWhitespace(options.appName) : ''
  if (appName) {
    return appName
  }

  const appId = typeof options.appId === 'string' ? normalizeWhitespace(options.appId) : ''
  return appId || 'App'
}

function buildRecoveryContract(input: Omit<ChatBridgeRecoveryContract, 'schemaVersion'>): ChatBridgeRecoveryContract {
  return ChatBridgeRecoveryContractSchema.parse({
    ...input,
    schemaVersion: CHATBRIDGE_RECOVERY_CONTRACT_SCHEMA_VERSION,
  })
}

export function writeChatBridgeRecoveryContractValues(
  values: Record<string, unknown> | undefined,
  contract: ChatBridgeRecoveryContract
) {
  return {
    ...(values || {}),
    [CHATBRIDGE_RECOVERY_CONTRACT_VALUES_KEY]: ChatBridgeRecoveryContractSchema.parse(contract),
  }
}

export function parseChatBridgeRecoveryContract(value: unknown): ChatBridgeRecoveryContract | null {
  const parsed = ChatBridgeRecoveryContractSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function readChatBridgeRecoveryContract(
  values: Record<string, unknown> | undefined
): ChatBridgeRecoveryContract | null {
  if (!values || typeof values !== 'object') {
    return null
  }

  return parseChatBridgeRecoveryContract(values[CHATBRIDGE_RECOVERY_CONTRACT_VALUES_KEY])
}

export function createChatBridgeRuntimeCrashRecoveryContract(options: {
  appId?: string
  appName?: string
  appInstanceId?: string
  bridgeSessionId?: string
  error?: string
  code?: string
}) {
  const appLabel = getAppLabel(options)
  const details = [
    options.code ? `code: ${options.code}` : null,
    options.error ? `error: ${normalizeWhitespace(options.error)}` : null,
  ].filter((value): value is string => Boolean(value))

  return buildRecoveryContract({
    failureClass: 'runtime-crash',
    source: 'runtime',
    severity: 'recoverable',
    title: `${appLabel} crashed before the runtime could settle`,
    description: `The host kept the failure inline, preserved the last validated ${appLabel} state, and blocked untrusted runtime output from becoming the final answer.`,
    statusLabel: 'Runtime crash',
    summary: `${appLabel} crashed, but the conversation can continue from preserved host-owned context.`,
    fallbackTitle: 'Recovery available',
    fallbackText: `Continue in chat from the last validated ${appLabel} checkpoint or dismiss the failed runtime without losing thread context.`,
    supportPanel: {
      eyebrow: 'Trust rail',
      title: 'What still holds',
      description: `Only validated ${appLabel} state and host diagnostics remain available in the thread.`,
      items: [
        {
          label: 'Conversation can continue safely',
          description: 'The host can answer follow-up questions from preserved state without reopening the failed runtime.',
          tone: 'safe',
        },
        {
          label: 'Failed runtime output stays quarantined',
          description: 'No unsafe crash residue is promoted as trusted completion output.',
          tone: 'blocked',
        },
      ],
    },
    actions: [
      { id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' },
      { id: 'dismiss-runtime', label: 'Dismiss runtime', variant: 'secondary' },
    ],
    observability: {
      traceCode: 'recovery.runtime-crash',
      auditCategory: 'lifecycle.recovery',
      outcome: 'runtime_crash',
      details,
    },
    correlation: {
      ...(options.appId ? { appId: options.appId } : {}),
      ...(options.appInstanceId ? { appInstanceId: options.appInstanceId } : {}),
      ...(options.bridgeSessionId ? { bridgeSessionId: options.bridgeSessionId } : {}),
    },
  })
}

export function createChatBridgeTimeoutRecoveryContract(options: {
  appId?: string
  appName?: string
  appInstanceId?: string
  bridgeSessionId?: string
  waitedMs?: number
}) {
  const appLabel = getAppLabel(options)
  const waitedMs = typeof options.waitedMs === 'number' && Number.isFinite(options.waitedMs) ? Math.max(0, options.waitedMs) : null
  const details = waitedMs !== null ? [`waitedMs: ${waitedMs}`] : []

  return buildRecoveryContract({
    failureClass: 'timeout',
    source: 'bridge',
    severity: 'recoverable',
    title: `${appLabel} did not respond before the host timeout`,
    description: `The host stopped waiting for the ${appLabel} runtime, kept the conversation usable, and preserved only validated state for the next safe action.`,
    statusLabel: 'Timed out',
    summary: `${appLabel} timed out before the host could trust a live response, so recovery stays explicit in the thread.`,
    fallbackTitle: 'Timed out',
    fallbackText: `Continue in chat from preserved host-owned context or ask for a bounded explanation before trying again.`,
    supportPanel: {
      eyebrow: 'Trust rail',
      title: 'What still holds',
      description: 'The host kept only safe context and timeout diagnostics.',
      items: [
        {
          label: 'Last validated checkpoint remains available',
          description: 'The thread can continue from the latest safe state without pretending the runtime finished.',
          tone: 'safe',
        },
        {
          label: 'Timed-out runtime state stays out of model memory',
          description: 'No incomplete or late runtime output is promoted as trusted context.',
          tone: 'blocked',
        },
      ],
    },
    actions: [
      { id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' },
      { id: 'ask-for-explanation', label: 'Ask for explanation', variant: 'secondary' },
    ],
    observability: {
      traceCode: 'recovery.timeout',
      auditCategory: 'lifecycle.recovery',
      outcome: 'timeout',
      details,
    },
    correlation: {
      ...(options.appId ? { appId: options.appId } : {}),
      ...(options.appInstanceId ? { appInstanceId: options.appInstanceId } : {}),
      ...(options.bridgeSessionId ? { bridgeSessionId: options.bridgeSessionId } : {}),
    },
  })
}

export function createChatBridgeMalformedBridgeRecoveryContract(options: {
  appId?: string
  appName?: string
  appInstanceId?: string
  bridgeSessionId?: string
  rawKind?: string
  issues: string[]
}) {
  const appLabel = getAppLabel(options)
  const details = [
    options.rawKind ? `rawKind: ${normalizeWhitespace(options.rawKind)}` : null,
    ...options.issues.map((issue) => normalizeWhitespace(issue)).filter(Boolean),
  ]
    .filter((value): value is string => Boolean(value))
    .slice(0, 4)

  return buildRecoveryContract({
    failureClass: 'malformed-bridge-event',
    source: 'bridge',
    severity: 'terminal',
    title: `${appLabel} sent malformed bridge data`,
    description: `The host rejected malformed bridge traffic, kept the conversation safe, and bounded recovery to trusted host-owned state.`,
    statusLabel: 'Malformed event',
    summary: `${appLabel} sent malformed bridge data, so the host failed closed and kept recovery explicit.`,
    fallbackTitle: 'Runtime blocked',
    fallbackText: 'The runtime can stay dismissed while the conversation continues from validated host-owned context.',
    supportPanel: {
      eyebrow: 'Trust rail',
      title: 'What still holds',
      description: 'Only validated host state and safe diagnostics remain visible.',
      items: [
        {
          label: 'Malformed payload stayed blocked',
          description: 'Invalid bridge fields never became trusted app state or model memory.',
          tone: 'blocked',
        },
        {
          label: 'Thread context remains usable',
          description: 'The assistant can continue from preserved host-owned context.',
          tone: 'safe',
        },
      ],
    },
    actions: [
      { id: 'dismiss-runtime', label: 'Dismiss runtime', variant: 'primary' },
      { id: 'ask-for-explanation', label: 'Ask for explanation', variant: 'secondary' },
    ],
    observability: {
      traceCode: 'recovery.malformed-bridge-event',
      auditCategory: 'lifecycle.recovery',
      outcome: 'malformed_bridge_event',
      details,
    },
    correlation: {
      ...(options.appId ? { appId: options.appId } : {}),
      ...(options.appInstanceId ? { appInstanceId: options.appInstanceId } : {}),
      ...(options.bridgeSessionId ? { bridgeSessionId: options.bridgeSessionId } : {}),
    },
  })
}

export function createChatBridgeBridgeRejectionRecoveryContract(options: {
  reason: BridgeEventValidationReason
  event?: Pick<BridgeAppEvent, 'kind' | 'appInstanceId' | 'bridgeSessionId'>
  appId?: string
  appName?: string
}) {
  if (options.reason === 'session-expired') {
    return createChatBridgeTimeoutRecoveryContract({
      appId: options.appId,
      appName: options.appName,
      appInstanceId: options.event?.appInstanceId,
      bridgeSessionId: options.event?.bridgeSessionId,
    })
  }

  const appLabel = getAppLabel(options)
  const details = [
    `reason: ${options.reason}`,
    options.event?.kind ? `eventKind: ${options.event.kind}` : null,
  ].filter((value): value is string => Boolean(value))

  return buildRecoveryContract({
    failureClass: 'bridge-protocol-rejection',
    source: 'bridge',
    severity: 'terminal',
    title: `${appLabel} violated the bridge session contract`,
    description: `The host rejected the ${appLabel} runtime update because it failed bridge validation, then kept recovery bounded to trusted host-owned state.`,
    statusLabel: 'Bridge rejected',
    summary: `${appLabel} sent a bridge event the host could not accept, so the runtime stayed quarantined and the conversation remained usable.`,
    fallbackTitle: 'Runtime rejected',
    fallbackText: 'Continue in chat from preserved host context or dismiss the runtime while the host keeps the failure explicit.',
    supportPanel: {
      eyebrow: 'Trust rail',
      title: 'What still holds',
      description: 'The host failed closed on the rejected bridge event.',
      items: [
        {
          label: 'Rejected event stayed out of state',
          description: 'The host refused to apply invalid or replayed bridge mutations.',
          tone: 'blocked',
        },
        {
          label: 'Safe conversation continuity remains available',
          description: 'The thread can continue from the last validated checkpoint.',
          tone: 'safe',
        },
      ],
    },
    actions: [
      { id: 'dismiss-runtime', label: 'Dismiss runtime', variant: 'primary' },
      { id: 'ask-for-explanation', label: 'Ask for explanation', variant: 'secondary' },
    ],
    observability: {
      traceCode: 'recovery.bridge-rejection',
      auditCategory: 'lifecycle.recovery',
      outcome: options.reason,
      details,
    },
    correlation: {
      ...(options.appId ? { appId: options.appId } : {}),
      ...(options.event?.appInstanceId ? { appInstanceId: options.event.appInstanceId } : {}),
      ...(options.event?.bridgeSessionId ? { bridgeSessionId: options.event.bridgeSessionId } : {}),
    },
  })
}

export function getChatBridgeRecoveryContractFromToolExecutionRecord(
  record: ChatBridgeHostToolExecutionRecord
): ChatBridgeRecoveryContract | null {
  if (record.outcome.status === 'success') {
    return null
  }

  const errorCode = record.outcome.error?.code ?? 'unknown_tool_failure'
  const errorMessage = record.outcome.error?.message
    ? normalizeWhitespace(record.outcome.error.message)
    : 'The host rejected or failed the tool invocation.'
  const details = [
    `toolName: ${record.toolName}`,
    `outcome: ${record.outcome.status}`,
    `errorCode: ${errorCode}`,
  ]

  if (record.outcome.status === 'rejected') {
    return buildRecoveryContract({
      failureClass: 'invalid-tool-call',
      source: 'tool',
      severity: errorCode === 'missing_execute_handler' ? 'terminal' : 'recoverable',
      title: `${record.toolName} did not pass host validation`,
      description: 'The host refused the tool call, kept the failure bounded, and preserved conversation continuity without executing an unsafe action.',
      statusLabel: 'Invalid tool call',
      summary: `${record.toolName} failed host validation, so the request stayed explicit instead of becoming an unsafe side effect.`,
      fallbackTitle: 'Tool blocked',
      fallbackText: 'Continue in chat or inspect the bounded validation diagnostics before retrying the tool call.',
      supportPanel: {
        eyebrow: 'Trust rail',
        title: 'What still holds',
        description: 'The host blocked the invalid tool request before it could mutate external state.',
        items: [
          {
            label: 'No side effect was executed',
            description: 'Host validation stopped the invalid tool call before it could change remote state.',
            tone: 'safe',
          },
          {
            label: 'Rejected inputs remain bounded',
            description: 'Only safe validation diagnostics remain visible to the user and operator.',
            tone: 'blocked',
          },
        ],
      },
      actions: [
        { id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' },
        { id: 'inspect-invalid-fields', label: 'Inspect invalid fields', variant: 'secondary' },
      ],
      observability: {
        traceCode: 'recovery.invalid-tool-call',
        auditCategory: 'lifecycle.recovery',
        outcome: errorCode,
        details,
      },
      correlation: {
        appId: record.appId,
        toolName: record.toolName,
      },
    })
  }

  return buildRecoveryContract({
    failureClass: 'runtime-crash',
    source: 'tool',
    severity: 'recoverable',
    title: `${record.toolName} failed during host execution`,
    description: 'The host caught the tool execution failure, kept the conversation usable, and avoided treating partial tool output as trusted state.',
    statusLabel: 'Tool failed',
    summary: `${record.toolName} failed during host execution, so recovery stays bounded to host-owned state and diagnostics.`,
    fallbackTitle: 'Tool failed',
    fallbackText: 'Continue in chat from preserved host context or dismiss the failed tool path without losing the surrounding conversation.',
    supportPanel: {
      eyebrow: 'Trust rail',
      title: 'What still holds',
      description: 'The host caught the failure before it could become trusted conversation state.',
      items: [
        {
          label: 'Conversation can continue safely',
          description: 'The host can keep helping even if the tool path stays unavailable.',
          tone: 'safe',
        },
        {
          label: 'Failed tool output remains quarantined',
          description: 'Only bounded diagnostics remain visible for retry or operator review.',
          tone: 'blocked',
        },
      ],
    },
    actions: [
      { id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' },
      { id: 'dismiss-runtime', label: 'Dismiss runtime', variant: 'secondary' },
    ],
    observability: {
      traceCode: 'recovery.tool-execution-failed',
      auditCategory: 'lifecycle.recovery',
      outcome: errorCode,
      details: [...details, `message: ${errorMessage}`],
    },
    correlation: {
      appId: record.appId,
      toolName: record.toolName,
    },
  })
}

export function createChatBridgeRecoveryAuditEvent(options: {
  eventId: string
  occurredAt: number
  contract: ChatBridgeRecoveryContract
  tenantId?: string
  teacherId?: string
  classroomId?: string
  userId?: string
  sessionId?: string
  requestId?: string
  capture?: ChatBridgeAuditCapture
}): ChatBridgeAuditEvent {
  const details = [
    ...options.contract.observability.details,
    `failureClass: ${options.contract.failureClass}`,
    `source: ${options.contract.source}`,
    `severity: ${options.contract.severity}`,
  ]

  return createChatBridgeAuditEvent({
    eventId: options.eventId,
    category: options.contract.observability.auditCategory,
    occurredAt: options.occurredAt,
    outcome: options.contract.observability.outcome,
    summary: options.contract.summary,
    details,
    payload: {
      title: options.contract.title,
      description: options.contract.description,
      fallbackText: options.contract.fallbackText,
      statusLabel: options.contract.statusLabel,
      correlation: options.contract.correlation,
    },
    capture: options.capture,
    tenantId: options.tenantId,
    teacherId: options.teacherId,
    classroomId: options.classroomId,
    userId: options.userId,
    appId: options.contract.correlation.appId,
    sessionId: options.sessionId,
    requestId: options.requestId,
    action: options.contract.failureClass,
  })
}
