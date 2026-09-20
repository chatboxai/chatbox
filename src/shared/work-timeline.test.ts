import type { MessageContentParts, MessageReasoningPart, MessageTextPart, MessageToolCallPart } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { WORK_FOREGROUND_REQUIRED } from './mobile-work/execution-feedback'
import { MESSAGE_ERROR_CODES } from './models/errors'
import { SANDBOX_EXEC_ERROR_CODES } from './sandbox-provider'
import {
  buildWorkTimelineEntries,
  getActiveWorkPart,
  getLastWorkStep,
  getTimelinePartKey,
  measureToolCallCluster,
  type StepTimelineOptions,
  type StepTimelinePart,
  stepNeedsUserAction,
} from './work-timeline'

const tool = (id: string): MessageToolCallPart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: 'read_file',
  state: 'result',
  args: {},
  result: {},
})

describe('work timeline partition', () => {
  it('folds an earlier group while another group is streaming', () => {
    const parts = [tool('a'), tool('b')]
    const active = { type: 'text', text: 'Answer' } as const
    const activePart = getActiveWorkPart({ generating: true, contentParts: [...parts, active] })
    expect(buildWorkTimelineEntries(parts, { generating: true, activePart })).toEqual([
      { type: 'cluster', steps: parts.map((part, index) => ({ part, index })) },
    ])
  })

  it('keeps the active reasoning visible even with a protocol-only suffix', () => {
    const parts = [tool('a'), tool('b'), { type: 'reasoning', text: 'Thinking' } as const]
    const activePart = getActiveWorkPart({
      generating: true,
      contentParts: [...parts, { type: 'text', text: '', protocolOnly: true }],
    })
    expect(activePart).toBe(parts[2])
    expect(buildWorkTimelineEntries(parts, { activePart }).map((entry) => entry.type)).toEqual(['cluster', 'part'])
  })

  it('does not move work across an attention boundary', () => {
    const parts = [tool('a'), tool('b'), { ...tool('paused'), state: 'paused' as const }, tool('c'), tool('d')]
    const entries = buildWorkTimelineEntries(parts)
    expect(entries.map((entry) => entry.type)).toEqual(['cluster', 'part', 'cluster'])
    expect(
      entries.flatMap((entry) => (entry.type === 'part' ? [entry.part] : entry.steps.map((step) => step.part)))
    ).toEqual(parts)
  })

  it('handles an empty timeline and explicit absence of an active part', () => {
    expect(buildWorkTimelineEntries([])).toEqual([])
    expect(getActiveWorkPart({ generating: false, contentParts: [tool('a')] })).toBeNull()
    expect(buildWorkTimelineEntries([tool('a'), tool('b')], { generating: true, activePart: null })[0].type).toBe(
      'cluster'
    )
  })

  it('keys tool steps by identity rather than array position', () => {
    expect(getTimelinePartKey(tool('a'), 0)).toBe(getTimelinePartKey(tool('a'), 8))
    expect(getTimelinePartKey(tool('a'), 0)).not.toBe(getTimelinePartKey(tool('b'), 0))
  })

  it('ignores non-finite and negative duration values', () => {
    const parts = [500, Infinity, NaN, -20].map((duration, index) => ({
      part: { ...tool(String(index)), duration },
      index,
    }))
    expect(measureToolCallCluster(parts)).toBe(500)
  })
})

