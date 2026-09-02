import type { SandboxExecResult, SandboxOperationResult, SandboxProvider } from '@shared/sandbox-provider'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const fsWrite = vi.fn(async (..._args: unknown[]) => ({ success: true }))
const fsEdit = vi.fn(async (..._args: unknown[]) => ({ success: true }))
const fsList = vi.fn(async (..._args: unknown[]) => ({ success: true, content: 'file\t1\tout.txt' }))
const sandboxWrite = vi.fn(async (..._args: unknown[]) => ({ success: true }))
const sandboxEdit = vi.fn(async (..._args: unknown[]) => ({ success: true }))

vi.mock('@/platform', () => ({
  default: {
    type: 'web',
    fsWrite: (...args: unknown[]) => fsWrite(...args),
    fsEdit: (...args: unknown[]) => fsEdit(...args),
    fsList: (...args: unknown[]) => fsList(...args),
    sandboxWrite: (...args: unknown[]) => sandboxWrite(...args),
    sandboxEdit: (...args: unknown[]) => sandboxEdit(...args),
  },
}))

const requestFileMutationApproval = vi.fn(async (..._args: unknown[]) => true)
vi.mock('@/packages/user-exec-approval', () => ({
  requestFileMutationApproval: (...args: unknown[]) => requestFileMutationApproval(...args),
}))

const trackAgentModeFullAccessBypass = vi.fn()
vi.mock('@/analytics/agent-mode', () => ({
  trackAgentModeFullAccessBypass: (...args: unknown[]) => trackAgentModeFullAccessBypass(...args),
}))

const buildEditStatsSpy = vi.fn()
const buildWriteStatsSpy = vi.fn()
vi.mock('./file-mutation-stats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./file-mutation-stats')>()
  return {
    ...actual,
    buildEditStats: (...args: Parameters<typeof actual.buildEditStats>) => {
      buildEditStatsSpy(...args)
      return actual.buildEditStats(...args)
    },
    buildWriteStats: (...args: Parameters<typeof actual.buildWriteStats>) => {
      buildWriteStatsSpy(...args)
      return actual.buildWriteStats(...args)
    },
  }
})

import { buildFilesystemTools } from './filesystem'

const exec = vi.fn(async (..._args: unknown[]): Promise<SandboxExecResult> => ({ stdout: '', stderr: '', exitCode: 0 }))
const search = vi.fn(async (..._args: unknown[]) => ({ success: true, content: '' }))
const listFiles = vi.fn(
  async (..._args: unknown[]): Promise<SandboxOperationResult> => ({ success: true, content: '' })
)

// Provider whose sandbox root never contains the tested absolute paths, so non-/tmp paths
// take the real-filesystem branch where approval would normally be requested. /tmp paths
// are routed through the sandbox (provider.exec) instead.
const provider = {
  init: async () => ({ success: true }),
  getStatus: async () => ({ workingDirectory: '/sandbox/root' }),
  exec: (...args: unknown[]) => exec(...args),
  search: (...args: unknown[]) => search(...args),
  listFiles: (...args: unknown[]) => listFiles(...args),
} as unknown as SandboxProvider

function getTools() {
  return buildFilesystemTools({ sessionId: 'session-id', provider }).tools
}

