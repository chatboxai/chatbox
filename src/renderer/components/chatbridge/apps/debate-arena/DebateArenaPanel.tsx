import { Text } from '@mantine/core'
import type { ChatBridgeDebateArenaState } from '@shared/chatbridge'
import {
  getChatBridgeDebateArenaPhaseLabel,
  getChatBridgeDebateArenaTeamLabel,
  getChatBridgeDebateArenaWinnerLabel,
} from '@shared/chatbridge'
import type { MessageAppPart } from '@shared/types'

interface DebateArenaPanelProps {
  part: MessageAppPart
  state: ChatBridgeDebateArenaState
}

function getStanceBadgeClasses(stance: 'affirmative' | 'negative'): string {
  return stance === 'affirmative'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
    : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
}

export function DebateArenaPanel({ part, state }: DebateArenaPanelProps) {
  const winnerLabel = getChatBridgeDebateArenaWinnerLabel(state)
  const speakerLabel = state.currentSpeaker
    ? (() => {
        const speakerTeam = state.teams.find((team) => team.id === state.currentSpeaker?.teamId)
        const roleLabel = state.currentSpeaker.roleLabel ? `, ${state.currentSpeaker.roleLabel}` : ''
        return speakerTeam
          ? `${state.currentSpeaker.name} for ${getChatBridgeDebateArenaTeamLabel(speakerTeam)}${roleLabel}`
          : `${state.currentSpeaker.name}${roleLabel}`
      })()
    : null
  const showCoachCard =
    state.phase !== 'complete' &&
    Boolean(state.roundLabel || state.currentSpeaker || state.timerLabel || state.coachNote)
  const showResultCard = Boolean(state.result) || part.lifecycle === 'complete'

  return (
    <div data-testid="debate-arena-panel" className="bg-chatbox-background-primary p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
          {getChatBridgeDebateArenaPhaseLabel(state.phase)}
        </span>
        {state.roundLabel ? (
          <span className="inline-flex items-center rounded-full border border-chatbox-border-primary px-3 py-1 text-[11px] font-semibold text-chatbox-secondary">
            {state.roundLabel}
          </span>
        ) : null}
        {state.timerLabel ? (
          <span className="inline-flex items-center rounded-full border border-amber-300 px-3 py-1 text-[11px] font-semibold text-amber-700 dark:border-amber-700 dark:text-amber-300">
            {state.timerLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-4 rounded-[20px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
        <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-chatbox-tertiary">
          Motion
        </Text>
        <Text size="sm" fw={700} className="mt-2 whitespace-pre-wrap text-chatbox-primary">
          {state.motion}
        </Text>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {state.teams.map((team) => (
          <div
            key={team.id}
            className="rounded-[20px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <Text size="sm" fw={700} className="text-chatbox-primary">
                {team.name}
              </Text>
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${getStanceBadgeClasses(team.stance)}`}
              >
                {team.stance}
              </span>
            </div>
            {team.thesis ? (
              <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
                {team.thesis}
              </Text>
            ) : null}
            {typeof team.score === 'number' ? (
              <Text size="xs" c="dimmed" className="mt-3">
                Score: {team.score}
              </Text>
            ) : null}
          </div>
        ))}
      </div>

      {state.rubricFocus && state.rubricFocus.length > 0 ? (
        <div className="mt-4 rounded-[20px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-chatbox-tertiary">
            Rubric focus
          </Text>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.rubricFocus.map((item) => (
              <span
                key={item}
                className="inline-flex items-center rounded-full border border-chatbox-border-primary px-3 py-1 text-[12px] text-chatbox-secondary"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {showCoachCard ? (
        <div className="mt-4 rounded-[20px] border border-blue-200 bg-blue-50/80 p-4 dark:border-blue-800 dark:bg-blue-950/20">
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-blue-700 dark:text-blue-300">
            Coach-led round
          </Text>
          {speakerLabel ? (
            <Text size="sm" fw={700} className="mt-2 whitespace-pre-wrap text-chatbox-primary">
              {speakerLabel}
            </Text>
          ) : null}
          {state.coachNote ? (
            <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
              {state.coachNote}
            </Text>
          ) : null}
        </div>
      ) : null}

      {state.highlights && state.highlights.length > 0 ? (
        <div className="mt-4 rounded-[20px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-chatbox-tertiary">
            Highlights
          </Text>
          <ul className="mt-3 space-y-2 pl-4">
            {state.highlights.map((highlight) => (
              <li key={highlight}>
                <Text size="sm" c="dimmed" className="whitespace-pre-wrap">
                  {highlight}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showResultCard ? (
        <div className="mt-4 rounded-[20px] border border-emerald-300 bg-emerald-50/80 p-4 dark:border-emerald-700 dark:bg-emerald-950/20">
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-emerald-700 dark:text-emerald-300">
            Structured result
          </Text>
          <Text size="sm" fw={700} className="mt-2 whitespace-pre-wrap text-chatbox-primary">
            {winnerLabel ? `Winner: ${winnerLabel}` : 'The round is complete and preserved in the thread.'}
          </Text>
          {state.result?.decision ? (
            <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
              {state.result.decision}
            </Text>
          ) : null}
          {state.result?.nextStep ? (
            <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
              Next step: {state.result.nextStep}
            </Text>
          ) : state.result?.reflectionPrompt ? (
            <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
              Reflection prompt: {state.result.reflectionPrompt}
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
