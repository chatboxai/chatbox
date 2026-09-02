import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { RunCommandFailureReference, RunCommandShell } from '../shared/types/command-execution'

interface FailedCommandEntry extends RunCommandFailureReference {
  sessionId: string
  toolCallId: string
  canonicalCwd: string
  createdAt: number
}

const FAILURE_TTL_MS = 30 * 60 * 1000
const MAX_FAILURES_PER_SESSION = 64
const failedCommands = new Map<string, FailedCommandEntry>()

function failureKey(sessionId: string, retryOf: string): string {
  return JSON.stringify([sessionId, retryOf])
}

function normalizeCwd(cwd: string): string {
  return path.resolve(cwd)
}

function canonicalCwd(cwd: string): string | undefined {
  try {
    return realpathSync.native(cwd)
  } catch {
    return undefined
  }
}

function prune(now = Date.now()): void {
  for (const [key, entry] of failedCommands) {
    if (now - entry.createdAt >= FAILURE_TTL_MS) failedCommands.delete(key)
  }
}

export function recordFailedSandboxCommand(params: {
  sessionId: string
  toolCallId: string
  command: string
  cwd: string
  canonicalCwd: string
  shell: RunCommandShell
}): string {
  prune()
  const retryOf = `sandbox-retry-${randomUUID()}`
  const entry: FailedCommandEntry = {
    retryOf,
    sessionId: params.sessionId,
    toolCallId: params.toolCallId,
    command: params.command,
    cwd: normalizeCwd(params.cwd),
    canonicalCwd: params.canonicalCwd,
    shell: params.shell,
    createdAt: Date.now(),
  }
  failedCommands.set(failureKey(params.sessionId, retryOf), entry)

  const sessionEntries = [...failedCommands.entries()]
    .filter(([, candidate]) => candidate.sessionId === params.sessionId)
    .sort((a, b) => a[1].createdAt - b[1].createdAt)
  for (const [key] of sessionEntries.slice(0, Math.max(0, sessionEntries.length - MAX_FAILURES_PER_SESSION))) {
    failedCommands.delete(key)
  }
  return retryOf
}

export function checkFailedCommandRetry(params: {
  sessionId: string
  retryOf: string
  command: string
  cwd: string
  shell: RunCommandShell
}): { valid: true } | { valid: false; error: string } {
  prune()
  const entry = failedCommands.get(failureKey(params.sessionId, params.retryOf))
  if (!entry) {
    return {
      valid: false,
      error:
        'The referenced sandbox failure is unavailable, expired, or already consumed. Run the exact command in the sandbox again.',
    }
  }
  if (
    entry.command !== params.command ||
    entry.cwd !== normalizeCwd(params.cwd) ||
    entry.canonicalCwd !== canonicalCwd(params.cwd) ||
    entry.shell !== params.shell
  ) {
    return { valid: false, error: 'The escalated command, working directory, and shell must match the failed call.' }
  }
  return { valid: true }
}

export function resolveFailedCommandRetry(params: {
  sessionId: string
  retryOf?: string
  command: string
  cwd: string
  shell: RunCommandShell
}): { valid: true; retryOf: string } | { valid: false; error: string } {
  prune()
  if (params.retryOf) {
    const validation = checkFailedCommandRetry({ ...params, retryOf: params.retryOf })
    return validation.valid ? { valid: true, retryOf: params.retryOf } : validation
  }

  const normalizedCwd = normalizeCwd(params.cwd)
  const resolvedCwd = canonicalCwd(params.cwd)
  let match: FailedCommandEntry | undefined
  for (const entry of failedCommands.values()) {
    if (
      entry.sessionId === params.sessionId &&
      entry.command === params.command &&
      entry.cwd === normalizedCwd &&
      entry.canonicalCwd === resolvedCwd &&
      entry.shell === params.shell &&
      (!match || entry.createdAt >= match.createdAt)
    ) {
      match = entry
    }
  }
  return match
    ? { valid: true, retryOf: match.retryOf }
    : {
        valid: false,
        error: 'No matching sandbox failure is available. Run the exact command in the sandbox first.',
      }
}

export function consumeFailedCommandRetry(params: {
  sessionId: string
  retryOf: string
  command: string
  cwd: string
  shell: RunCommandShell
}): { valid: true } | { valid: false; error: string } {
  const validation = checkFailedCommandRetry(params)
  if (!validation.valid) return validation
  failedCommands.delete(failureKey(params.sessionId, params.retryOf))
  return { valid: true }
}

export function clearFailedCommandRetries(sessionId?: string): void {
  if (!sessionId) {
    failedCommands.clear()
    return
  }
  for (const [key, entry] of failedCommands) {
    if (entry.sessionId === sessionId) failedCommands.delete(key)
  }
}