async function execute(tool: unknown, input: unknown) {
  const executable = tool as {
    execute: (input: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown>
  }
  return await executable.execute(input, { toolCallId: 'tool-call-id', messages: [] })
}

async function toModelOutput(tool: unknown, output: unknown) {
  const mapper = tool as {
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => Promise<unknown> | unknown
  }
  return await mapper.toModelOutput({ toolCallId: 'tool-call-id', input: {}, output })
}

describe('filesystem write to sandbox-writable temp (/tmp)', () => {
  beforeEach(() => {
    fsWrite.mockClear()
    fsEdit.mockClear()
    exec.mockClear()
    requestFileMutationApproval.mockClear()
  })

  test('writing under /tmp goes through the sandbox without approval or real-fs write', async () => {
    const result = await execute(getTools().write_file, { file_path: '/tmp/output.txt', content: 'hello' })
    expect(requestFileMutationApproval).not.toHaveBeenCalled()
    expect(fsWrite).not.toHaveBeenCalled()
    expect(exec).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: true, file_path: '/tmp/output.txt' })
  })

  test('write_file maps structured results to readable model text', async () => {
    await expect(
      toModelOutput(getTools().write_file, { success: true, file_path: '/tmp/output.txt' })
    ).resolves.toEqual({
      type: 'text',
      value: 'Status: success\nAction: write_file\nPath: /tmp/output.txt',
    })
  })

  test('editing under /tmp goes through the sandbox without approval or real-fs edit', async () => {
    const result = await execute(getTools().edit_file, {
      file_path: '/tmp/output.txt',
      old_text: 'a',
      new_text: 'b',
    })
    expect(requestFileMutationApproval).not.toHaveBeenCalled()
    expect(fsEdit).not.toHaveBeenCalled()
    expect(exec).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: true, file_path: '/tmp/output.txt', edits: 1 })
  })

  test('edit_file maps structured results to readable model text', async () => {
    await expect(
      toModelOutput(getTools().edit_file, { success: true, file_path: '/tmp/output.txt', edits: 2 })
    ).resolves.toEqual({
      type: 'text',
      value: 'Status: success\nAction: edit_file\nPath: /tmp/output.txt\nEdits applied: 2',
    })
  })

  test('a /tmp-prefixed sibling path is not treated as sandbox-writable', async () => {
    await execute(getTools().write_file, { file_path: '/tmpfoo/output.txt', content: 'hello' })
    expect(exec).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
  })

  test('a /tmp path that escapes via .. is not sandbox-writable (requires approval)', async () => {
    // path.resolve() on the main side collapses '..', so the real write target is outside
    // /tmp — it must not be routed through the sandbox nor skip approval.
    await execute(getTools().write_file, { file_path: '/tmp/../Users/alice/.zshrc', content: 'evil' })
    expect(exec).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
  })

  test('on Windows, /tmp is not sandbox-writable (sandbox does not whitelist it there)', async () => {
    const original = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      configurable: true,
    })
    try {
      await execute(getTools().write_file, { file_path: '/tmp/output.txt', content: 'hello' })
      expect(exec).not.toHaveBeenCalled()
      expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true })
    }
  })

  test('writing other absolute paths still requires approval and uses the real fs', async () => {
    await execute(getTools().write_file, { file_path: '/Users/someone/secret.txt', content: 'hello' })
    expect(exec).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
    expect(fsWrite).toHaveBeenCalledTimes(1)
  })

  test('approval carries change stats so the reviewer sees the magnitude without the diff', async () => {
    await execute(getTools().write_file, { file_path: '/Users/someone/secret.txt', content: 'one\ntwo' })
    expect(requestFileMutationApproval).toHaveBeenLastCalledWith(
      'tool-call-id',
      'Write file: /Users/someone/secret.txt',
      '',
      { mode: 'write', addedLines: 2, removedLines: 0 }
    )

    await execute(getTools().edit_file, {
      file_path: '/Users/someone/secret.txt',
      old_text: 'keep\ndrop me\ntail',
      new_text: 'keep\nadded\nmore\ntail',
    })
    const [, title, preview, stats] = requestFileMutationApproval.mock.calls.at(-1) as [
      string,
      string,
      string,
      { mode: string; edits: number; addedLines: number; removedLines: number },
    ]
    expect(title).toBe('Edit file: /Users/someone/secret.txt')
    expect(preview).toBe('')
    expect(stats).toEqual({ mode: 'edit', edits: 1, addedLines: 2, removedLines: 1 })
  })

  test('preserves a real /home/user path and routes it through approval', async () => {
    const realHomeProvider = {
      ...provider,
      getStatus: async () => ({ workingDirectory: '/sandbox/root', homeDirectory: '/home/user' }),
    } as unknown as SandboxProvider
    const tools = buildFilesystemTools({ sessionId: 'session-id', provider: realHomeProvider }).tools

    await execute(tools.write_file, { file_path: '/home/user/report.txt', content: 'hello' })

    expect(exec).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
    expect(fsWrite).toHaveBeenCalledWith({ filePath: '/home/user/report.txt', content: 'hello' })
  })
})

