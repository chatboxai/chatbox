import type { SandboxProvider } from '@shared/sandbox-provider'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const {
  cancelUserExecMock,
  resolveCommandRetryMock,
  resolveUserExecCwdMock,
  sandboxKillMock,
  trackFullAccessBypassMock,
  userExecMock,
} = vi.hoisted(() => ({
  cancelUserExecMock: vi.fn(),
  resolveCommandRetryMock: vi.fn(),
  resolveUserExecCwdMock: vi.fn(),
  sandboxKillMock: vi.fn(),
  trackFullAccessBypassMock: vi.fn(),
  userExecMock: vi.fn(),
}))

vi.mock('@/analytics/agent-mode', () => ({
  trackAgentModeFullAccessBypass: trackFullAccessBypassMock,
}))

vi.mock('@/platform', () => ({
  default: { sandboxKill: sandboxKillMock },
}))

vi.mock('@/packages/skills/controller', () => ({
  skillsController: {
    cancelUserExec: cancelUserExecMock,
    resolveCommandRetry: resolveCommandRetryMock,
    resolveUserExecCwd: resolveUserExecCwdMock,
    userExec: userExecMock,
  },
}))

import { buildRunCommandTool } from './run-command'

async function toModelOutput(tool: unknown, output: unknown) {
  const mapper = tool as {
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => Promise<unknown> | unknown
  }
  return await mapper.toModelOutput({ toolCallId: 'tool-call-id', input: {}, output })
}

function createProvider(runCommand: SandboxProvider['runCommand']): SandboxProvider {
  return {
    runCommand,
    getStatus: vi.fn().mockResolvedValue({ initialized: true, workingDirectory: '/sandbox/session-1' }),
    getAcceptedExtraWritableDirs: vi.fn().mockReturnValue(['/workspace/project']),
    copyFileIn: vi.fn().mockResolvedValue({
      success: true,
      sandboxPath: '/sandbox/session-1/.chatbox-command-output-tool-large.txt',
    }),
  } as unknown as SandboxProvider
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveCommandRetryMock.mockResolvedValue({ valid: true, retryOf: 'tool-failed' })
  resolveUserExecCwdMock.mockImplementation(({ cwd, baseCwd }: { cwd?: string; baseCwd?: string }) => {
    if (!cwd) return baseCwd ?? '/home/user'
    if (cwd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwd)) return cwd
    return `${baseCwd ?? '/home/user'}/${cwd}`
  })
  userExecMock.mockResolvedValue({ success: true, exitCode: 0, stdout: 'host ok', stderr: '' })
})

