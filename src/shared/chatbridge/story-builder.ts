import { z } from 'zod'

export const CHATBRIDGE_STORY_BUILDER_APP_ID = 'story-builder' as const
export const CHATBRIDGE_STORY_BUILDER_SCHEMA_VERSION = 1 as const

export const ChatBridgeStoryBuilderModeSchema = z.enum([
  'needs-auth',
  'active',
  'resume-ready',
  'complete',
  'degraded',
])
export type ChatBridgeStoryBuilderMode = z.infer<typeof ChatBridgeStoryBuilderModeSchema>

export const ChatBridgeStoryBuilderDriveStatusSchema = z.enum(['needs-auth', 'connecting', 'connected', 'expired'])
export type ChatBridgeStoryBuilderDriveStatus = z.infer<typeof ChatBridgeStoryBuilderDriveStatusSchema>

export const ChatBridgeStoryBuilderSaveStateSchema = z.enum(['saved', 'saving', 'attention'])
export type ChatBridgeStoryBuilderSaveState = z.infer<typeof ChatBridgeStoryBuilderSaveStateSchema>

export const ChatBridgeStoryBuilderCheckpointStatusSchema = z.enum(['latest', 'saved', 'attention'])
export type ChatBridgeStoryBuilderCheckpointStatus = z.infer<typeof ChatBridgeStoryBuilderCheckpointStatusSchema>

export const ChatBridgeStoryBuilderDriveSchema = z
  .object({
    provider: z.literal('google-drive').default('google-drive'),
    status: ChatBridgeStoryBuilderDriveStatusSchema,
    statusLabel: z.string().trim().min(1),
    detail: z.string().trim().min(1),
    connectedAs: z.string().trim().min(1).optional(),
    folderLabel: z.string().trim().min(1).optional(),
    lastSyncedLabel: z.string().trim().min(1).optional(),
  })
  .strict()
export type ChatBridgeStoryBuilderDrive = z.infer<typeof ChatBridgeStoryBuilderDriveSchema>

export const ChatBridgeStoryBuilderDraftSchema = z
  .object({
    title: z.string().trim().min(1),
    chapterLabel: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    excerpt: z.string().trim().min(1),
    wordCount: z.number().int().nonnegative(),
    saveState: ChatBridgeStoryBuilderSaveStateSchema,
    saveLabel: z.string().trim().min(1),
    userGoal: z.string().trim().min(1).optional(),
  })
  .strict()
export type ChatBridgeStoryBuilderDraft = z.infer<typeof ChatBridgeStoryBuilderDraftSchema>

export const ChatBridgeStoryBuilderCheckpointSchema = z
  .object({
    checkpointId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1),
    savedAtLabel: z.string().trim().min(1),
    status: ChatBridgeStoryBuilderCheckpointStatusSchema,
    locationLabel: z.string().trim().min(1).optional(),
  })
  .strict()
export type ChatBridgeStoryBuilderCheckpoint = z.infer<typeof ChatBridgeStoryBuilderCheckpointSchema>

export const ChatBridgeStoryBuilderCalloutSchema = z
  .object({
    eyebrow: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
  })
  .strict()
export type ChatBridgeStoryBuilderCallout = z.infer<typeof ChatBridgeStoryBuilderCalloutSchema>

export const ChatBridgeStoryBuilderCompletionSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    handoffLabel: z.string().trim().min(1).optional(),
    nextStepLabel: z.string().trim().min(1).optional(),
  })
  .strict()
export type ChatBridgeStoryBuilderCompletion = z.infer<typeof ChatBridgeStoryBuilderCompletionSchema>

export const ChatBridgeStoryBuilderStateSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_STORY_BUILDER_SCHEMA_VERSION),
    mode: ChatBridgeStoryBuilderModeSchema,
    drive: ChatBridgeStoryBuilderDriveSchema,
    draft: ChatBridgeStoryBuilderDraftSchema,
    checkpoints: z.array(ChatBridgeStoryBuilderCheckpointSchema).max(4).default([]),
    callout: ChatBridgeStoryBuilderCalloutSchema.optional(),
    completion: ChatBridgeStoryBuilderCompletionSchema.optional(),
  })
  .strict()
export type ChatBridgeStoryBuilderState = z.infer<typeof ChatBridgeStoryBuilderStateSchema>

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function isChatBridgeStoryBuilderAppId(appId: string): boolean {
  return appId.trim().toLowerCase() === CHATBRIDGE_STORY_BUILDER_APP_ID
}

export function getChatBridgeStoryBuilderModeLabel(mode: ChatBridgeStoryBuilderMode): string {
  return {
    'needs-auth': 'Connect Drive',
    active: 'Drafting',
    'resume-ready': 'Resume ready',
    complete: 'Complete',
    degraded: 'Needs recovery',
  }[mode]
}

export function getChatBridgeStoryBuilderState(value: unknown): ChatBridgeStoryBuilderState | null {
  const parsed = ChatBridgeStoryBuilderStateSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function getChatBridgeStoryBuilderSummaryForModel(
  input: { appId: string; appName?: string },
  state: ChatBridgeStoryBuilderState
): string {
  const appLabel = normalizeWhitespace(input.appName?.trim() || input.appId.trim() || 'Story Builder')
  const draftLabel = normalizeWhitespace(state.draft.chapterLabel || state.draft.title)

  const summaryParts: Array<string | null> = [
    {
      'needs-auth': `${appLabel} is waiting for Google Drive authorization before resuming ${draftLabel}.`,
      active: `${appLabel} is actively drafting ${draftLabel}.`,
      'resume-ready': `${appLabel} has a resumable checkpoint ready for ${draftLabel}.`,
      complete: `${appLabel} completed ${draftLabel} and handed the draft back to chat.`,
      degraded: `${appLabel} paused in a recoverable state while working on ${draftLabel}.`,
    }[state.mode],
    `Drive status: ${normalizeWhitespace(state.drive.statusLabel)}.`,
    state.drive.detail ? normalizeWhitespace(state.drive.detail) : null,
    `Current draft: ${normalizeWhitespace(state.draft.summary)}`,
    `Save state: ${normalizeWhitespace(state.draft.saveLabel)}.`,
  ]

  if (state.checkpoints[0]) {
    summaryParts.push(
      `Latest checkpoint: ${normalizeWhitespace(state.checkpoints[0].label)} saved ${normalizeWhitespace(
        state.checkpoints[0].savedAtLabel
      )}.`
    )
  }

  if (state.completion?.description) {
    summaryParts.push(normalizeWhitespace(state.completion.description))
    if (state.completion.handoffLabel) {
      summaryParts.push(`Handoff: ${normalizeWhitespace(state.completion.handoffLabel)}`)
    }
    if (state.completion.nextStepLabel) {
      summaryParts.push(`Next step: ${normalizeWhitespace(state.completion.nextStepLabel)}`)
    }
  } else if (state.callout?.description) {
    summaryParts.push(normalizeWhitespace(state.callout.description))
  }

  return normalizeWhitespace(summaryParts.filter((part): part is string => Boolean(part)).join(' '))
}