describe('user-granted working directories (like /tmp)', () => {
  beforeEach(() => {
    fsWrite.mockClear()
    exec.mockClear()
    requestFileMutationApproval.mockClear()
    trackAgentModeFullAccessBypass.mockClear()
    buildEditStatsSpy.mockClear()
    buildWriteStatsSpy.mockClear()
  })

  function toolsWithWorkingDir() {
    return buildFilesystemTools({
      sessionId: 'session-id',
      provider,
      userWorkingDirectories: ['/Users/me/project'],
    }).tools
  }

  test('writing inside a granted dir goes through the sandbox without approval', async () => {
    const result = await execute(toolsWithWorkingDir().write_file, {
      file_path: '/Users/me/project/out.txt',
      content: 'hi',
    })
    expect(requestFileMutationApproval).not.toHaveBeenCalled()
    expect(fsWrite).not.toHaveBeenCalled()
    expect(exec).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: true, file_path: '/Users/me/project/out.txt' })
  })

  test('a sibling path outside the granted dir still requires approval', async () => {
    await execute(toolsWithWorkingDir().write_file, { file_path: '/Users/me/project-evil/out.txt', content: 'x' })
    expect(exec).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
  })

  test('.. traversal out of the granted dir cannot spoof a match', async () => {
    await execute(toolsWithWorkingDir().write_file, { file_path: '/Users/me/project/../secret.txt', content: 'x' })
    expect(exec).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
  })

  test('binding the filesystem root does not exempt every absolute path from approval', async () => {
    const tools = buildFilesystemTools({ sessionId: 'session-id', provider, userWorkingDirectories: ['/'] }).tools
    await execute(tools.write_file, { file_path: '/etc/passwd', content: 'x' })
    expect(exec).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
  })

  test('full access writes absolute paths without approval', async () => {
    const tools = buildFilesystemTools({ sessionId: 'session-id', provider, fullAccess: true }).tools
    await execute(tools.write_file, { file_path: '/Users/me/project/out.txt', content: 'x' })
    expect(exec).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).not.toHaveBeenCalled()
    expect(fsWrite).toHaveBeenCalledTimes(1)
    expect(trackAgentModeFullAccessBypass).toHaveBeenCalledWith({ tool: 'write_file' })
    expect(buildWriteStatsSpy).not.toHaveBeenCalled()
  })

  test('full access edits absolute paths without approval', async () => {
    const tools = buildFilesystemTools({ sessionId: 'session-id', provider, fullAccess: true }).tools
    await execute(tools.edit_file, { file_path: '/Users/me/project/out.txt', old_text: 'a', new_text: 'b' })
    expect(exec).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).not.toHaveBeenCalled()
    expect(fsEdit).toHaveBeenCalledTimes(1)
    expect(trackAgentModeFullAccessBypass).toHaveBeenCalledWith({ tool: 'edit_file' })
    expect(buildEditStatsSpy).not.toHaveBeenCalled()
  })

  test('full access bypass is tracked even when the write fails', async () => {
    fsWrite.mockResolvedValueOnce({ success: false, error: 'permission denied' } as never)
    const tools = buildFilesystemTools({ sessionId: 'session-id', provider, fullAccess: true }).tools
    await execute(tools.write_file, { file_path: '/etc/hosts', content: 'x' })
    expect(trackAgentModeFullAccessBypass).toHaveBeenCalledWith({ tool: 'write_file' })
  })

  test('bypass is not tracked for pre-approved calls or working-directory writes', async () => {
    const approvedTools = buildFilesystemTools({ sessionId: 'session-id', provider, fullAccess: true }).tools
    const executable = approvedTools.write_file as {
      execute: (input: unknown, options: { toolCallId: string; messages: []; approved?: boolean }) => Promise<unknown>
    }
    await executable.execute(
      { file_path: '/Users/me/project/out.txt', content: 'x' },
      { toolCallId: 'tool-call-id', messages: [], approved: true }
    )
    expect(trackAgentModeFullAccessBypass).not.toHaveBeenCalled()

    // Working-directory paths are sandbox-routed before the bypass check.
    const wdTools = buildFilesystemTools({
      sessionId: 'session-id',
      provider,
      fullAccess: true,
      userWorkingDirectories: ['/Users/me/granted'],
    }).tools
    await execute(wdTools.write_file, { file_path: '/Users/me/granted/out.txt', content: 'x' })
    expect(trackAgentModeFullAccessBypass).not.toHaveBeenCalled()
  })
})

