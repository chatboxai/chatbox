import { GenerationRuntimeStore } from '@chatbox/core/generation'
import type { Message, Session } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import {
  cancelRunningToolCallBatch,
  type GenerationCancellationDependencies,
  stopAllMessageGenerations,
  stopMessageGeneration,
} from './generation-cancellation'

function message(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: 'assistant', contentParts: [], generating: true, ...overrides }
}

function dependencies(
  session: Session,
  runtime: GenerationRuntimeStore,
  overrides: Partial<GenerationCancellationDependencies> = {}
) {
  const removeMessage = vi.fn<GenerationCancellationDependencies['removeMessage']>().mockResolvedValue(undefined)
  const persistMessage = vi.fn<GenerationCancellationDependencies['persistMessage']>().mockResolvedValue(undefined)
  const value: GenerationCancellationDependencies = {
    runtime,
    getSession: vi.fn().mockResolvedValue(session),
    removeMessage,
    persistMessage,
    ...overrides,
  }
  return { value, removeMessage, persistMessage }
}

describe('main generation cancellation', () => {
  it('aborts through the runtime and finalizes the latest cached message', async () => {
    const runtime = new GenerationRuntimeStore()
    const state = runtime.start('session-1', 'message-1')
    const latest = message('message-1', {
      contentParts: [
        { type: 'reasoning', text: 'Checking files', startTime: 15_000 },
        { type: 'text', text: 'latest streamed chunk' },
      ],
      status: [{ type: 'sending_file' }],
    })
    const session: Session = { id: 'session-1', name: 'Session', messages: [latest] }
    const harness = dependencies(session, runtime)

    await stopMessageGeneration('session-1', latest.id, harness.value, 20_000)

    expect(state.abortController.signal.aborted).toBe(true)
    expect(state.abortController.signal.reason).toBe(20_000)
    expect(runtime.get('session-1', latest.id)).toBeUndefined()
    expect(harness.persistMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        id: latest.id,
        generating: false,
        status: [],
        finishReason: 'canceled',
        contentParts: [
          { type: 'reasoning', text: 'Checking files', startTime: 15_000, duration: 5_000 },
          { type: 'text', text: 'latest streamed chunk' },
        ],
      })
    )
  })

  it('keeps the runtime locked while the canceled terminal message is being persisted', async () => {
    const runtime = new GenerationRuntimeStore()
    const active = runtime.start('session-1', 'message-1')
    const latest = message('message-1', {
      contentParts: [{ type: 'text', text: 'partial reply' }],
    })
    const session: Session = { id: 'session-1', name: 'Session', messages: [latest] }
    let releasePersist: () => void = () => undefined
    const persistMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePersist = resolve
        })
    )
    const harness = dependencies(session, runtime, { persistMessage })

    const stop = stopMessageGeneration('session-1', latest.id, harness.value, 20_000)
    await vi.waitFor(() => expect(runtime.get('session-1', latest.id)?.phase).toBe('stopping'))

    expect(active.abortController.signal.aborted).toBe(true)
    expect(persistMessage).toHaveBeenCalledOnce()
    releasePersist()
    await stop

    expect(runtime.get('session-1', latest.id)).toBeUndefined()
  })

  it('retains a runtime that registers while a placeholder Stop reads the Session', async () => {
    const runtime = new GenerationRuntimeStore()
    const latest = message('message-1', {
      contentParts: [{ type: 'text', text: 'partial reply' }],
    })
    const session: Session = { id: 'session-1', name: 'Session', messages: [latest] }
    let releasePersist: () => void = () => undefined
    const persistMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePersist = resolve
        })
    )
    const getSession = vi.fn(() => {
      runtime.start('session-1', latest.id)
      return Promise.resolve(session)
    })
    const harness = dependencies(session, runtime, { getSession, persistMessage })

    const stop = stopMessageGeneration('session-1', latest.id, harness.value, 20_000)
    await vi.waitFor(() => expect(runtime.get('session-1', latest.id)?.phase).toBe('stopping'))

    expect(runtime.get('session-1', latest.id)?.abortController.signal.aborted).toBe(true)
    expect(persistMessage).toHaveBeenCalledOnce()
    releasePersist()
    await stop

    expect(runtime.get('session-1', latest.id)).toBeUndefined()
  })

  it('removes an untouched placeholder even before its runtime is registered', async () => {
    const runtime = new GenerationRuntimeStore()
    const placeholder = message('message-empty')
    const session: Session = { id: 'session-1', name: 'Session', messages: [placeholder] }
    const harness = dependencies(session, runtime)

    await stopMessageGeneration('session-1', placeholder.id, harness.value, 20_000)

    expect(harness.removeMessage).toHaveBeenCalledWith('session-1', placeholder.id)
    expect(harness.persistMessage).not.toHaveBeenCalled()
    expect(runtime.start('session-1', placeholder.id).abortController.signal).toMatchObject({
      aborted: true,
      reason: 20_000,
    })
  })

  it('does not queue an abort or rewrite a generation that completed before Stop loaded its state', async () => {
    const runtime = new GenerationRuntimeStore()
    const completed = message('message-completed', {
      generating: false,
      contentParts: [{ type: 'text', text: 'completed reply' }],
      finishReason: 'stop',
    })
    const session: Session = { id: 'session-1', name: 'Session', messages: [completed] }
    const harness = dependencies(session, runtime)

    await stopMessageGeneration('session-1', completed.id, harness.value, 20_000)

    expect(harness.removeMessage).not.toHaveBeenCalled()
    expect(harness.persistMessage).not.toHaveBeenCalled()
    expect(runtime.start('session-1', completed.id).abortController.signal.aborted).toBe(false)
  })

  it('does not rewrite a terminal reply observed after aborting its last runtime', async () => {
    const runtime = new GenerationRuntimeStore()
    const state = runtime.start('session-1', 'message-completed')
    const completed = message('message-completed', {
      generating: false,
      contentParts: [{ type: 'text', text: 'completed reply' }],
      finishReason: 'stop',
    })
    const session: Session = { id: 'session-1', name: 'Session', messages: [completed] }
    const harness = dependencies(session, runtime)

    await stopMessageGeneration('session-1', completed.id, harness.value, 20_000)

    expect(state.abortController.signal.aborted).toBe(true)
    expect(harness.removeMessage).not.toHaveBeenCalled()
    expect(harness.persistMessage).not.toHaveBeenCalled()
  })

  it('serializes concurrent Stop requests without leaving an abort for the next runtime', async () => {
    const runtime = new GenerationRuntimeStore()
    runtime.start('session-1', 'message-1')
    let currentSession: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [message('message-1', { contentParts: [{ type: 'text', text: 'partial reply' }] })],
    }
    let releasePersist!: () => void
    const persistGate = new Promise<void>((resolve) => {
      releasePersist = resolve
    })
    const getSession = vi.fn(() => Promise.resolve(currentSession))
    const persistMessage = vi.fn<GenerationCancellationDependencies['persistMessage']>(async (_sessionId, value) => {
      await persistGate
      currentSession = { ...currentSession, messages: [value] }
    })
    const harness = dependencies(currentSession, runtime, { getSession, persistMessage })

    const firstStop = stopMessageGeneration('session-1', 'message-1', harness.value, 20_000)
    await vi.waitFor(() => expect(persistMessage).toHaveBeenCalledOnce())
    const secondStop = stopMessageGeneration('session-1', 'message-1', harness.value, 20_001)

    expect(getSession).toHaveBeenCalledOnce()
    releasePersist()
    await Promise.all([firstStop, secondStop])

    expect(getSession).toHaveBeenCalledTimes(2)
    expect(persistMessage).toHaveBeenCalledOnce()
    expect(runtime.start('session-1', 'message-1').abortController.signal.aborted).toBe(false)
  })

  it('stops every active runtime, preserves paused runtimes, and settles all terminal writes', async () => {
    const runtime = new GenerationRuntimeStore()
    const firstRuntime = runtime.start('session-1', 'active-current')
    const secondRuntime = runtime.start('session-1', 'active-history')
    const pausedRuntime = runtime.start('session-1', 'paused-history')
    runtime.setPhase('session-1', 'paused-history', 'paused', pausedRuntime)
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [
        message('active-current', { contentParts: [{ type: 'text', text: 'current' }] }),
        message('placeholder'),
      ],
      threads: [
        {
          id: 'history',
          name: 'History',
          createdAt: 1,
          messages: [
            message('active-history', { contentParts: [{ type: 'text', text: 'history' }] }),
            message('paused-history', { generating: false, contentParts: [{ type: 'text', text: 'paused' }] }),
          ],
        },
      ],
    }
    const persistMessage = vi.fn<GenerationCancellationDependencies['persistMessage']>((_sessionId, value) =>
      value.id === 'active-current' ? Promise.reject(new Error('storage unavailable')) : Promise.resolve()
    )
    const harness = dependencies(session, runtime, { persistMessage })

    await expect(stopAllMessageGenerations('session-1', harness.value, 20_000)).rejects.toThrow(
      'Failed to persist one or more stopped generations'
    )

    expect(firstRuntime.abortController.signal.aborted).toBe(true)
    expect(secondRuntime.abortController.signal.aborted).toBe(true)
    expect(pausedRuntime.abortController.signal.aborted).toBe(false)
    expect(runtime.get('session-1', 'paused-history')?.phase).toBe('paused')
    expect(persistMessage.mock.calls.map((call) => call[1].id).sort()).toEqual(['active-current', 'active-history'])
    expect(harness.removeMessage).toHaveBeenCalledWith('session-1', 'placeholder')
  })

  it('keeps completed tool results while stopping every active sibling', () => {
    const value = message('message-1', {
      contentParts: [
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'tool-completed',
          toolName: 'code_execution',
          result: { stdout: 'done', stderr: '', exitCode: 0 },
        },
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: 'tool-command',
          toolName: 'code_execution',
          args: { code: 'while (true) {}' },
        },
        {
          type: 'tool-call',
          state: 'call',
          toolCallId: 'tool-other',
          toolName: 'read_file',
          args: { file_path: 'later.txt' },
        },
      ],
    })

    const cancelled = cancelRunningToolCallBatch(value, new Set(['tool-completed', 'tool-command', 'tool-other']))

    expect(cancelled.contentParts).toMatchObject([
      {
        state: 'result',
        toolCallId: 'tool-completed',
        result: { stdout: 'done', stderr: '', exitCode: 0 },
      },
      {
        state: 'result',
        toolCallId: 'tool-command',
        result: { success: false, exitCode: 130, stdout: '', stderr: '', cancelled: true },
      },
      {
        state: 'error',
        toolCallId: 'tool-other',
        result: { error: 'Tool execution stopped by user.', cancelled: true },
      },
    ])
  })
})