describe('run_command', () => {
  test('runs sandbox-first without asking and advertises only a recorded failure', async () => {
    const requestSmartApproval = vi.fn()
    const provider = createProvider(
      vi.fn().mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'operation not permitted',
        cwd: '/workspace/project/packages/app',
        retryOf: 'sandbox-retry-failed',
        sandbox: { denied: true, confidence: 'heuristic' },
      })
    )
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'darwin',
      provider,
      ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'smart',
      requestSmartApproval,
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    const result = await tool.execute({ command: 'git status', workdir: 'packages/app' }, {
      toolCallId: 'tool-failed',
      messages: [],
    } as never)
    expect(result).toMatchObject({
      success: false,
      sandboxed: true,
      sandboxDenied: true,
      retryAvailable: true,
      cwd: '/workspace/project/packages/app',
    })
    expect(result).not.toHaveProperty('retryOf')
    await expect(toModelOutput(tool, result)).resolves.toEqual({
      type: 'text',
      value: expect.stringContaining('sandbox_permissions="danger-full-access"'),
    })
    await expect(toModelOutput(tool, result)).resolves.toEqual({
      type: 'text',
      value: expect.not.stringContaining('retry_of'),
    })
    expect(requestSmartApproval).not.toHaveBeenCalled()
    expect(userExecMock).not.toHaveBeenCalled()
  })

  test('does not advertise escalation for a rejected workdir or other unrecorded failure', async () => {
    const provider = createProvider(
      vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'Working directory is not authorized' })
    )
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'linux',
      provider,
      ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'smart',
      requestSmartApproval: vi.fn(),
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    const result = await tool.execute({ command: 'git status', workdir: '/outside' }, {
      toolCallId: 'tool-unrecorded',
      messages: [],
    } as never)
    expect(result).not.toHaveProperty('retryOf')
  })

  test('ignores host retry fields without a matching failure and runs the command in the sandbox first', async () => {
    resolveCommandRetryMock.mockResolvedValueOnce({
      valid: false,
      error: 'No matching sandbox failure is available.',
    })
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'operation not permitted',
      cwd: '/workspace/project',
      retryOf: 'sandbox-retry-after-premature-escalation',
      sandbox: { denied: true, confidence: 'heuristic' },
    })
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'darwin',
      provider: createProvider(runCommand),
      ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'smart',
      requestSmartApproval: vi.fn(),
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    const result = await tool.execute(
      {
        command: 'gh pr view 1077',
        sandbox_permissions: 'danger-full-access',
        justification: 'GitHub authentication is only available on the host.',
      },
      { toolCallId: 'tool-premature-escalation', messages: [] } as never
    )

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'gh pr view 1077', toolCallId: 'tool-premature-escalation' })
    )
    expect(result).toMatchObject({
      success: false,
      sandboxed: true,
      retryAvailable: true,
      ignoredHostRetryFields: true,
    })
    await expect(toModelOutput(tool, result)).resolves.toEqual({
      type: 'text',
      value: expect.stringContaining(
        'Host retry fields were ignored because no matching sandbox failure was available.'
      ),
    })
    expect(resolveCommandRetryMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      command: 'gh pr view 1077',
      cwd: '/workspace/project',
      shell: 'bash',
    })
    expect(userExecMock).not.toHaveBeenCalled()
  })

  test('rejects incomplete model-facing host retry fields', async () => {
    const runCommand = vi.fn()
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'darwin',
      provider: createProvider(runCommand),
      ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'smart',
      requestSmartApproval: vi.fn(),
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    await expect(
      tool.execute({ command: 'gh pr view 1077', sandbox_permissions: 'danger-full-access' }, {
        toolCallId: 'tool-incomplete-retry',
        messages: [],
      } as never)
    ).rejects.toThrow('sandbox_permissions and justification must be provided together for a host retry')
    expect(runCommand).not.toHaveBeenCalled()
    expect(resolveCommandRetryMock).not.toHaveBeenCalled()
    expect(userExecMock).not.toHaveBeenCalled()
  })

  test('uses the normal host approval path when lazy sandbox setup fails', async () => {
    const requestSmartApproval = vi.fn().mockResolvedValue('ai')
    const runCommand = vi.fn()
    userExecMock.mockResolvedValueOnce({
      success: true,
      exitCode: 0,
      stdout: 'host ok',
      stderr: '',
      cwd: '/workspace/project/packages/app',
    })
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'darwin',
      provider: createProvider(runCommand),
      ensureSandbox: vi.fn().mockResolvedValue({ success: false, error: 'runtime failed to start' }),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'smart',
      requestSmartApproval,
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    await expect(
      tool.execute({ command: 'git status', workdir: 'packages/app' }, {
        toolCallId: 'tool-setup-failure',
        messages: [],
      } as never)
    ).resolves.toMatchObject({
      success: true,
      sandboxed: false,
      stdout: 'host ok',
      cwd: '/workspace/project/packages/app',
    })
    expect(runCommand).not.toHaveBeenCalled()
    expect(requestSmartApproval).toHaveBeenCalledWith(
      'tool-setup-failure',
      'git status',
      undefined,
      '/workspace/project/packages/app'
    )
    expect(userExecMock).toHaveBeenCalledWith(
      'git status',
      expect.objectContaining({
        cwd: '/workspace/project/packages/app',
        baseCwd: '/workspace/project',
        approvalSource: 'ai',
        toolCallId: 'tool-setup-failure',
        injectBundledNode: true,
      })
    )
  })

  test('pauses for user approval when lazy sandbox setup fails in always-ask mode', async () => {
    const requestSmartApproval = vi.fn()
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'linux',
      provider: createProvider(vi.fn()),
      ensureSandbox: vi.fn().mockRejectedValue(new Error('runtime failed to start')),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'always_ask',
      requestSmartApproval,
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    await expect(
      tool.execute({ command: 'git status', workdir: 'packages/app' }, {
        toolCallId: 'tool-setup-user-approval',
        messages: [],
      } as never)
    ).rejects.toMatchObject({
      name: 'UserExecApprovalPausedError',
      toolCallId: 'tool-setup-user-approval',
      workdir: '/workspace/project/packages/app',
    })
    expect(requestSmartApproval).not.toHaveBeenCalled()
    expect(userExecMock).not.toHaveBeenCalled()
  })

  test('re-prompts when the resumed approval was issued for another workdir', async () => {
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'linux',
      provider: createProvider(vi.fn()),
      ensureSandbox: vi.fn().mockResolvedValue({ success: false }),
      workingDirectories: ['/workspace/new'],
      approvalMode: 'always_ask',
      requestSmartApproval: vi.fn(),
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    await expect(
      tool.execute({ command: 'rm relative-file' }, {
        toolCallId: 'tool-changed-workdir',
        messages: [],
        approved: true,
        approvalWorkdir: '/workspace/old',
      } as never)
    ).rejects.toMatchObject({
      name: 'UserExecApprovalPausedError',
      workdir: '/workspace/new',
    })
    expect(userExecMock).not.toHaveBeenCalled()
  })

  test('uses the canonical sandbox cwd for an exact retry after a relative workdir', async () => {
    const provider = createProvider(
      vi.fn().mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'operation not permitted',
        cwd: '/workspace/project/packages/app',
        retryOf: 'sandbox-retry-relative-failure',
        sandbox: { denied: true, confidence: 'heuristic' },
      })
    )
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'darwin',
      provider,
      ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'smart',
      requestSmartApproval: vi.fn(),
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    const failed = await tool.execute({ command: 'git status', workdir: 'packages/app' }, {
      toolCallId: 'tool-relative-failure',
      messages: [],
    } as never)
    if (typeof failed !== 'object' || failed === null || !('cwd' in failed) || typeof failed.cwd !== 'string') {
      throw new Error('run_command did not return a canonical cwd')
    }

    resolveCommandRetryMock.mockResolvedValueOnce({ valid: true, retryOf: 'sandbox-retry-relative-failure' })
    await expect(
      tool.execute(
        {
          command: 'git status',
          workdir: failed.cwd,
          sandbox_permissions: 'danger-full-access',
          justification: 'The sandbox denied access to repository metadata.',
        },
        { toolCallId: 'tool-relative-retry', messages: [] } as never
      )
    ).rejects.toMatchObject({ name: 'CommandEscalationApprovalPausedError' })
    expect(resolveCommandRetryMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      command: 'git status',
      cwd: '/workspace/project/packages/app',
      shell: 'bash',
    })
  })

  test('pauses an exact escalation for explicit one-shot user approval', async () => {
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'darwin',
      provider: createProvider(vi.fn()),
      ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'smart',
      requestSmartApproval: vi.fn(),
    })
    if (!tool.execute) throw new Error('run_command execute missing')
    const input = {
      command: 'git status',
      workdir: '/workspace/project',
      sandbox_permissions: 'danger-full-access' as const,
      justification: 'The sandbox denied access to repository metadata.',
    }

    await expect(tool.execute(input, { toolCallId: 'tool-retry', messages: [] } as never)).rejects.toMatchObject({
      name: 'CommandEscalationApprovalPausedError',
      toolCallId: 'tool-retry',
      retryOf: 'tool-failed',
    })
    expect(resolveCommandRetryMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      command: 'git status',
      cwd: '/workspace/project',
      shell: 'bash',
    })
    expect(userExecMock).not.toHaveBeenCalled()
  })

  test('executes the approved exact retry once on the host', async () => {
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'darwin',
      provider: createProvider(vi.fn()),
      ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'smart',
      requestSmartApproval: vi.fn(),
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    await expect(
      tool.execute(
        {
          command: 'git status',
          workdir: '/workspace/project',
          sandbox_permissions: 'danger-full-access',
          justification: 'The sandbox denied access to repository metadata.',
        },
        {
          toolCallId: 'tool-retry',
          messages: [],
          approved: true,
          approvalWorkdir: '/workspace/project',
          approvalRetryOf: 'tool-failed',
        } as never
      )
    ).resolves.toMatchObject({ success: true, sandboxed: false, stdout: 'host ok' })
    expect(resolveCommandRetryMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      retryOf: 'tool-failed',
      command: 'git status',
      cwd: '/workspace/project',
      shell: 'bash',
    })
    expect(userExecMock).toHaveBeenCalledWith('git status', {
      cwd: '/workspace/project',
      timeout: 120_000,
      sessionId: 'session-1',
      toolCallId: 'tool-retry',
      approvalSource: 'user',
      retryOf: 'tool-failed',
      shell: 'bash',
      baseCwd: '/workspace/project',
      injectBundledNode: true,
    })
  })

  test('offloads large host output and returns only a combined inline preview', async () => {
    const stdout = 'stdout-line\n'.repeat(2_000)
    const stderr = 'stderr-line\n'.repeat(2_000)
    userExecMock.mockResolvedValueOnce({
      success: false,
      exitCode: 1,
      stdout,
      stderr,
      outputFile: '/tmp/.chatbox-command-output-tool-large.txt',
    })
    const provider = createProvider(vi.fn())
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'darwin',
      provider,
      ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
      workingDirectories: ['/workspace/project'],
      approvalMode: 'full_access',
      requestSmartApproval: vi.fn(),
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    const result = await tool.execute({ command: 'noisy-command' }, {
      toolCallId: 'tool-large',
      messages: [],
    } as never)
    if (
      typeof result !== 'object' ||
      result === null ||
      !('stdout' in result) ||
      typeof result.stdout !== 'string' ||
      !('stderr' in result) ||
      typeof result.stderr !== 'string'
    ) {
      throw new Error('run_command did not return compact text output')
    }

    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(12_000)
    expect(result).toMatchObject({
      success: false,
      outputFile: '/tmp/.chatbox-command-output-tool-large.txt',
    })
    expect(trackFullAccessBypassMock).toHaveBeenCalledWith({ tool: 'run_command' })
    expect(provider.copyFileIn).not.toHaveBeenCalled()
    await expect(toModelOutput(tool, result)).resolves.toEqual({
      type: 'text',
      value: expect.stringContaining('Output capture: /tmp/.chatbox-command-output-tool-large.txt'),
    })
  })

  test('uses smart approval for Windows host commands', async () => {
    const requestSmartApproval = vi.fn().mockResolvedValue('ai')
    const { tool } = buildRunCommandTool({
      sessionId: 'session-1',
      platform: 'win32',
      workingDirectories: ['C:\\workspace\\project'],
      approvalMode: 'smart',
      requestSmartApproval,
    })
    if (!tool.execute) throw new Error('run_command execute missing')

    await tool.execute({ command: 'Get-ChildItem', shell: 'powershell' }, {
      toolCallId: 'tool-windows',
      messages: [],
    } as never)

    expect(requestSmartApproval).toHaveBeenCalledWith(
      'tool-windows',
      'Get-ChildItem',
      undefined,
      'C:\\workspace\\project'
    )
    expect(userExecMock).toHaveBeenCalledWith(
      'Get-ChildItem',
      expect.objectContaining({
        cwd: 'C:\\workspace\\project',
        baseCwd: 'C:\\workspace\\project',
        approvalSource: 'ai',
        injectBundledNode: true,
      })
    )
  })
})