describe('Windows user-granted working directories', () => {
  const originalNavigator = globalThis.navigator

  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      configurable: true,
    })
    fsWrite.mockClear()
    fsEdit.mockClear()
    fsList.mockClear()
    sandboxWrite.mockClear()
    sandboxEdit.mockClear()
    exec.mockClear()
    search.mockClear()
    requestFileMutationApproval.mockClear()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true })
  })

  function windowsTools(workingDirectories = [String.raw`C:\Users\Me\Project`]) {
    return buildFilesystemTools({ sessionId: 'session-id', provider, userWorkingDirectories: workingDirectories }).tools
  }

  test('matches native paths case-insensitively and writes through the main-process boundary', async () => {
    const result = await execute(windowsTools().write_file, {
      file_path: String.raw`c:\USERS\me\project\out.txt`,
      content: 'hello',
    })

    expect(requestFileMutationApproval).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    expect(fsWrite).not.toHaveBeenCalled()
    expect(sandboxWrite).toHaveBeenCalledWith({
      filePath: String.raw`C:\USERS\me\project\out.txt`,
      content: 'hello',
      sessionId: 'session-id',
    })
    expect(result).toEqual({ success: true, file_path: String.raw`C:\USERS\me\project\out.txt` })
  })

  test('maps WSL and Git Bash aliases to the granted native path', async () => {
    await execute(windowsTools().write_file, {
      file_path: '/mnt/c/Users/Me/Project/nested/../out.txt',
      content: 'hello',
    })
    expect(sandboxWrite).toHaveBeenCalledWith({
      filePath: String.raw`C:\Users\Me\Project\out.txt`,
      content: 'hello',
      sessionId: 'session-id',
    })

    await execute(windowsTools().edit_file, {
      file_path: '/c/Users/Me/Project/out.txt',
      old_text: 'before',
      new_text: 'after',
    })
    expect(sandboxEdit).toHaveBeenCalledWith({
      filePath: String.raw`C:\Users\Me\Project\out.txt`,
      edits: [{ search: 'before', replace: 'after' }],
      sessionId: 'session-id',
    })
  })

  test('does not bypass approval for sibling or traversal paths', async () => {
    await execute(windowsTools().write_file, {
      file_path: '/mnt/c/Users/Me/Project/../secret.txt',
      content: 'x',
    })
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
    expect(fsWrite).toHaveBeenCalledWith({
      filePath: String.raw`C:\Users\Me\secret.txt`,
      content: 'x',
    })

    requestFileMutationApproval.mockClear()
    fsWrite.mockClear()
    await execute(windowsTools().write_file, {
      file_path: String.raw`C:\Users\Me\Project-evil\out.txt`,
      content: 'x',
    })
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
  })

  test('does not allow a drive or UNC share root to grant the whole filesystem', async () => {
    await execute(windowsTools(['C:\\']).write_file, {
      file_path: String.raw`C:\Windows\System32\drivers\etc\hosts`,
      content: 'x',
    })
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)

    requestFileMutationApproval.mockClear()
    await execute(windowsTools(['\\\\server\\share\\']).write_file, {
      file_path: String.raw`\\server\share\folder\out.txt`,
      content: 'x',
    })
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
  })

  test('falls back to approval when the main process rejected a requested working directory', async () => {
    const rejectedGrantProvider = {
      ...provider,
      getAcceptedExtraWritableDirs: () => [],
    } as unknown as SandboxProvider
    const tools = buildFilesystemTools({
      sessionId: 'session-id',
      provider: rejectedGrantProvider,
      userWorkingDirectories: [String.raw`C:\Users\Me`],
    }).tools

    await execute(tools.write_file, {
      file_path: String.raw`C:\Users\Me\project\out.txt`,
      content: 'hello',
    })

    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(requestFileMutationApproval).toHaveBeenCalledTimes(1)
    expect(fsWrite).toHaveBeenCalledWith({
      filePath: String.raw`C:\Users\Me\project\out.txt`,
      content: 'hello',
    })
  })

  test('uses normalized native paths for list and search operations', async () => {
    await execute(windowsTools().list_files, { path: '/cygdrive/c/Users/Me/Project' })
    expect(fsList).toHaveBeenCalledWith({ dirPath: String.raw`C:\Users\Me\Project` })
    expect(exec).not.toHaveBeenCalled()

    await execute(windowsTools().search_files, { path: '/mnt/c/Users/Me/Project', query: 'needle' })
    expect(search).toHaveBeenCalledWith({
      path: String.raw`C:\Users\Me\Project`,
      pattern: 'needle',
      regex: undefined,
      include: undefined,
    })
  })
})

