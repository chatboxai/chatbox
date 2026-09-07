import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  checkFailedCommandRetry,
  clearFailedCommandRetries,
  consumeFailedCommandRetry,
  recordFailedSandboxCommand,
  resolveFailedCommandRetry,
} from './command-execution-policy'

const failedCommand = {
  sessionId: 'session-1',
  toolCallId: 'tool-failed',
  command: 'git status',
  cwd: tmpdir(),
  canonicalCwd: realpathSync.native(tmpdir()),
  shell: 'bash' as const,
}

beforeEach(() => clearFailedCommandRetries())

describe('failed sandbox command retry policy', () => {
  test('accepts and consumes one exact same-session retry', () => {
    const retryOf = recordFailedSandboxCommand(failedCommand)
    const retry = {
      sessionId: failedCommand.sessionId,
      retryOf,
      command: failedCommand.command,
      cwd: path.join(failedCommand.cwd, '.'),
      shell: failedCommand.shell,
    }

    expect(checkFailedCommandRetry(retry)).toEqual({ valid: true })
    expect(consumeFailedCommandRetry(retry)).toEqual({ valid: true })
    expect(checkFailedCommandRetry(retry)).toMatchObject({ valid: false })
  })

  test('issues an opaque reference instead of accepting the sandbox tool call id', () => {
    const retryOf = recordFailedSandboxCommand(failedCommand)

    expect(retryOf).toMatch(/^sandbox-retry-/)
    expect(retryOf).not.toBe(failedCommand.toolCallId)
    expect(checkFailedCommandRetry({ ...failedCommand, retryOf: failedCommand.toolCallId })).toMatchObject({
      valid: false,
    })
    expect(checkFailedCommandRetry({ ...failedCommand, retryOf })).toEqual({ valid: true })
  })

  test('resolves the latest exact failure without exposing its reference to the model', () => {
    const first = recordFailedSandboxCommand(failedCommand)
    const second = recordFailedSandboxCommand({ ...failedCommand, toolCallId: 'tool-failed-again' })

    expect(resolveFailedCommandRetry(failedCommand)).toEqual({ valid: true, retryOf: second })
    expect(resolveFailedCommandRetry({ ...failedCommand, retryOf: first })).toEqual({ valid: true, retryOf: first })
    expect(resolveFailedCommandRetry({ ...failedCommand, command: 'git diff' })).toMatchObject({ valid: false })
  })

  test.each([
    { sessionId: 'session-2' },
    { command: 'git diff' },
    { cwd: path.join(tmpdir(), 'another-project') },
    { shell: 'powershell' as const },
  ])('rejects a mismatched retry: %o', (override) => {
    const retryOf = recordFailedSandboxCommand(failedCommand)

    expect(
      checkFailedCommandRetry({
        sessionId: failedCommand.sessionId,
        retryOf,
        command: failedCommand.command,
        cwd: failedCommand.cwd,
        shell: failedCommand.shell,
        ...override,
      })
    ).toMatchObject({ valid: false })
  })

  test('rejects a retry when the approved path now resolves to another directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'command-retry-policy-'))
    const original = mkdtempSync(path.join(root, 'original-'))
    const replacement = mkdtempSync(path.join(root, 'replacement-'))
    const link = path.join(root, 'project')
    try {
      symlinkSync(original, link)
      const retryOf = recordFailedSandboxCommand({
        ...failedCommand,
        cwd: link,
        canonicalCwd: realpathSync.native(original),
      })
      rmSync(link)
      symlinkSync(replacement, link)

      expect(checkFailedCommandRetry({ ...failedCommand, retryOf, cwd: link })).toMatchObject({
        valid: false,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('clearing a session invalidates only that session retries', () => {
    const sessionOneRetry = recordFailedSandboxCommand(failedCommand)
    const sessionTwoRetry = recordFailedSandboxCommand({ ...failedCommand, sessionId: 'session-2' })

    clearFailedCommandRetries('session-1')

    expect(checkFailedCommandRetry({ ...failedCommand, retryOf: sessionOneRetry })).toMatchObject({
      valid: false,
    })
    expect(checkFailedCommandRetry({ ...failedCommand, sessionId: 'session-2', retryOf: sessionTwoRetry })).toEqual({
      valid: true,
    })
  })
})
