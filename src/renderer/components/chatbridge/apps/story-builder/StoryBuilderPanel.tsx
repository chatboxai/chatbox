import { Text } from '@mantine/core'
import {
  getChatBridgeStoryBuilderModeLabel,
  type ChatBridgeStoryBuilderCheckpoint,
  type ChatBridgeStoryBuilderState,
} from '@shared/chatbridge'
import type { MessageAppPart } from '@shared/types'

interface StoryBuilderPanelProps {
  part: MessageAppPart
  state: ChatBridgeStoryBuilderState
}

function getDriveToneClasses(status: ChatBridgeStoryBuilderState['drive']['status']) {
  if (status === 'connected') {
    return 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-700 dark:bg-emerald-950/20'
  }
  if (status === 'connecting') {
    return 'border-sky-300 bg-sky-50/80 dark:border-sky-700 dark:bg-sky-950/20'
  }
  if (status === 'expired') {
    return 'border-rose-300 bg-rose-50/80 dark:border-rose-700 dark:bg-rose-950/20'
  }

  return 'border-amber-300 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/20'
}

function getSaveToneClasses(saveState: ChatBridgeStoryBuilderState['draft']['saveState']) {
  if (saveState === 'saved') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
  }
  if (saveState === 'saving') {
    return 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
}

function getCheckpointToneClasses(checkpoint: ChatBridgeStoryBuilderCheckpoint) {
  if (checkpoint.status === 'latest') {
    return 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
  }
  if (checkpoint.status === 'attention') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
  }

  return 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'
}

export function StoryBuilderPanel({ part, state }: StoryBuilderPanelProps) {
  const modeLabel = getChatBridgeStoryBuilderModeLabel(state.mode)
  const completion = state.completion
  const showCompletionCard = Boolean(completion) || part.lifecycle === 'complete'

  return (
    <div data-testid="story-builder-panel" className="bg-chatbox-background-primary p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="rounded-[24px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
              {state.draft.chapterLabel}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${getSaveToneClasses(
                state.draft.saveState
              )}`}
            >
              {state.draft.saveLabel}
            </span>
          </div>

          <Text size="xl" fw={700} className="mt-4 whitespace-pre-wrap text-chatbox-primary">
            {state.draft.title}
          </Text>
          <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
            {state.draft.summary}
          </Text>

          <div className="mt-4 rounded-[20px] border border-chatbox-border-primary bg-chatbox-background-primary p-4">
            <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-chatbox-tertiary">
              Current passage
            </Text>
            <Text size="sm" className="mt-3 whitespace-pre-wrap text-chatbox-primary">
              {state.draft.excerpt}
            </Text>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-chatbox-tertiary">
            <span>{modeLabel}</span>
            <span>{state.draft.wordCount} words</span>
            {state.draft.userGoal ? <span>{state.draft.userGoal}</span> : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className={`rounded-[24px] border p-4 ${getDriveToneClasses(state.drive.status)}`}>
            <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-chatbox-tertiary">
              Google Drive
            </Text>
            <Text size="sm" fw={700} className="mt-2 whitespace-pre-wrap text-chatbox-primary">
              {state.drive.statusLabel}
            </Text>
            <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
              {state.drive.detail}
            </Text>
            {state.drive.connectedAs ? (
              <Text size="xs" c="dimmed" className="mt-3">
                Connected as {state.drive.connectedAs}
              </Text>
            ) : null}
            {state.drive.folderLabel ? (
              <Text size="xs" c="dimmed">
                Folder: {state.drive.folderLabel}
              </Text>
            ) : null}
            {state.drive.lastSyncedLabel ? (
              <Text size="xs" c="dimmed">
                Last sync: {state.drive.lastSyncedLabel}
              </Text>
            ) : null}
          </div>

          {state.callout ? (
            <div className="rounded-[24px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
              {state.callout.eyebrow ? (
                <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-chatbox-tertiary">
                  {state.callout.eyebrow}
                </Text>
              ) : null}
              <Text size="sm" fw={700} className={state.callout.eyebrow ? 'mt-2 text-chatbox-primary' : 'text-chatbox-primary'}>
                {state.callout.title}
              </Text>
              <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
                {state.callout.description}
              </Text>
            </div>
          ) : null}
        </div>
      </div>

      {state.checkpoints.length > 0 ? (
        <div className="mt-4 rounded-[24px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-chatbox-tertiary">
            Saved checkpoints
          </Text>
          <div className="mt-3 space-y-3">
            {state.checkpoints.map((checkpoint) => (
              <div
                key={checkpoint.checkpointId}
                className="rounded-[20px] border border-chatbox-border-primary bg-chatbox-background-primary p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Text size="sm" fw={700} className="text-chatbox-primary">
                      {checkpoint.label}
                    </Text>
                    <Text size="sm" c="dimmed" className="mt-1 whitespace-pre-wrap">
                      {checkpoint.description}
                    </Text>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${getCheckpointToneClasses(
                      checkpoint
                    )}`}
                  >
                    {checkpoint.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-chatbox-tertiary">
                  <span>{checkpoint.savedAtLabel}</span>
                  {checkpoint.locationLabel ? <span>{checkpoint.locationLabel}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showCompletionCard ? (
        <div className="mt-4 rounded-[24px] border border-emerald-300 bg-emerald-50/80 p-4 dark:border-emerald-700 dark:bg-emerald-950/20">
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-emerald-700 dark:text-emerald-300">
            Completion handoff
          </Text>
          <Text size="sm" fw={700} className="mt-2 whitespace-pre-wrap text-chatbox-primary">
            {completion?.title || 'Draft returned to chat'}
          </Text>
          <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
            {completion?.description ||
              'The host kept the latest Story Builder draft, save checkpoint, and next step visible in the thread.'}
          </Text>
          {completion?.handoffLabel ? (
            <Text size="xs" c="dimmed" className="mt-3">
              Handoff: {completion.handoffLabel}
            </Text>
          ) : null}
          {completion?.nextStepLabel ? (
            <Text size="xs" c="dimmed">
              Next step: {completion.nextStepLabel}
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
