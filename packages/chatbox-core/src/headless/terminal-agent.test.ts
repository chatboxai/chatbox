import type { ChatStreamOptions, ModelInterface, ModelStreamPart } from '@shared/models/types'
import type { ModelMessage, ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { runHeadlessTerminalAgent } from './terminal-agent'

function model(
  stream: (messages: ModelMessage[], options: ChatStreamOptions) => AsyncGenerator<ModelStreamPart>
): ModelInterface {
  return {
    name: 'Mock',
    modelId: 'mock',
    isSupportVision: () => false,
    isSupportToolUse: () => true,
    isSupportSystemMessage: () => true,
    normalizeCompletedResponse: (parts) => parts,
    chat: vi.fn(() => {
      throw new Error('Headless must use GenerationService streaming')
    }),
    paint: vi.fn(() => {
      throw new Error('Unsupported')
    }),
    chatStream: stream,
  }
}
const commandResult = { exitCode: 0, stdout: 'ok\n', stderr: '', cwd: '/app' }

describe('runHeadlessTerminalAgent production orchestration', () => {
  it('delegates commands and persists streamed text and tool output through GenerationService', async () => {
    const execute = vi.fn(async () => commandResult)
    const implementation = model(async function* (messages, options) {
      expect(messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('/app') })
      expect(options.maxSteps).toBe(7)
      const command = options.tools?.run_command
      if (!command?.execute) throw new Error('run_command is missing')
      const input = { command: 'pwd' }
      yield { type: 'tool-call', toolName: 'run_command', toolCallId: 'call-1', input } as ModelStreamPart
      const output = await command.execute(input, {
        toolCallId: 'call-1',
        messages,
        context: undefined,
        abortSignal: options.signal,
      })
      yield { type: 'tool-result', toolName: 'run_command', toolCallId: 'call-1', input, output } as ModelStreamPart
      yield { type: 'text-delta', text: 'Task complete.' } as ModelStreamPart
      yield {
        type: 'finish',
        finishReason: 'stop',
        totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      } as ModelStreamPart
    })
    const result = await runHeadlessTerminalAgent({
      model: implementation,
      instruction: 'Finish the task',
      workingDirectory: '/app',
      maxSteps: 7,
      commandExecutor: { execute },
    })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pwd', workdir: '/app', toolCallId: 'call-1' })
    )
    expect(implementation.chat).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      finalText: 'Task complete.',
      finishReason: 'stop',
      status: 'completed',
      toolCallCount: 1,
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    expect(result.message.contentParts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'tool-call', toolCallId: 'call-1' })])
    )
  })

  it.each([
    ['stop', 'completed'],
    ['tool-calls', 'step_limit'],
  ] as const)('maps %s without claiming verifier success', async (finishReason, status) => {
    const result = await runHeadlessTerminalAgent({
      model: model(async function* () {
        yield { type: 'finish', finishReason } as ModelStreamPart
      }),
      instruction: 'test',
      commandExecutor: { execute: async () => commandResult },
    })
    expect(result.status).toBe(status)
  })

  it('preserves model errors', async () => {
    const result = await runHeadlessTerminalAgent({
      model: model(async function* () {
        throw new Error('provider failure')
      }),
      instruction: 'test',
      commandExecutor: { execute: async () => commandResult },
    })
    expect(result).toMatchObject({ status: 'error', error: 'provider failure' })
  })

  it('aborts the production stream when the run budget expires', async () => {
    const result = await runHeadlessTerminalAgent({
      model: model(async function* (_messages, options) {
        await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => resolve(), { once: true }))
      }),
      instruction: 'test',
      timeoutMs: 20,
      commandExecutor: { execute: async () => commandResult },
    })
    expect(result.status).toBe('timeout')
  })

  it('honors cancellation before generation begins', async () => {
    const signal = AbortSignal.abort()
    const execute = vi.fn(async () => commandResult)
    const result = await runHeadlessTerminalAgent({
      model: model(async function* () {
        throw new Error('must not run')
      }),
      instruction: 'test',
      signal,
      commandExecutor: { execute },
    })
    expect(result.status).toBe('aborted')
    expect(execute).not.toHaveBeenCalled()
  })

  it('forwards external cancellation to an active executor and stops further commands', async () => {
    const controller = new AbortController()
    let entered: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let canceled = false
    const execute = vi.fn(async (request: { signal?: AbortSignal }) => {
      entered()
      await new Promise<void>((_resolve, reject) => {
        request.signal?.addEventListener(
          'abort',
          () => {
            canceled = true
            reject(new Error('Command canceled'))
          },
          { once: true }
        )
      })
      return commandResult
    })
    const implementation = model(async function* (messages, options) {
      const command = options.tools?.run_command
      if (!command?.execute) throw new Error('missing tool')
      await command.execute(
        { command: 'sleep 100' },
        { toolCallId: 'running', messages, context: undefined, abortSignal: options.signal }
      )
      await command.execute(
        { command: 'must not run' },
        { toolCallId: 'later', messages, context: undefined, abortSignal: options.signal }
      )
    })
    const pending = runHeadlessTerminalAgent({
      model: implementation,
      instruction: 'test',
      signal: controller.signal,
      commandExecutor: { execute },
    })
    await started
    controller.abort()
    expect((await pending).status).toBe('aborted')
    expect(canceled).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid budgets before generation', async () => {
    await expect(
      runHeadlessTerminalAgent({
        model: model(async function* () {}),
        instruction: 'test',
        maxSteps: Number.NaN,
        commandExecutor: { execute: async () => commandResult },
      })
    ).rejects.toThrow('maxSteps')
  })

  it('bounds output including tiny budgets', async () => {
    const implementation = model(async function* (messages, options) {
      const tool = options.tools?.run_command
      if (!tool?.execute) throw new Error('missing tool')
      const output = await tool.execute(
        { command: 'test' },
        { toolCallId: 'bounded', messages, context: undefined, abortSignal: options.signal }
      )
      expect(output).toMatchObject({ stdout: 'abc', stderr: '' })
      yield { type: 'finish', finishReason: 'stop' } as ModelStreamPart<ToolSet>
    })
    await runHeadlessTerminalAgent({
      model: implementation,
      instruction: 'test',
      commandOutputBudget: 3,
      commandExecutor: { execute: async () => ({ ...commandResult, stdout: 'abcdef' }) },
    })
  })
})
