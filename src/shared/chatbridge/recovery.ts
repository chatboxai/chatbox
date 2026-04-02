import { z } from 'zod'
import type { MessageAppPart } from '../types/session'
import { getChatBridgeAppSummaryForModel } from './app-memory'
import { ChatBridgeCompletionPayloadSchema, type ChatBridgeCompletionPayload } from './completion'
import { readChatBridgeRecoveryContract } from './recovery-contract'

export const CHATBRIDGE_RECOVERY_SCHEMA_VERSION = 1 as const

export const ChatBridgeRecoveryActionSchema = z
  .object({
    kind: z.enum(['resume_in_chat', 'ask_follow_up', 'continue_in_chat', 'explain']),
    label: z.string().min(1),
    prompt: z.string().min(1),
  })
  .strict()

export type ChatBridgeRecoveryAction = z.infer<typeof ChatBridgeRecoveryActionSchema>

export const ChatBridgeRecoveryStateSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_RECOVERY_SCHEMA_VERSION),
    tone: z.enum(['warning', 'calm']).default('calm'),
    label: z.string().min(1).default('Host-owned recovery'),
    userGoal: z.string().min(1).optional(),
    summary: z.string().min(1),
    footnote: z.string().min(1).optional(),
    actions: z.array(ChatBridgeRecoveryActionSchema).max(2).optional(),
  })
  .strict()

export type ChatBridgeRecoveryState = z.infer<typeof ChatBridgeRecoveryStateSchema>

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function getAppLabel(part: Pick<MessageAppPart, 'appId' | 'appName'>): string {
  const appName = part.appName?.trim()
  if (appName) {
    return appName
  }

  const appId = part.appId.trim()
  return appId || 'App'
}

function getCompletionPayload(part: MessageAppPart): ChatBridgeCompletionPayload | null {
  const parsed = ChatBridgeCompletionPayloadSchema.safeParse(part.values?.chatbridgeCompletion)
  return parsed.success ? parsed.data : null
}

function getUserGoal(part: MessageAppPart): string | undefined {
  const explicitGoal =
    part.values && typeof part.values === 'object' && typeof part.values.chatbridgeUserGoal === 'string'
      ? normalizeWhitespace(part.values.chatbridgeUserGoal)
      : ''
  if (explicitGoal) {
    return explicitGoal
  }

  const completionPayload = getCompletionPayload(part)
  const outcomeGoal =
    completionPayload?.outcomeData && typeof completionPayload.outcomeData.userGoal === 'string'
      ? normalizeWhitespace(completionPayload.outcomeData.userGoal)
      : ''

  return outcomeGoal || undefined
}

function buildResumePrompt(appLabel: string, userGoal?: string, resumeHint?: string): string {
  const segments = [`Resume the previous ${appLabel} session from the last safe checkpoint.`]
  if (userGoal) {
    segments.push(`Original goal: ${userGoal}.`)
  }
  if (resumeHint) {
    segments.push(`Resume hint: ${normalizeWhitespace(resumeHint)}`)
  }
  segments.push('Explain what state was recovered before continuing.')
  return segments.join(' ')
}

function buildFollowUpPrompt(appLabel: string, userGoal?: string): string {
  const segments = [`Use the preserved ${appLabel} context to answer the next user question in chat.`]
  if (userGoal) {
    segments.push(`Keep the original goal in mind: ${userGoal}.`)
  }
  segments.push('If a live app resume is still required, say so explicitly.')
  return segments.join(' ')
}

function buildExplainPrompt(appLabel: string, userGoal?: string): string {
  const segments = [`Explain what interrupted the previous ${appLabel} run and what data was preserved.`]
  if (userGoal) {
    segments.push(`Original goal: ${userGoal}.`)
  }
  segments.push('Recommend the safest next step.')
  return segments.join(' ')
}

