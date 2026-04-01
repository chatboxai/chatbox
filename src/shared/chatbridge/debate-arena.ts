import { z } from 'zod'

export const CHATBRIDGE_DEBATE_ARENA_SCHEMA_VERSION = 1 as const

export const ChatBridgeDebateArenaPhaseSchema = z.enum(['setup', 'opening', 'rebuttal', 'reflection', 'complete'])
export type ChatBridgeDebateArenaPhase = z.infer<typeof ChatBridgeDebateArenaPhaseSchema>

export const ChatBridgeDebateArenaTeamSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    stance: z.enum(['affirmative', 'negative']),
    thesis: z.string().min(1).optional(),
    score: z.number().min(0).max(100).optional(),
  })
  .strict()

export type ChatBridgeDebateArenaTeam = z.infer<typeof ChatBridgeDebateArenaTeamSchema>

export const ChatBridgeDebateArenaSpeakerSchema = z
  .object({
    name: z.string().min(1),
    teamId: z.string().min(1),
    roleLabel: z.string().min(1).optional(),
  })
  .strict()

export type ChatBridgeDebateArenaSpeaker = z.infer<typeof ChatBridgeDebateArenaSpeakerSchema>

export const ChatBridgeDebateArenaResultSchema = z
  .object({
    winnerTeamId: z.string().min(1),
    winnerLabel: z.string().min(1).optional(),
    decision: z.string().min(1),
    nextStep: z.string().min(1).optional(),
    reflectionPrompt: z.string().min(1).optional(),
  })
  .strict()

export type ChatBridgeDebateArenaResult = z.infer<typeof ChatBridgeDebateArenaResultSchema>

export const ChatBridgeDebateArenaStateSchema = z
  .object({
    schemaVersion: z.literal(CHATBRIDGE_DEBATE_ARENA_SCHEMA_VERSION),
    phase: ChatBridgeDebateArenaPhaseSchema,
    motion: z.string().min(1),
    teams: z.array(ChatBridgeDebateArenaTeamSchema).min(2).max(2),
    rubricFocus: z.array(z.string().min(1)).max(4).optional(),
    roundLabel: z.string().min(1).optional(),
    currentSpeaker: ChatBridgeDebateArenaSpeakerSchema.optional(),
    timerLabel: z.string().min(1).optional(),
    coachNote: z.string().min(1).optional(),
    highlights: z.array(z.string().min(1)).max(3).optional(),
    result: ChatBridgeDebateArenaResultSchema.optional(),
  })
  .strict()

export type ChatBridgeDebateArenaState = z.infer<typeof ChatBridgeDebateArenaStateSchema>

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function getAppLabel(input: { appId: string; appName?: string }): string {
  const appName = input.appName?.trim()
  if (appName) {
    return appName
  }

  return input.appId.trim() || 'App'
}

function getTeamById(
  teams: ChatBridgeDebateArenaState['teams'],
  teamId: string
): ChatBridgeDebateArenaTeam | undefined {
  return teams.find((team) => team.id === teamId)
}

export function getChatBridgeDebateArenaPhaseLabel(phase: ChatBridgeDebateArenaPhase): string {
  return {
    setup: 'Setup',
    opening: 'Opening round',
    rebuttal: 'Rebuttal round',
    reflection: 'Reflection',
    complete: 'Completed round',
  }[phase]
}

export function getChatBridgeDebateArenaTeamLabel(team: ChatBridgeDebateArenaTeam): string {
  return `${team.name} (${team.stance === 'affirmative' ? 'Affirmative' : 'Negative'})`
}

export function getChatBridgeDebateArenaWinnerLabel(state: ChatBridgeDebateArenaState): string | null {
  if (!state.result) {
    return null
  }

  if (state.result.winnerLabel) {
    return normalizeWhitespace(state.result.winnerLabel)
  }

  const team = getTeamById(state.teams, state.result.winnerTeamId)
  return team ? getChatBridgeDebateArenaTeamLabel(team) : normalizeWhitespace(state.result.winnerTeamId)
}

function buildPhaseLead(input: { appId: string; appName?: string }, state: ChatBridgeDebateArenaState): string {
  const appLabel = getAppLabel(input)
  const motion = normalizeWhitespace(state.motion)

  if (state.phase === 'complete') {
    const winnerLabel = getChatBridgeDebateArenaWinnerLabel(state)
    if (winnerLabel) {
      return `${appLabel} completed the debate on "${motion}" and selected ${winnerLabel} as the winner.`
    }
    return `${appLabel} completed the debate on "${motion}".`
  }

  const phaseLabel = getChatBridgeDebateArenaPhaseLabel(state.phase).toLowerCase()
  return `${appLabel} is running the ${phaseLabel} on "${motion}".`
}

export function getChatBridgeDebateArenaSummaryForModel(
  input: { appId: string; appName?: string },
  state: ChatBridgeDebateArenaState
): string {
  const summaryParts: Array<string | null> = [buildPhaseLead(input, state)]

  if (state.currentSpeaker) {
    const speakerTeam = getTeamById(state.teams, state.currentSpeaker.teamId)
    const roleText = state.currentSpeaker.roleLabel ? ` (${normalizeWhitespace(state.currentSpeaker.roleLabel)})` : ''
    const teamText = speakerTeam ? ` for ${getChatBridgeDebateArenaTeamLabel(speakerTeam)}` : ''
    summaryParts.push(`Current speaker: ${normalizeWhitespace(state.currentSpeaker.name)}${roleText}${teamText}.`)
  }

  if (state.rubricFocus && state.rubricFocus.length > 0) {
    summaryParts.push(`Rubric focus: ${state.rubricFocus.map((item) => normalizeWhitespace(item)).join(', ')}.`)
  }

  if (state.coachNote) {
    summaryParts.push(`Coach note: ${normalizeWhitespace(state.coachNote)}`)
  }

  if (state.result) {
    summaryParts.push(`Decision: ${normalizeWhitespace(state.result.decision)}`)

    if (state.result.nextStep) {
      summaryParts.push(`Next step: ${normalizeWhitespace(state.result.nextStep)}`)
    } else if (state.result.reflectionPrompt) {
      summaryParts.push(`Reflection prompt: ${normalizeWhitespace(state.result.reflectionPrompt)}`)
    }
  }

  return normalizeWhitespace(summaryParts.filter((part): part is string => Boolean(part)).join(' '))
}

export function getChatBridgeDebateArenaState(value: unknown): ChatBridgeDebateArenaState | null {
  const parsed = ChatBridgeDebateArenaStateSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