describe('shared attention policy', () => {
  const types = (parts: readonly StepTimelinePart[], options?: StepTimelineOptions) =>
    buildWorkTimelineEntries(parts, options).map((entry) => entry.type)

  it('skips protocol-only reasoning when finding the last work step', () => {
    const stopped = {
      ...tool('stopped'),
      toolName: 'run_command',
      result: { cancelled: true, exitCode: 130 },
    }
    const hidden = { type: 'reasoning' as const, text: '', protocolOnly: true as const }
    expect(getLastWorkStep([tool('a'), stopped, hidden])).toBe(stopped)
  })

  it('folds a cancelled command when lastStep is an explicit null', () => {
    const stopped = {
      ...tool('stopped'),
      toolName: 'run_command',
      result: { cancelled: true, exitCode: 130 },
    }
    expect(types([tool('a'), stopped], { lastStep: null })).toEqual(['cluster'])
  })

  it('lifts a cancelled command only when it is the message last step, including across a split group', () => {
    const stopped = {
      ...tool('stopped'),
      toolName: 'run_command',
      result: { cancelled: true, exitCode: 130 },
    }
    const group = [tool('a'), stopped]
    const later = tool('later')
    expect(types(group)).toEqual(['part', 'part'])
    expect(types(group, { lastStep: later })).toEqual(['cluster'])
    expect(types(group, { lastStep: stopped })).toEqual(['part', 'part'])
  })

  it('lifts a JSON-string cancelled command that ends the message', () => {
    const stopped = {
      ...tool('stopped'),
      toolName: 'run_command',
      result: JSON.stringify({ cancelled: true, exitCode: 130 }),
    }
    expect(types([tool('a'), stopped])).toEqual(['part', 'part'])
  })

  it('lifts a stopped command whose payload was offloaded, only on a message the user stopped', () => {
    // A stopped command over the size limit keeps a truncated prefix inline, so its own
    // `cancelled` marker is unreadable and the message's cancel marker decides.
    const stopped = {
      ...tool('stopped'),
      toolName: 'run_command',
      result: '{"success":false,"exitCode":130,"stdout":"line 1\\nline 2',
      resultStorageKey: 'blob:stopped',
    }
    expect(types([tool('a'), stopped], { canceled: true })).toEqual(['part', 'part'])
    expect(types([tool('a'), stopped])).toEqual(['cluster'])
    expect(types([tool('a'), stopped], { canceled: true, lastStep: tool('later') })).toEqual(['cluster'])
  })

  it('folds a step whose result is unreadable but was never offloaded', () => {
    const garbled = { ...tool('garbled'), toolName: 'run_command', result: 'not json' }
    expect(types([tool('a'), garbled], { canceled: true })).toEqual(['cluster'])
  })

  it('lifts sandbox bash-unavailable and known API errors, and folds unknown tool errors', () => {
    expect(
      types([tool('a'), { ...tool('bash'), result: { errorCode: SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE } }])
    ).toEqual(['part', 'part'])
    expect(
      types([
        tool('a'),
        {
          ...tool('quota'),
          state: 'error',
          result: { errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED },
        },
      ])
    ).toEqual(['part', 'part'])
    expect(types([tool('a'), { ...tool('unknown'), state: 'error', result: { errorCode: 99999 } }])).toEqual([
      'cluster',
    ])
  })

  it('lifts a foreground-required failure however the marker is carried', () => {
    for (const result of [{ error: WORK_FOREGROUND_REQUIRED }, WORK_FOREGROUND_REQUIRED] as const) {
      expect(types([tool('a'), tool('b'), { ...tool('fg'), state: 'error', result }])).toEqual(['cluster', 'part'])
    }
  })

  it('lifts an accepted background image task and folds a completed image status poll', () => {
    expect(
      types([
        tool('a'),
        {
          ...tool('gen'),
          toolName: 'chatbox_cli',
          args: { argv: ['image', 'generate', 'a cat'] },
          result: {
            ok: true,
            command: 'image generate',
            accepted: true,
            background: true,
            recordId: 'record-1',
            status: 'pending',
            startedAt: 1,
            wait: { mode: 'callback', managedBy: 'chatbox', modelShouldPoll: false },
          },
        },
      ])
    ).toEqual(['part', 'part'])
    expect(
      types([
        tool('a'),
        {
          ...tool('status'),
          toolName: 'chatbox_cli',
          args: { argv: ['image', 'status'] },
          result: { ok: true, command: 'image status' },
        },
      ])
    ).toEqual(['cluster'])
  })
})

function toolCall(overrides: Partial<MessageToolCallPart> = {}): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'call-1',
    toolName: 'read_file',
    args: { path: 'src/a.ts' },
    result: { content: 'file body' },
    ...overrides,
  }
}

function reasoning(text: string): MessageReasoningPart {
  return { type: 'reasoning', text }
}

function narration(text: string): MessageTextPart {
  return { type: 'text', text }
}

function indexParts(parts: StepTimelinePart[]) {
  return parts.map((part, index) => ({ part, index }))
}

describe('stepNeedsUserAction', () => {
  it('marks the failures a user has to act on and leaves plain ones alone', () => {
    expect(
      stepNeedsUserAction({ ...tool('bash'), result: { errorCode: SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE } })
    ).toBe(true)
    expect(
      stepNeedsUserAction({
        ...tool('quota'),
        state: 'error',
        result: { errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED },
      })
    ).toBe(true)
    expect(stepNeedsUserAction({ ...tool('fg'), state: 'error', result: WORK_FOREGROUND_REQUIRED })).toBe(true)
    expect(stepNeedsUserAction({ ...tool('exit'), result: { exitCode: 1, success: false } })).toBe(false)
    expect(stepNeedsUserAction({ ...tool('unknown'), state: 'error', result: { errorCode: 99999 } })).toBe(false)
    expect(stepNeedsUserAction({ type: 'reasoning', text: 'thinking' })).toBe(false)
  })
})