function buildActionPrompt(actionId: string, appLabel: string, userGoal?: string, resumeHint?: string): string {
  switch (actionId) {
    case 'resume-from-checkpoint':
      return buildResumePrompt(appLabel, userGoal, resumeHint)
    case 'continue-in-chat':
      return buildFollowUpPrompt(appLabel, userGoal)
    case 'dismiss-runtime':
      return [
        `Dismiss the unavailable ${appLabel} runtime and continue from preserved host-owned context.`,
        userGoal ? `Original goal: ${userGoal}.` : null,
        'Do not rely on live runtime state that the host no longer trusts.',
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
    case 'inspect-invalid-fields':
      return [
        `Explain which ${appLabel} fields or tool inputs failed host validation.`,
        userGoal ? `Original goal: ${userGoal}.` : null,
        'Use only validated host-owned diagnostics in the explanation.',
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
    case 'retry-completion':
      return [
        `Retry the previous ${appLabel} completion from the last validated checkpoint only.`,
        userGoal ? `Original goal: ${userGoal}.` : null,
        'Keep any untrusted partial output explicitly out of model memory.',
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
    case 'ask-for-explanation':
    default:
      return buildExplainPrompt(appLabel, userGoal)
  }
}

function buildRecoveryStateFromContract(part: MessageAppPart) {
  const contract = readChatBridgeRecoveryContract(
    part.values && typeof part.values === 'object' ? (part.values as Record<string, unknown>) : undefined
  )
  if (!contract) {
    return null
  }

  const appLabel = getAppLabel(part)
  const userGoal = getUserGoal(part)
  const completionPayload = getCompletionPayload(part)
  const resumeHint =
    completionPayload && 'resumability' in completionPayload && completionPayload.resumability?.resumeHint
      ? normalizeWhitespace(completionPayload.resumability.resumeHint)
      : undefined

  return ChatBridgeRecoveryStateSchema.parse({
    schemaVersion: CHATBRIDGE_RECOVERY_SCHEMA_VERSION,
    tone: contract.severity === 'terminal' ? 'warning' : 'calm',
    label: 'Host-owned recovery',
    ...(userGoal ? { userGoal } : {}),
    summary: contract.summary,
    footnote: contract.fallbackText,
    actions: contract.actions.map((action) => ({
      kind:
        action.id === 'resume-from-checkpoint'
          ? 'resume_in_chat'
          : action.id === 'ask-for-explanation' || action.id === 'inspect-invalid-fields'
            ? 'explain'
            : action.id === 'continue-in-chat' || action.id === 'dismiss-runtime'
              ? 'continue_in_chat'
              : 'ask_follow_up',
      label: action.label,
      prompt: buildActionPrompt(action.id, appLabel, userGoal, resumeHint),
    })),
  })
}

function buildDerivedRecoveryState(part: MessageAppPart): ChatBridgeRecoveryState | null {
  const completionPayload = getCompletionPayload(part)
  const degradedCompletionStatus =
    completionPayload && completionPayload.status !== 'success' ? completionPayload.status : null

  if (part.lifecycle !== 'error' && part.lifecycle !== 'stale' && !degradedCompletionStatus) {
    return null
  }

  const appLabel = getAppLabel(part)
  const userGoal = getUserGoal(part)
  const preservedSummary = getChatBridgeAppSummaryForModel(part) ?? part.summary?.trim() ?? ''
  const resumeHint =
    completionPayload && 'resumability' in completionPayload && completionPayload.resumability?.resumeHint
      ? normalizeWhitespace(completionPayload.resumability.resumeHint)
      : undefined
  const errorDetail = part.error?.trim()

  const summaryParts = [
    degradedCompletionStatus === 'interrupted'
      ? `${appLabel} did not finish cleanly, but the host still has the last safe checkpoint available for later turns.`
      : degradedCompletionStatus === 'failed'
        ? `${appLabel} failed before the runtime could settle into a durable completion state, but the host kept the last approved context.`
        : part.lifecycle === 'stale'
          ? `The live ${appLabel} runtime is no longer current, but the host still has the last approved checkpoint available.`
          : `The ${appLabel} runtime did not stay available, but the host kept the last safe context in-thread.`,
    preservedSummary ? `Preserved context: ${normalizeWhitespace(preservedSummary)}` : null,
    resumeHint ? `Resume hint: ${resumeHint}` : null,
    errorDetail && degradedCompletionStatus !== 'failed' ? `Latest error: ${normalizeWhitespace(errorDetail)}` : null,
  ].filter((segment): segment is string => Boolean(segment))

  const canResume =
    part.lifecycle === 'stale' ||
    part.lifecycle === 'error' ||
    degradedCompletionStatus === 'interrupted' ||
    Boolean(completionPayload && 'resumability' in completionPayload && completionPayload.resumability?.resumable)

  const actions: ChatBridgeRecoveryAction[] = canResume
    ? [
        {
          kind: 'resume_in_chat',
          label: 'Resume app',
          prompt: buildResumePrompt(appLabel, userGoal, resumeHint),
        },
        {
          kind: userGoal ? 'ask_follow_up' : 'continue_in_chat',
          label: userGoal ? 'Ask follow-up' : 'Continue in chat',
          prompt: buildFollowUpPrompt(appLabel, userGoal),
        },
      ]
    : [
        {
          kind: 'continue_in_chat',
          label: 'Continue in chat',
          prompt: buildFollowUpPrompt(appLabel, userGoal),
        },
        {
          kind: 'explain',
          label: 'Explain what happened',
          prompt: buildExplainPrompt(appLabel, userGoal),
        },
      ]

  return {
    schemaVersion: CHATBRIDGE_RECOVERY_SCHEMA_VERSION,
    tone: 'calm',
    label: 'Host-owned recovery',
    ...(userGoal ? { userGoal } : {}),
    summary: summaryParts.join(' '),
    footnote: 'The conversation can continue from preserved host-owned context even if the live runtime stays unavailable.',
    actions,
  }
}

export function getChatBridgeRecoveryState(part: MessageAppPart): ChatBridgeRecoveryState | null {
  const parsedExplicit = ChatBridgeRecoveryStateSchema.safeParse(part.values?.chatbridgeRecovery)
  if (parsedExplicit.success) {
    return parsedExplicit.data
  }

  const contractDerived = buildRecoveryStateFromContract(part)
  if (contractDerived) {
    return contractDerived
  }

  return buildDerivedRecoveryState(part)
}

export function hasChatBridgeDegradedRecovery(part: MessageAppPart): boolean {
  return getChatBridgeRecoveryState(part) !== null
}
