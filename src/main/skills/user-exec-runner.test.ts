import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  cancelUserExecCommand,
  createUserExecRunner,
  executeUserExecCommand,
  resolveUserExecCwd,
  type UserExecResult,
} from './user-exec-runner'

const SUCCESS_RESULT: UserExecResult = { success: true, stdout: 'ok', stderr: '', exitCode: 0 }

describe('resolveUserExecCwd', () => {
  it('uses the same absolute cwd for approval previews and execution', () => {
    expect(resolveUserExecCwd({ cwd: 'packages/app', baseCwd: '/workspace/project' })).toBe(
      '/workspace/project/packages/app'
    )
  })
})

describe('createUserExecRunner', () => {
  it('deduplicates concurrent and completed calls in one main-process lifetime', async () => {
    const execute = vi.fn(async () => SUCCESS_RESULT)
    const runner = createUserExecRunner(execute)
    const params = { command: 'touch /tmp/a', sessionId: 'session-a', toolCallId: 'tool-a' }

    const first = runner.run(params)
    const second = runner.run(params)
    await expect(Promise.all([first, second])).resolves.toEqual([SUCCESS_RESULT, SUCCESS_RESULT])
    await expect(runner.run(params)).resolves.toEqual(SUCCESS_RESULT)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects a reused identity with a different command', async () => {
    const execute = vi.fn(async () => SUCCESS_RESULT)
    const runner = createUserExecRunner(execute)

    await runner.run({ command: 'touch /tmp/a', sessionId: 'session-a', toolCallId: 'tool-a' })
    await expect(
      runner.run({ command: 'touch /tmp/b', sessionId: 'session-a', toolCallId: 'tool-a' })
    ).resolves.toMatchObject({ success: false, stderr: expect.stringContaining('different command') })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects a reused identity with a different working directory', async () => {
    const execute = vi.fn(async () => SUCCESS_RESULT)
    const runner = createUserExecRunner(execute)

    await runner.run({ command: 'git status', cwd: 'C:\\repo-a', sessionId: 'session-a', toolCallId: 'tool-a' })
    await expect(
      runner.run({ command: 'git status', cwd: 'C:\\repo-b', sessionId: 'session-a', toolCallId: 'tool-a' })
    ).resolves.toMatchObject({
      success: false,
      stderr: expect.stringContaining('different command or working directory'),
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects a reused identity with a different retry binding', async () => {
    const execute = vi.fn(async () => SUCCESS_RESULT)
    const runner = createUserExecRunner(execute)
    const base = {
      command: 'git status',
      cwd: '/workspace/project',
      sessionId: 'session-a',
      toolCallId: 'tool-a',
      shell: 'bash' as const,
    }

    await runner.run({ ...base, retryOf: 'failed-a' })
    await expect(runner.run({ ...base, retryOf: 'failed-b' })).resolves.toMatchObject({
      success: false,
      stderr: expect.stringContaining('retry binding'),
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not deduplicate calls without a toolCallId', async () => {
    const execute = vi.fn(async () => SUCCESS_RESULT)
    const runner = createUserExecRunner(execute)

    await runner.run({ command: 'touch /tmp/a' })
    await runner.run({ command: 'touch /tmp/a' })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('prunes completed entries after the TTL without evicting in-flight calls', async () => {
    let currentTime = 0
    let finish: ((result: UserExecResult) => void) | undefined
    const execute = vi
      .fn<() => Promise<UserExecResult>>()
      .mockImplementationOnce(
        () =>
          new Promise<UserExecResult>((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(SUCCESS_RESULT)
    const runner = createUserExecRunner(execute, { completedTtlMs: 100, now: () => currentTime })
    const params = { command: 'touch /tmp/a', sessionId: 'session-a', toolCallId: 'tool-a' }

    const first = runner.run(params)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    currentTime = 200
    const duplicateWhileRunning = runner.run(params)
    expect(execute).toHaveBeenCalledTimes(1)
    finish?.(SUCCESS_RESULT)
    await Promise.all([first, duplicateWhileRunning])
    expect(execute).toHaveBeenCalledTimes(1)

    currentTime = 301
    await runner.run(params)
    expect(execute).toHaveBeenCalledTimes(2)
  })
})

describe.skipIf(process.platform === 'win32')('user_exec cancellation', () => {
  it('resolves a relative cwd against the supplied command base', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-user-exec-cwd-'))
    const workDir = path.join(root, 'packages', 'app')
    mkdirSync(workDir, { recursive: true })

    try {
      await expect(
        executeUserExecCommand({ command: 'pwd', cwd: 'packages/app', baseCwd: root })
      ).resolves.toMatchObject({
        success: true,
        stdout: `${realpathSync(workDir)}\n`,
        cwd: workDir,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('exposes the bundled Electron runtime as node when requested', async () => {
    await expect(
      executeUserExecCommand({
        command: `node -e 'process.stdout.write(process.version)'`,
        injectBundledNode: true,
      })
    ).resolves.toMatchObject({ success: true, stdout: process.version, stderr: '', exitCode: 0 })
  })

  it('preserves a failed pipeline status for host run_command execution', async () => {
    await expect(
      executeUserExecCommand({
        command: 'bash -c "exit 7" | tail -1',
        injectBundledNode: true,
      })
    ).resolves.toMatchObject({ success: false, exitCode: 7 })
  })

  it('streams complete large output to a file and returns only an inline preview', async () => {
    const result = await executeUserExecCommand({
      command: `node -e 'process.stdout.write("x".repeat(20000))'`,
      injectBundledNode: true,
      toolCallId: 'large-output',
    })

    expect(result).toMatchObject({ success: true, exitCode: 0, outputFile: expect.any(String) })
    expect(result.stdout.length).toBeLessThanOrEqual(6_000)
    if (!result.outputFile) throw new Error('large command output was not captured')
    try {
      expect(readFileSync(result.outputFile, 'utf8')).toContain('x'.repeat(20_000))
    } finally {
      rmSync(result.outputFile, { force: true })
    }
  })

  it('settles after a short drain window when a background process holds the pipes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-pipe-leak-'))
    const startedAt = Date.now()
    try {
      const result = await executeUserExecCommand({
        command: 'sleep 30 & echo $! > daemon.pid; echo started',
        cwd: root,
        toolCallId: 'pipe-leak',
      })
      expect(Date.now() - startedAt).toBeLessThan(6_000)
      expect(result).toMatchObject({ success: true, exitCode: 0 })
      expect(result.stdout).toContain('started')
    } finally {
      if (existsSync(path.join(root, 'daemon.pid'))) {
        try {
          process.kill(Number(readFileSync(path.join(root, 'daemon.pid'), 'utf8')), 'SIGKILL')
        } catch {}
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['cancel', 'timeout'] as const)('kills SIGTERM-resistant descendants on %s', async (reason) => {
    const root = mkdtempSync(path.join(tmpdir(), 'chatbox-resistant-child-'))
    const pidPath = path.join(root, 'daemon.pid')
    let pid: number | undefined
    const params = {
      command: `bash -c 'trap "" TERM; echo $$ > daemon.pid; while :; do sleep 1; done' & wait`,
      cwd: root,
      sessionId: 'resistant-child',
      toolCallId: reason,
      timeout: reason === 'timeout' ? 2_000 : 15_000,
    }
    const execution = executeUserExecCommand(params)
    try {
      await vi.waitFor(() => expect(existsSync(pidPath)).toBe(true), { timeout: 1_500 })
      pid = Number(readFileSync(pidPath, 'utf8'))
      if (reason === 'cancel') expect(cancelUserExecCommand(params)).toEqual({ killed: true })
      await expect(execution).resolves.toMatchObject({ success: false })
      await vi.waitFor(() => expect(() => process.kill(pid as number, 0)).toThrow(), { timeout: 4_000 })
    } finally {
      cancelUserExecCommand(params)
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
      await execution
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('terminates a running command by session and tool-call identity', async () => {
    const params = {
      command: `printf 'started\\n'; sleep 30`,
      sessionId: 'cancel-session',
      toolCallId: 'cancel-tool',
    }
    const execution = executeUserExecCommand(params)
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(cancelUserExecCommand(params)).toEqual({ killed: true })
    await expect(execution).resolves.toMatchObject({
      success: false,
      stderr: '',
      exitCode: 130,
      cancelled: true,
    })
    expect(cancelUserExecCommand(params)).toEqual({ killed: false })
  })
})