describe('search_files sandbox routing', () => {
  beforeEach(() => {
    exec.mockClear()
    search.mockClear()
  })

  test('literal search delegates structured parameters to the sandbox provider', async () => {
    await execute(getTools().search_files, { path: '/tmp/project', query: 'foo(bar)' })
    expect(search).toHaveBeenCalledWith({
      path: '/tmp/project',
      pattern: 'foo(bar)',
      regex: undefined,
      include: undefined,
    })
    expect(exec).not.toHaveBeenCalled()
  })

  test('regex and include settings use the same provider contract', async () => {
    await execute(getTools().search_files, {
      path: '/tmp/project',
      query: String.raw`\d+?`,
      regex: true,
      include: '*.ts',
    })
    expect(search).toHaveBeenCalledWith({
      path: '/tmp/project',
      pattern: String.raw`\d+?`,
      regex: true,
      include: '*.ts',
    })
  })

  test('search_files maps content objects to plain model text', async () => {
    await expect(toModelOutput(getTools().search_files, { content: 'src/a.ts:1:match' })).resolves.toEqual({
      type: 'text',
      value: 'src/a.ts:1:match',
    })
  })

  test('search_files maps empty content to a no-matches result', async () => {
    await expect(toModelOutput(getTools().search_files, { content: '' })).resolves.toEqual({
      type: 'text',
      value: 'No matches found.',
    })
  })
})

describe('list_files model output', () => {
  beforeEach(() => {
    exec.mockClear()
    listFiles.mockClear()
  })

  test('lists sandbox files through the provider without invoking a shell', async () => {
    listFiles.mockResolvedValueOnce({ success: true, content: 'file\t5\treport.txt' })

    const result = await execute(getTools().list_files, { path: '.' })

    expect(listFiles).toHaveBeenCalledWith('.')
    expect(exec).not.toHaveBeenCalled()
    expect(result).toEqual({ content: 'file\t5\treport.txt' })
  })

  test('list_files maps empty content to an empty-directory result', async () => {
    await expect(toModelOutput(getTools().list_files, { content: '' })).resolves.toEqual({
      type: 'text',
      value: 'Directory is empty.',
    })
  })

  test('preserves provider errors for the UI and model', async () => {
    listFiles.mockResolvedValueOnce({ success: false, error: 'directory unavailable' })

    const tool = getTools().list_files
    const result = await execute(tool, { path: '/tmp/project' })

    expect(result).toEqual({
      error: 'directory unavailable',
    })
    await expect(toModelOutput(tool, result)).resolves.toEqual({
      type: 'text',
      value: 'Error: directory unavailable',
    })
  })
})
