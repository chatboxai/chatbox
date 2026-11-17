import type { ModelInterface } from '@shared/models/types'
import type { MessageContentParts } from '@shared/types'
import type { ToolSet } from 'ai'
import type { Message } from '@shared/types'
import { generateTerminalSession } from './generation-host'
import { tool } from 'ai'
import { z } from 'zod'

const DEFAULT_MAX_STEPS = 50
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
const MAX_COMMAND_TIMEOUT_MS = 600_000
const DEFAULT_OUTPUT_BUDGET = 24_000

export interface HeadlessCommandRequest {
  command: string
  workdir?: string
  timeoutMs: number
  toolCallId: string
  signal?: AbortSignal
}

export interface HeadlessCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  cwd: string
  timedOut?: boolean
}

export interface HeadlessCommandExecutor {
  execute(request: HeadlessCommandRequest): Promise<HeadlessCommandResult>
}

export type HeadlessAgentEvent =
  | { type: 'command_started'; toolCallId: string; command: string; workdir?: string }
  | { type: 'command_finished'; toolCallId: string; result: HeadlessCommandResult }

export interface RunHeadlessTerminalAgentOptions {
  model: ModelInterface
  instruction: string
  commandExecutor: HeadlessCommandExecutor
  workingDirectory?: string
  systemPrompt?: string
  maxSteps?: number
  timeoutMs?: number
  commandTimeoutMs?: number
  commandOutputBudget?: number
  signal?: AbortSignal
  onEvent?: (event: HeadlessAgentEvent) => void | Promise<void>
}

export interface HeadlessTerminalAgentResult {
  finalText: string
  finishReason?: string
  status: 'completed' | 'step_limit' | 'timeout' | 'aborted' | 'error'
  error?: string
  profile: 'terminal-only'
  message: Message
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  toolCallCount: number
}

function normalizeTimeout(timeoutMs: number | undefined, fallback: number): number {
  const value = timeoutMs ?? fallback
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('run_command timeoutMs must be a positive number')
  }
  return Math.min(Math.floor(value), MAX_COMMAND_TIMEOUT_MS)
}

function truncateOutput(value: string, budget: number): string {
  if (value.length <= budget) return value
  const marker = '\n... [truncated by Chatbox headless host] ...\n'
  const contentBudget = Math.max(0, budget - marker.length)
  const head = Math.ceil(contentBudget / 2)
  const tail = Math.floor(contentBudget / 2)
  if (budget <= marker.length) return value.slice(0, budget)
  return `${value.slice(0, head)}${marker}${tail > 0 ? value.slice(-tail) : ''}`
}

function compactResult(result: HeadlessCommandResult, budget: number): HeadlessCommandResult {
  const stdoutBudget = result.stderr ? Math.floor(budget / 2) : budget
  const stderrBudget = result.stdout ? budget - stdoutBudget : budget
  return {
    ...result,
    stdout: truncateOutput(result.stdout, stdoutBudget),
    stderr: truncateOutput(result.stderr, stderrBudget),
  }
}

function terminalSystemPrompt(workingDirectory: string | undefined): string {
  return `You are Chatbox running as a headless terminal agent.

Complete the user's task in the provided isolated environment. Use run_command to inspect the environment, modify files, run tests, and verify the result. Continue until the task is actually complete; do not only explain what the user could do.

Command execution is delegated to the host environment. It never runs on the machine hosting Chatbox. Keep command output focused and write large intermediate output to files.

${workingDirectory ? `The default task working directory is ${workingDirectory}.` : 'Use the task working directory supplied by the host.'}`
}

function finalTextFromParts(parts: MessageContentParts): string {
  return parts
    .filter((part): part is Extract<MessageContentParts[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export async function runHeadlessTerminalAgent(
  options: RunHeadlessTerminalAgentOptions
): Promise<HeadlessTerminalAgentResult> {
  const commandTimeoutMs = normalizeTimeout(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS)
  const positiveInteger = (value: number, name: string) => {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
    return value
  }
  const maxSteps = positiveInteger(options.maxSteps ?? DEFAULT_MAX_STEPS, 'maxSteps')
  const timeoutMs = positiveInteger(options.timeoutMs ?? 900_000, 'timeoutMs')
  const outputBudget = positiveInteger(options.commandOutputBudget ?? DEFAULT_OUTPUT_BUDGET, 'commandOutputBudget')
  const controller = new AbortController()
  const deadline = Date.now() + timeoutMs
  let timedOut = false
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  let toolCallCount = 0

  const runCommand = tool({
    description:
      'Run a Bash command in the isolated task environment. Use workdir to select a directory inside that environment.',
    inputSchema: z.object({
      command: z.string().min(1),
      workdir: z.string().min(1).optional(),
      timeoutMs: z.number().positive().optional(),
    }),
    execute: async (input, toolOptions) => {
      const workdir = input.workdir ?? options.workingDirectory
      const request: HeadlessCommandRequest = {
        command: input.command,
        ...(workdir ? { workdir } : {}),
        timeoutMs: Math.max(1, Math.min(normalizeTimeout(input.timeoutMs, commandTimeoutMs), deadline - Date.now())),
        toolCallId: toolOptions.toolCallId,
        signal: toolOptions.abortSignal,
      }
      toolCallCount += 1
      await options.onEvent?.({
        type: 'command_started',
        toolCallId: request.toolCallId,
        command: request.command,
        ...(request.workdir ? { workdir: request.workdir } : {}),
      })
      const result = compactResult(await options.commandExecutor.execute(request), outputBudget)
      await options.onEvent?.({ type: 'command_finished', toolCallId: request.toolCallId, result })
      return result
    },
  })

  const tools: ToolSet = { run_command: runCommand }
  try {
    const result = await generateTerminalSession({
      model: options.model,
      instruction: options.instruction,
      systemPrompt: options.systemPrompt ?? terminalSystemPrompt(options.workingDirectory),
      tools,
      maxSteps,
      signal: controller.signal,
    })
    return {
      profile: 'terminal-only',
      status: timedOut
        ? 'timeout'
        : controller.signal.aborted
          ? 'aborted'
          : result.error
            ? 'error'
            : result.finishReason === 'tool-calls'
              ? 'step_limit'
              : 'completed',
      error: result.error,
      message: result,
      finalText: finalTextFromParts(result.contentParts),
      finishReason: result.finishReason,
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
          }
        : undefined,
      toolCallCount,
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
