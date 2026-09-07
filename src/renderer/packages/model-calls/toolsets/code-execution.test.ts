// @ts-nocheck — test file with heavily mocked types

import { sandboxAttachmentParsedRelPath, sandboxAttachmentRelPath } from '@shared/sandbox/attachment-path'
import { SANDBOX_EXEC_ERROR_CODES } from '@shared/sandbox-provider'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { sandboxKillMock } = vi.hoisted(() => ({ sandboxKillMock: vi.fn() }))

vi.mock('@/lib/utils', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/platform', () => ({
  default: { type: 'desktop', sandboxKill: sandboxKillMock },
}))

import { buildCodeExecutionTools } from './code-execution'

const createMockProvider = () => ({
  type: 'local' as const,
  init: vi.fn().mockResolvedValue({ success: true }),
  reset: vi.fn(),
  getStatus: vi.fn().mockResolvedValue({ initialized: true }),
  copyFileIn: vi.fn().mockResolvedValue({ success: true }),
  copyBlobIn: vi.fn().mockResolvedValue({ success: true }),
  readFileOut: vi.fn().mockResolvedValue({ success: true, content: 'test content' }),
  exportFile: vi.fn().mockResolvedValue({ success: true }),
  persistArtifact: vi.fn().mockResolvedValue({ success: true, artifactPath: '/durable/artifact' }),
  exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  checkAvailability: vi.fn().mockResolvedValue({ available: true }),
})

async function toModelOutput(tool: unknown, output: unknown) {
  const mapper = tool as {
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => Promise<unknown> | unknown
  }
  return await mapper.toModelOutput({ toolCallId: 'tool-call-id', input: {}, output })
}