describe('work timeline folding', () => {
  it('folds consecutive thinking and tool calls into one entry', () => {
    const parts = [
      reasoning('Find the caller.'),
      toolCall({ toolCallId: 'call-1' }),
      reasoning('Read the second file too.'),
      toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' } }),
    ]

    const entries = buildWorkTimelineEntries(parts)

    expect(entries).toEqual([{ type: 'cluster', steps: indexParts(parts) }])
  })

  it('keeps a single tool call on its own row', () => {
    const parts = [reasoning('One lookup is enough.'), toolCall()]

    const entries = buildWorkTimelineEntries(parts)

    expect(entries.map((entry) => entry.type)).toEqual(['part', 'part'])
  })

  it.each(['call', 'paused'] as const)('lifts a %s tool call out of the run it sits in', (state) => {
    const parts = [
      toolCall({ toolCallId: 'call-1' }),
      toolCall({ toolCallId: 'call-2', args: { path: 'b' } }),
      toolCall({ toolCallId: 'call-3', state, args: { path: 'c' } }),
    ]

    const entries = buildWorkTimelineEntries(parts)

    // The settled work still folds; only the step the user has to see stands out.
    expect(entries.map((entry) => entry.type)).toEqual(['cluster', 'part'])
    expect(entries[0]).toEqual({ type: 'cluster', steps: indexParts(parts).slice(0, 2) })
  })

  it('keeps folding the work that came before a still-running step', () => {
    const parts = [
      toolCall({ toolCallId: 'call-1' }),
      toolCall({ toolCallId: 'call-2', args: { path: 'b' } }),
      toolCall({ toolCallId: 'call-3', state: 'call', args: { path: 'c' } }),
      toolCall({ toolCallId: 'call-4', args: { path: 'd' } }),
      toolCall({ toolCallId: 'call-5', args: { path: 'e' } }),
    ]

    const entries = buildWorkTimelineEntries(parts)

    expect(entries.map((entry) => entry.type)).toEqual(['cluster', 'part', 'cluster'])
  })

  it('keeps the newest step visible while the message is still generating', () => {
    const parts = [
      toolCall({ toolCallId: 'call-1' }),
      toolCall({ toolCallId: 'call-2', args: { path: 'b' } }),
      reasoning('Working out the next move.'),
    ]

    expect(buildWorkTimelineEntries(parts, { generating: true }).map((entry) => entry.type)).toEqual([
      'cluster',
      'part',
    ])
    // Once the message settles, the whole run folds together.
    expect(buildWorkTimelineEntries(parts).map((entry) => entry.type)).toEqual(['cluster'])
  })

  it('folds failed commands and tool errors with the run they sit in', () => {
    const parts = [
      toolCall({ toolCallId: 'call-1' }),
      toolCall({
        toolCallId: 'call-2',
        toolName: 'run_command',
        args: { command: 'grep -r missing src' },
        result: { success: false, exitCode: 1 },
      }),
      toolCall({
        toolCallId: 'call-3',
        toolName: 'run_command',
        args: { command: 'pnpm build' },
        result: { success: false, exitCode: null, stderr: 'timed out' },
      }),
      toolCall({
        toolCallId: 'call-4',
        toolName: 'run_command',
        args: { command: 'pnpm test' },
        state: 'error',
        result: { error: 'No sandbox working directory is available' },
      }),
    ]

    expect(buildWorkTimelineEntries(parts).map((entry) => entry.type)).toEqual(['cluster'])
  })

  it('lifts a command the user stopped as the last step out of the run', () => {
    const parts = [
      toolCall({ toolCallId: 'call-1' }),
      toolCall({ toolCallId: 'call-0', args: { path: 'src/c.ts' } }),
      toolCall({
        toolCallId: 'call-2',
        toolName: 'run_command',
        args: { command: 'pnpm test' },
        result: { success: false, exitCode: 130, cancelled: true },
      }),
      narration('Stopped.'),
    ]

    expect(buildWorkTimelineEntries(parts).map((entry) => entry.type)).toEqual(['cluster', 'part', 'part'])
  })

  it('folds a stopped command once later steps follow it', () => {
    const parts = [
      toolCall({ toolCallId: 'call-1' }),
      toolCall({
        toolCallId: 'call-2',
        toolName: 'run_command',
        args: { command: 'pnpm test' },
        result: { success: false, exitCode: 130, cancelled: true },
      }),
      toolCall({ toolCallId: 'call-3', args: { path: 'src/c.ts' } }),
    ]

    expect(buildWorkTimelineEntries(parts).map((entry) => entry.type)).toEqual(['cluster'])
  })

  it('folds a stopped command the message carried on past, even in the slice that ends on it', () => {
    const stopped = toolCall({
      toolCallId: 'call-2',
      toolName: 'run_command',
      args: { command: 'pnpm test' },
      result: { success: false, exitCode: 130, cancelled: true },
    })
    const group = [toolCall({ toolCallId: 'call-1' }), stopped]
    // An image splits the run, so the group holding the stopped command ends on it
    // while the message itself carries on with two more steps.
    const message: MessageContentParts = [
      ...group,
      { type: 'image' as const, storageKey: 'img-1' },
      toolCall({ toolCallId: 'call-3' }),
      toolCall({ toolCallId: 'call-4' }),
    ]

    expect(buildWorkTimelineEntries(group).map((entry) => entry.type)).toEqual(['part', 'part'])
    // The message's own last step is the one the run should single out, so the
    // stopped command is folded away even though this group ends on it.
    expect(buildWorkTimelineEntries(group, { lastStep: getLastWorkStep(message) }).map((entry) => entry.type)).toEqual([
      'cluster',
    ])
  })

  it('keeps a command the message really did end on beside the run', () => {
    const stopped = toolCall({
      toolCallId: 'call-2',
      toolName: 'run_command',
      args: { command: 'pnpm test' },
      result: { success: false, exitCode: 130, cancelled: true },
    })
    const group = [toolCall({ toolCallId: 'call-1' }), stopped]

    expect(buildWorkTimelineEntries(group, { lastStep: getLastWorkStep(group) }).map((entry) => entry.type)).toEqual([
      'part',
      'part',
    ])
  })

  it('lifts a step the message left in the background out of the run, however its result is carried', () => {
    for (const result of [{ error: WORK_FOREGROUND_REQUIRED }, WORK_FOREGROUND_REQUIRED] as const) {
      const parts = [
        toolCall({ toolCallId: 'call-1' }),
        toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' } }),
        toolCall({ toolCallId: 'call-3', args: { path: 'src/c.ts' }, state: 'error', result }),
      ]

      const entries = buildWorkTimelineEntries(parts)

      expect(entries.map((entry) => entry.type)).toEqual(['cluster', 'part'])
      expect(entries[0]).toEqual({ type: 'cluster', steps: indexParts(parts).slice(0, 2) })
    }
  })

  it('keeps a run with an image generation task unfolded', () => {
    const parts = [
      toolCall({ toolCallId: 'call-1' }),
      toolCall({
        toolCallId: 'call-2',
        toolName: 'chatbox_cli',
        args: { command: 'image generate' },
        result: {
          ok: true,
          command: 'image generate',
          accepted: true,
          background: true,
          recordId: 'record-1',
          status: 'pending',
          startedAt: 1,
          wait: { mode: 'callback', managedBy: 'chatbox', modelShouldPoll: false },
        },
      }),
    ]

    const entries = buildWorkTimelineEntries(parts)

    expect(entries.map((entry) => entry.type)).toEqual(['part', 'part'])
  })

  it('treats narrative text as the boundary between folds', () => {
    const parts = [
      toolCall({ toolCallId: 'call-1' }),
      toolCall({ toolCallId: 'call-2' }),
      narration('Now I will check the tests.'),
      toolCall({ toolCallId: 'call-3' }),
      toolCall({ toolCallId: 'call-4' }),
    ]

    const entries = buildWorkTimelineEntries(parts)

    expect(entries.map((entry) => entry.type)).toEqual(['cluster', 'part', 'cluster'])
  })
})

describe('measureToolCallCluster', () => {
  it('adds up the durations the run reported', () => {
    const parts = [
      toolCall({ toolCallId: 'call-1', duration: 1200 }),
      reasoning('Check the output.'),
      toolCall({ toolCallId: 'call-2', args: { path: 'src/b.ts' }, duration: 2400 }),
    ]

    expect(measureToolCallCluster(indexParts(parts))).toBe(3600)
  })

  it('ignores steps that never reported a duration', () => {
    const parts = [toolCall({ toolCallId: 'call-1' }), toolCall({ toolCallId: 'call-2', duration: 0 })]

    expect(measureToolCallCluster(indexParts(parts))).toBe(0)
  })
})