describe('buildCodeExecutionTools', () => {
  let mockProvider: ReturnType<typeof createMockProvider>

  beforeEach(() => {
    mockProvider = createMockProvider()
    vi.clearAllMocks()
  })

  test('returns tools and description', () => {
    const result = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    expect(result.tools).toBeDefined()
    expect(result.description).toBeDefined()
    expect(typeof result.description).toBe('string')
    expect(result.description.length).toBeGreaterThan(0)
  })

  test('description explains Node/PowerShell/Bash runtime and discourages installs', () => {
    const result = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })

    expect(result.description).toContain('Available Runtime')
    expect(result.description).toContain('Node.js')
    expect(result.description).toContain('Bash')
    expect(result.description).toContain('PowerShell')
    expect(result.description).toContain('Node.js built-ins')
    expect(result.description).toContain('standalone HTML with inline SVG or Canvas')
    expect(result.description).toContain('Python is not available')
    expect(result.description).toContain('Package Installation')
    expect(result.description).toContain('Avoid installing packages')
    expect(result.description).toContain('Do not use sudo, apt, brew')
  })

  test('description keeps file tag guidance aligned with injected context', () => {
    const result = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })

    expect(result.description).toContain('<ATTACHMENT_FILE>')
    expect(result.description).toContain('<SANDBOX_PATH>')
    expect(result.description).toContain('<PARSED_SANDBOX_PATH>')
  })

  test('returns code_execution tool', () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    expect(tools.code_execution).toBeDefined()
  })

  test('returns read_file tool', () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    expect(tools.read_file).toBeDefined()
  })

  test('does not return parse_file tool (removed — files are pre-parsed)', () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    expect(tools.parse_file).toBeUndefined()
  })

  test('returns create_download tool', () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    expect(tools.create_download).toBeDefined()
  })

  test('code_execution tool calls provider.init on first execute (lazy init)', async () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })

    expect(mockProvider.init).not.toHaveBeenCalled()

    const tool = tools.code_execution as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>
    }
    await tool.execute({ code: 'console.log("hello")', language: 'node' }, {})

    expect(mockProvider.init).toHaveBeenCalledWith('test-session')
  })

  test('code_execution tool calls provider.exec with the code and language', async () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>
    }

    await tool.execute({ code: 'console.log("hello world")', language: 'node' }, {})

    expect(mockProvider.exec).toHaveBeenCalledWith({
      code: 'console.log("hello world")',
      language: 'node',
      timeout: expect.any(Number),
    })
  })

  test('code_execution forwards toolCallId for operation-log correlation', async () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>
    }

    await tool.execute({ code: 'console.log("hello world")', language: 'node' }, { toolCallId: 'tool-call-1' })

    expect(mockProvider.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-1',
      })
    )
  })

  test('code_execution forwards PowerShell as a first-class execution language', async () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>
    }

    await tool.execute({ code: "Write-Output 'hello'", language: 'powershell' }, {})

    expect(mockProvider.exec).toHaveBeenCalledWith({
      code: "Write-Output 'hello'",
      language: 'powershell',
      timeout: expect.any(Number),
    })
  })

  test('code_execution tool returns stdout, stderr, and exitCode', async () => {
    mockProvider.exec.mockResolvedValue({ stdout: 'hello world\n', stderr: '', exitCode: 0 })
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (
        input: Record<string, unknown>,
        opts: Record<string, unknown>
      ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
    }

    const result = await tool.execute({ code: 'console.log("hello world")', language: 'node' }, {})

    expect(result.stdout).toBe('hello world\n')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
  })

  test('global abort kills the sandbox command and preserves captured output', async () => {
    let finishExecution: ((result: { stdout: string; stderr: string; exitCode: number }) => void) | undefined
    mockProvider.exec.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishExecution = resolve
        })
    )
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (
        input: Record<string, unknown>,
        opts: { abortSignal: AbortSignal; toolCallId: string }
      ) => Promise<{ stdout: string; stderr: string; exitCode: number; cancelled?: boolean }>
    }
    const controller = new AbortController()
    const execution = tool.execute(
      { code: 'while true; do echo tick; done', language: 'bash' },
      { abortSignal: controller.signal, toolCallId: 'tool-call-running' }
    )
    await vi.waitFor(() => expect(mockProvider.exec).toHaveBeenCalledTimes(1))

    controller.abort()
    expect(sandboxKillMock).toHaveBeenCalledWith({
      sessionId: 'test-session',
      toolCallId: 'tool-call-running',
    })
    finishExecution?.({ stdout: 'tick\n', stderr: '', exitCode: 1 })

    await expect(execution).resolves.toEqual({
      stdout: 'tick\n',
      stderr: '',
      exitCode: 130,
      errorCode: undefined,
      cancelled: true,
    })
  })

  test('marks cancellation that happens during sandbox setup', async () => {
    let finishSetup: ((result: { success: boolean }) => void) | undefined
    mockProvider.init.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSetup = resolve
        })
    )
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (
        input: Record<string, unknown>,
        opts: { abortSignal: AbortSignal; toolCallId: string }
      ) => Promise<{ stdout: string; stderr: string; exitCode: number; cancelled?: boolean }>
    }
    const controller = new AbortController()
    const execution = tool.execute(
      { code: 'console.log("never started")', language: 'node' },
      { abortSignal: controller.signal, toolCallId: 'tool-call-setup' }
    )
    await vi.waitFor(() => expect(mockProvider.init).toHaveBeenCalledTimes(1))

    controller.abort()
    finishSetup?.({ success: true })

    await expect(execution).resolves.toEqual({
      stdout: '',
      stderr: '',
      exitCode: 130,
      cancelled: true,
    })
    expect(mockProvider.exec).not.toHaveBeenCalled()
    expect(sandboxKillMock).not.toHaveBeenCalled()
  })

  test('code_execution maps structured output to readable model text', async () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })

    await expect(toModelOutput(tools.code_execution, { stdout: 'hello\n', stderr: '', exitCode: 0 })).resolves.toEqual({
      type: 'text',
      value: 'Exit code: 0\n\nStdout:\nhello\n',
    })
  })

  test('code_execution maps success with no output to an explicit no-output result', async () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })

    await expect(toModelOutput(tools.code_execution, { stdout: '', stderr: '', exitCode: 0 })).resolves.toEqual({
      type: 'text',
      value: 'Exit code: 0\n\n(no output)',
    })
  })

  test('read_file maps content and pagination hint to readable model text', async () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })

    await expect(
      toModelOutput(tools.read_file, {
        content: 'line one',
        hint: '[Showing lines 1-1 of 2. Use offset=2 to continue.]',
      })
    ).resolves.toEqual({
      type: 'text',
      value: 'line one\n\n[Showing lines 1-1 of 2. Use offset=2 to continue.]',
    })
  })

  test('read_file maps empty content to an empty-file result', async () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })

    await expect(toModelOutput(tools.read_file, { content: '' })).resolves.toEqual({
      type: 'text',
      value: 'File is empty.',
    })
  })

  test('read_file delegates bounded reads without invoking Bash', async () => {
    mockProvider.readFileOut.mockResolvedValue({
      success: true,
      content: 'line two',
      startLine: 2,
      endLine: 2,
      totalLines: 3,
    })
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.read_file as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>
    }

    const result = await tool.execute({ file_path: 'report.txt', offset: 2, limit: 1 }, {})

    expect(mockProvider.readFileOut).toHaveBeenCalledWith('report.txt', { offset: 2, limit: 1 })
    expect(mockProvider.exec).not.toHaveBeenCalled()
    expect(result).toMatchObject({ content: 'line two', startLine: 2, endLine: 2, totalLines: 3 })
  })

  test('read_file preserves a final line without a trailing newline', async () => {
    mockProvider.readFileOut.mockResolvedValue({
      success: true,
      content: 'single line without newline',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    })
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.read_file as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>
    }

    await expect(tool.execute({ file_path: 'note.txt' }, {})).resolves.toEqual({
      file_path: 'note.txt',
      content: 'single line without newline',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    })
  })

  test('read_file returns an empty-file result instead of an offset error', async () => {
    mockProvider.readFileOut.mockResolvedValue({
      success: true,
      content: '',
      startLine: 1,
      endLine: 0,
      totalLines: 0,
    })
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.read_file as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>
    }

    const result = await tool.execute({ file_path: 'empty.txt' }, {})

    expect(result).toEqual({ file_path: 'empty.txt', content: '', totalLines: 0 })
    await expect(toModelOutput(tool, result)).resolves.toEqual({ type: 'text', value: 'File is empty.' })
  })

  test('read_file preserves a selected blank line', async () => {
    mockProvider.readFileOut.mockResolvedValue({
      success: true,
      content: '',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    })
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.read_file as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>
    }

    const result = await tool.execute({ file_path: 'blank.txt' }, {})

    expect(result).toMatchObject({ content: '', startLine: 1, endLine: 1, totalLines: 1 })
    await expect(toModelOutput(tool, result)).resolves.toEqual({
      type: 'text',
      value: '[Selected lines are blank.]',
    })
  })

  test('read_file returns provider errors without invoking Bash', async () => {
    mockProvider.readFileOut.mockResolvedValue({ success: false, error: 'read failed' })
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.read_file as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>
    }

    await expect(tool.execute({ file_path: 'missing.txt' }, {})).resolves.toEqual({ error: 'read failed' })
    expect(mockProvider.exec).not.toHaveBeenCalled()
  })

  test('code_execution tool handles non-zero exit code', async () => {
    mockProvider.exec.mockResolvedValue({ stdout: '', stderr: 'ReferenceError: x is not defined', exitCode: 1 })
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (
        input: Record<string, unknown>,
        opts: Record<string, unknown>
      ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
    }

    const result = await tool.execute({ code: 'console.log(x)', language: 'node' }, {})

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('ReferenceError')
  })

  test('code_execution preserves a structured sandbox error code for the UI and model', async () => {
    mockProvider.exec.mockResolvedValue({
      stdout: '',
      stderr: 'bash is not available',
      exitCode: 127,
      errorCode: SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE,
    })
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>
    }

    const result = await tool.execute({ code: 'echo hello', language: 'bash' }, {})

    expect(result.errorCode).toBe(SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE)
    await expect(toModelOutput(tools.code_execution, result)).resolves.toEqual({
      type: 'text',
      value: 'Exit code: 127\n\nError code: BASH_NOT_AVAILABLE\n\nStderr:\nbash is not available',
    })
  })

  test('seeds attachments in one batch when the provider supports it', async () => {
    const seedBlobsIn = vi.fn().mockResolvedValue({
      success: true,
      results: [
        { targetFilename: sandboxAttachmentRelPath('report.html', 'raw-1'), success: true, skipped: false },
        { targetFilename: sandboxAttachmentRelPath('report.html', 'raw-2'), success: true, skipped: true },
      ],
    })
    const { tools } = buildCodeExecutionTools({
      sessionId: 'test-session',
      files: [
        { storageKey: 'parsed-1', rawStorageKey: 'raw-1', id: 'id-1', name: 'report.html' },
        { storageKey: 'parsed-2', rawStorageKey: 'raw-2', id: 'id-2', name: 'report.html' },
      ],
      provider: { ...mockProvider, seedBlobsIn },
    })
    const tool = tools.code_execution as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>
    }

    await tool.execute({ code: 'console.log(1)', language: 'node' }, {})

    expect(seedBlobsIn).toHaveBeenCalledTimes(1)
    expect(seedBlobsIn).toHaveBeenCalledWith([
      { blobKey: 'raw-1', targetFilename: sandboxAttachmentRelPath('report.html', 'raw-1') },
      { blobKey: 'raw-2', targetFilename: sandboxAttachmentRelPath('report.html', 'raw-2') },
    ])
    expect(mockProvider.copyBlobIn).not.toHaveBeenCalled()
  })

  test('seeds same-named attachments to distinct identity paths', async () => {
    const { tools } = buildCodeExecutionTools({
      sessionId: 'test-session',
      files: [
        { storageKey: 'parsed-1', rawStorageKey: 'raw-1', id: 'id-1', name: 'report.html' },
        { storageKey: 'parsed-2', rawStorageKey: 'raw-2', id: 'id-2', name: 'report.html' },
        { storageKey: 'parsed-xlsx', rawStorageKey: 'raw-xlsx', id: 'id-3', name: 'budget.xlsx' },
      ],
      provider: mockProvider,
    })
    const tool = tools.code_execution as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>
    }

    await tool.execute({ code: 'console.log(1)', language: 'node' }, {})

    const destA = sandboxAttachmentRelPath('report.html', 'raw-1')
    const destB = sandboxAttachmentRelPath('report.html', 'raw-2')
    const destXlsx = sandboxAttachmentRelPath('budget.xlsx', 'raw-xlsx')
    expect(destA).not.toBe(destB)
    expect(mockProvider.copyBlobIn).toHaveBeenCalledWith('raw-1', destA)
    expect(mockProvider.copyBlobIn).toHaveBeenCalledWith('raw-2', destB)
    expect(mockProvider.copyBlobIn).toHaveBeenCalledWith('raw-xlsx', destXlsx)
    expect(mockProvider.copyBlobIn).toHaveBeenCalledWith('parsed-xlsx', sandboxAttachmentParsedRelPath(destXlsx))
    expect(mockProvider.copyBlobIn).not.toHaveBeenCalledWith('raw-1', 'report.html')
  })

  test('provider.init is called only once across multiple executions', async () => {
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>
    }

    await tool.execute({ code: 'console.log(1)', language: 'node' }, {})
    await tool.execute({ code: 'console.log(2)', language: 'node' }, {})

    expect(mockProvider.init).toHaveBeenCalledTimes(1)
  })

  test('code_execution tool returns error when sandbox init fails', async () => {
    mockProvider.init.mockResolvedValue({ success: false, error: 'Docker not available' })
    const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider: mockProvider })
    const tool = tools.code_execution as {
      execute: (
        input: Record<string, unknown>,
        opts: Record<string, unknown>
      ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
    }

    const result = await tool.execute({ code: 'console.log(1)', language: 'node' }, {})

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Sandbox')
  })

  describe('create_download', () => {
    const getTool = (provider: ReturnType<typeof createMockProvider>) => {
      const { tools } = buildCodeExecutionTools({ sessionId: 'test-session', files: [], provider })
      return tools.create_download as {
        execute: (input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>
      }
    }

    test('persists the file and returns a download (local provider)', async () => {
      mockProvider.persistArtifact.mockResolvedValue({ success: true, artifactPath: '/durable/report.pdf' })

      const result = await getTool(mockProvider).execute({ file_path: 'report.pdf', display_name: 'Report' }, {})

      expect(mockProvider.init).toHaveBeenCalledWith('test-session')
      expect(mockProvider.persistArtifact).toHaveBeenCalledWith('report.pdf', 'Report')
      expect(mockProvider.exec).not.toHaveBeenCalled()
      expect(result).toMatchObject({ downloadable: true, file_path: '/durable/report.pdf', display_name: 'Report' })
    })

    test('maps download metadata to readable model text', async () => {
      const tool = getTool(mockProvider)

      await expect(
        toModelOutput(tool, { downloadable: true, file_path: '/durable/report.pdf', display_name: 'Report' })
      ).resolves.toEqual({
        type: 'text',
        value: 'Status: download ready\nName: Report\nPath: /durable/report.pdf',
      })
    })

    test('reports an error to the model when persisting fails (local provider)', async () => {
      mockProvider.persistArtifact.mockResolvedValue({
        success: false,
        error: 'Access denied: path is outside the sandbox',
      })

      const result = await getTool(mockProvider).execute({ file_path: '/tmp/report.pdf', display_name: 'Report' }, {})

      expect(result.downloadable).toBeUndefined()
      expect(result.error).toMatch(/outside the sandbox/i)
      expect(mockProvider.exec).not.toHaveBeenCalled()
    })

    test('falls back to the sandbox path when persistence is unsupported (cloud provider)', async () => {
      const cloud = createMockProvider()
      cloud.type = 'cloud' as const
      cloud.exec.mockResolvedValue({ stdout: '/work/report.pdf\n', stderr: '', exitCode: 0 })
      cloud.persistArtifact.mockResolvedValue({ success: false, error: 'Cloud sandbox not yet implemented' })

      const result = await getTool(cloud).execute({ file_path: 'report.pdf', display_name: 'Report' }, {})

      expect(result).toMatchObject({ downloadable: true, file_path: '/work/report.pdf', provider_type: 'cloud' })
      expect(cloud.exec).toHaveBeenCalledWith(expect.objectContaining({ language: 'node' }))
    })

    test('returns file-not-found from local persistence without invoking a shell', async () => {
      mockProvider.persistArtifact.mockResolvedValue({ success: false, error: 'File not found: missing.pdf' })

      const result = await getTool(mockProvider).execute({ file_path: 'missing.pdf', display_name: 'X' }, {})

      expect(result.error).toMatch(/file not found/i)
      expect(mockProvider.persistArtifact).toHaveBeenCalled()
      expect(mockProvider.exec).not.toHaveBeenCalled()
    })
  })
})
