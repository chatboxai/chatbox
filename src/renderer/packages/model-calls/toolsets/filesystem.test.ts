import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { FileEditResult } from '@shared/file-edits'
import type { SandboxExecResult, SandboxOperationResult, SandboxProvider } from '@shared/sandbox-provider'
import { asSchema } from 'ai'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ warn: logWarn }) }))

const fsWrite = vi.fn(async (..._args: unknown[]) => ({ success: true }))
const fsEdit = vi.fn(
  async (..._args: unknown[]): Promise<FileEditResult> => ({
    success: true,
    changed: true,
    edits: 1,
    version: 'preview-version',
    diff: '-drop me\n+added\n+more',
    addedLines: 2,
    removedLines: 1,
  })
)
const fsList = vi.fn(async (..._args: unknown[]) => ({ success: true, content: 'file\t1\tout.txt' }))
const sandboxWrite = vi.fn(async (..._args: unknown[]) => ({ success: true }))
const sandboxEdit = vi.fn(async (..._args: unknown[]) => ({ success: true, changed: true, edits: 1 }))
const { platformType } = vi.hoisted(() => ({ platformType: { current: 'web' } }))

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

import { buildFilesystemTools, SANDBOX_EDIT_RESULT_PREFIX } from './filesystem'

const exec = vi.fn(
  async (..._args: unknown[]): Promise<SandboxExecResult> => ({
    stdout: `${SANDBOX_EDIT_RESULT_PREFIX}${JSON.stringify({ success: true, changed: true, edits: 1, before: 'a', after: 'b' })}`,
    stderr: '',
    exitCode: 0,
  })
)
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
    sandboxWrite.mockClear()
    sandboxEdit.mockClear()
    fsEdit.mockClear()
    exec.mockClear()
    logWarn.mockClear()
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
    expect(result).toMatchObject({ success: true, file_path: '/tmp/output.txt', edits: 1, changed: true })
  })

  test('the emitted sandbox script runs the shared matcher and returns the actual diff', async () => {
    const dir = await mkdtemp(path.join('/tmp', 'chatbox-script-edit-'))
    const file = path.join(dir, 'example.txt')
    try {
      await writeFile(file, '\uFEFFalpha\r\nbeta\r\n')
      exec.mockImplementationOnce(async (...args: unknown[]) => {
        const { code } = args[0] as { code: string }
        const result = await promisify(execFile)(process.execPath, ['-e', code])
        return { ...result, stdout: `provider banner\n${result.stdout}provider diagnostic\n`, exitCode: 0 }
      })
      const result = await execute(getTools().edit_file, {
        file_path: file,
        edits: [{ old_text: 'alpha\nbeta', new_text: 'one\ntwo' }],
      })
      expect(result).toMatchObject({ success: true, changed: true, addedLines: 2, removedLines: 2 })
      expect(await readFile(file, 'utf8')).toBe('\uFEFFone\r\ntwo\r\n')
      exec.mockImplementationOnce(async (...args: unknown[]) => {
        const { code } = args[0] as { code: string }
        const result = await promisify(execFile)(process.execPath, ['-e', code])
        return { ...result, exitCode: 0 }
      })
      const tool = getTools().edit_file as unknown as { execute(input: unknown, options: unknown): Promise<unknown> }
      expect(
        await tool.execute(
          { file_path: file, old_text: 'one', new_text: 'overwritten' },
          { toolCallId: 'stale-script', approved: true, approvalFileVersion: 'stale-version' }
        )
      ).toMatchObject({ success: false, errorCode: 'STALE_CONTENT' })
      expect(await readFile(file, 'utf8')).toBe('\uFEFFone\r\ntwo\r\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test.each([
    { stdout: 'not a result', stderr: '', exitCode: 0 },
    { stdout: `${SANDBOX_EDIT_RESULT_PREFIX}{broken`, stderr: '', exitCode: 0 },
    { stdout: `${SANDBOX_EDIT_RESULT_PREFIX}{}`, stderr: '', exitCode: 0 },
    { stdout: '', stderr: 'private system details', exitCode: 1 },
  ])('reports an unconfirmed result without encouraging a blind retry: %j', async (output) => {
    exec.mockResolvedValueOnce(output)
    const result = await execute(getTools().edit_file, { file_path: '/tmp/output.txt', old_text: 'a', new_text: 'b' })
    expect(result).toMatchObject({
      success: false,
      errorCode: 'RESULT_UNCONFIRMED',
      error: expect.stringContaining('read it'),
    })
    expect(JSON.stringify(result)).not.toContain('private system details')
  })

  test('records bounded executor diagnostics while write_file returns a fixed error', async () => {
    exec.mockResolvedValueOnce({ stdout: 'file content', stderr: 'private details'.repeat(500), exitCode: 1 })
    const result = await execute(getTools().write_file, { file_path: '/tmp/output.txt', content: 'hello' })
    expect(result).toEqual({
      error: 'Could not confirm the file operation. The file may have changed; read it before retrying.',
    })
    expect(JSON.stringify(result)).not.toContain('private details')
    expect(logWarn).toHaveBeenCalledWith('Sandbox write failed', {
      exitCode: 1,
      stderr: 'private details'.repeat(500).slice(0, 2000),
    })
  })

  test('records executor failure for edit_file without returning stderr', async () => {
    exec.mockResolvedValueOnce({ stdout: '', stderr: 'node unavailable', exitCode: 127 })
    expect(
      await execute(getTools().edit_file, { file_path: '/tmp/output.txt', old_text: 'a', new_text: 'b' })
    ).toMatchObject({ errorCode: 'RESULT_UNCONFIRMED' })
    expect(logWarn).toHaveBeenCalledWith('Sandbox edit failed', { exitCode: 127, stderr: 'node unavailable' })
  })

  test('bounds the final sandbox JSON by UTF-8 bytes for CJK content', async () => {
    const dir = await mkdtemp(path.join('/tmp', 'chatbox-cjk-edit-'))
    const file = path.join(dir, 'cjk.txt')
    try {
      await writeFile(file, `start${'中'.repeat(5000)}`)
      exec.mockImplementationOnce(async (...args: unknown[]) => {
        const { code } = args[0] as { code: string }
        const output = await promisify(execFile)(process.execPath, ['-e', code])
        expect(Buffer.byteLength(output.stdout, 'utf8')).toBeLessThanOrEqual(12000)
        expect(JSON.parse(output.stdout.trim().slice(SANDBOX_EDIT_RESULT_PREFIX.length)).before).toBeUndefined()
        return { ...output, exitCode: 0 }
      })
      expect(
        await execute(getTools().edit_file, { file_path: file, old_text: 'start', new_text: 'updated' })
      ).toMatchObject({ success: true, changed: true })
      expect(await readFile(file, 'utf8')).toBe(`updated${'中'.repeat(5000)}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  test('POSIX desktop sandbox paths keep using the confined executor', async () => {
    platformType.current = 'desktop'
    const localProvider = { ...provider, type: 'local' } as SandboxProvider
    const tools = buildFilesystemTools({
      sessionId: 'session-id',
      provider: localProvider,
      userWorkingDirectories: ['/Users/me/project'],
    }).tools
    for (const file_path of ['relative.txt', '/sandbox/root/a.txt', '/Users/me/project/a.txt']) {
      await execute(tools.edit_file, { file_path, old_text: 'a', new_text: 'b' })
      await execute(tools.write_file, { file_path, content: 'b' })
    }
    expect(exec).toHaveBeenCalledTimes(6)
    expect(sandboxWrite).not.toHaveBeenCalled()
    expect(sandboxEdit).not.toHaveBeenCalled()
    expect(fsEdit).not.toHaveBeenCalled()
  })
  test('unapproved host preview failures expose no file diagnostics', async () => {
    fsEdit.mockResolvedValueOnce({
      success: false,
      errorCode: 'AMBIGUOUS_MATCH',
      error: 'secret',
      candidateLines: [99],
      matches: 5,
      editIndex: 2,
    })
    const result = await execute(getTools().edit_file, {
      file_path: '/Users/me/private.txt',
      old_text: 'a',
      new_text: 'b',
    })
    expect(result).toEqual({
      success: false,
      errorCode: 'AMBIGUOUS_MATCH',
      error: 'Edit 2: Search text is not unique. Include more surrounding text to select one occurrence.',
      editIndex: 2,
    })
    expect(requestFileMutationApproval).not.toHaveBeenCalled()
  })
  test('a skipped file diff marks snippet counts as approximate even for one edit', async () => {
    fsEdit.mockResolvedValueOnce({ success: true, changed: true, edits: 1, version: 'v1', diffTruncated: true })
    const old_text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    await execute(getTools().edit_file, {
      file_path: '/Users/me/large.txt',
      old_text,
      new_text: old_text.replace('line 10', 'changed 10'),
    })
    expect(requestFileMutationApproval).toHaveBeenCalledWith(
      'tool-call-id',
      expect.any(String),
      '',
      { mode: 'edit', edits: 1, addedLines: 1, removedLines: 1, approximate: true },
      { version: 'v1', diffTruncated: true }
    )
  })
  test('partial-line anchor insertion uses approximate approval counts', async () => {
    fsEdit.mockResolvedValueOnce({ success: true, changed: true, edits: 1, version: 'v1', diffTruncated: true })
    await execute(getTools().edit_file, {
      file_path: '/Users/me/large.txt',
      old_text: 'anchor',
      new_text: 'anchor\ninserted one\ninserted two',
    })
    expect(requestFileMutationApproval).toHaveBeenCalledWith(
      'tool-call-id',
      expect.any(String),
      '',
      { mode: 'edit', edits: 1, addedLines: 3, removedLines: 1, approximate: true },
      { version: 'v1', diffTruncated: true }
    )
  })

  test('host no-op previews succeed without requesting approval or writing', async () => {
    fsEdit.mockResolvedValueOnce({
      success: true,
      changed: false,
      edits: 1,
      version: 'v1',
      addedLines: 0,
      removedLines: 0,
    })
    expect(
      await execute(getTools().edit_file, { file_path: '/Users/me/same.txt', old_text: 'a', new_text: 'a' })
    ).toMatchObject({ success: true, changed: false })
    expect(fsEdit).toHaveBeenCalledExactlyOnceWith({
      filePath: '/Users/me/same.txt',
      edits: [{ search: 'a', replace: 'a' }],
      dryRun: true,
    })
    expect(requestFileMutationApproval).not.toHaveBeenCalled()
  })
  test.each(['NOT_FOUND', 'FILE_NOT_FOUND', 'FILE_TOO_LARGE', 'NOT_REGULAR_FILE', 'READ_FAILED'] as const)(
    'retains actionable host error category %s',
    async (errorCode) => {
      fsEdit.mockResolvedValueOnce({ success: false, errorCode, error: 'private details' })
      const result = await execute(getTools().edit_file, {
        file_path: '/Users/me/error.txt',
        old_text: 'a',
        new_text: 'b',
      })
      expect(result).toMatchObject({ success: false, errorCode })
      expect(JSON.stringify(result)).not.toContain('private details')
    }
  )
  test('the actual sandbox script rejects oversized, non-regular, and unreadable targets', async () => {
    const dir = await mkdtemp(path.join('/tmp', 'chatbox-read-bound-'))
    const file = path.join(dir, 'large')
    try {
      await writeFile(file, 'a')
      await truncate(file, 4 * 1024 * 1024 + 1)
      for (const [file_path, errorCode] of [
        [file, 'FILE_TOO_LARGE'],
        [dir, 'NOT_REGULAR_FILE'],
        [path.join(dir, 'missing'), 'FILE_NOT_FOUND'],
      ]) {
        exec.mockImplementationOnce(async (...args: unknown[]) => {
          const { code } = args[0] as { code: string }
          return { ...(await promisify(execFile)(process.execPath, ['-e', code])), exitCode: 0 }
        })
        expect(await execute(getTools().edit_file, { file_path, old_text: 'a', new_text: 'b' })).toMatchObject({
          success: false,
          errorCode,
        })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  test('an approved edit forwards the persisted preview version without a new preview', async () => {
    const tool = getTools().edit_file as unknown as { execute(input: unknown, options: unknown): Promise<unknown> }
    await tool.execute(
      { file_path: '/Users/me/config.txt', old_text: 'a', new_text: 'b' },
      { toolCallId: 'approved-edit', approved: true, approvalFileVersion: 'reviewed-version' }
    )
    expect(fsEdit).toHaveBeenCalledExactlyOnceWith({
      filePath: '/Users/me/config.txt',
      edits: [{ search: 'a', replace: 'b' }],
      expectedVersion: 'reviewed-version',
    })
    expect(requestFileMutationApproval).not.toHaveBeenCalled()
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

  test('approval binds the actual preview and net stats to the current version', async () => {
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
    expect(preview).toBe('-drop me\n+added\n+more')
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
    logWarn.mockClear()
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
    logWarn.mockClear()
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
    logWarn.mockClear()
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
    logWarn.mockClear()
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

describe('edit_file input contract', () => {
  test('shows only edits[] and normalizes released single-edit arguments', async () => {
    const schema = asSchema(getTools().edit_file.inputSchema)
    expect((await schema.jsonSchema).required).toEqual(['file_path', 'edits'])
    expect(Object.keys((await schema.jsonSchema).properties ?? {})).toEqual(['file_path', 'edits'])
    const input = { file_path: '/tmp/a.txt', old_text: 'before', new_text: '' }
    expect(await schema.validate?.(input)).toEqual({
      success: true,
      value: { file_path: '/tmp/a.txt', edits: [{ old_text: 'before', new_text: '' }] },
    })
    expect(input).toEqual({ file_path: '/tmp/a.txt', old_text: 'before', new_text: '' })
  })

  test.each([
    { file_path: '/tmp/a.txt' },
    { file_path: '/tmp/a.txt', edits: [] },
    { file_path: '/tmp/a.txt', edits: [{ old_text: 'a', new_text: 1 }] },
    { file_path: '/tmp/a.txt', old_text: 'a' },
    { file_path: '/tmp/a.txt', old_text: 'a', new_text: 'b', edits: [{ old_text: 'c', new_text: 'd' }] },
    { file_path: '/tmp/a.txt', old_text: 'a', new_text: 'b', unknown: true },
  ])('rejects incomplete or mixed edit arguments %j', async (input) => {
    const schema = asSchema(getTools().edit_file.inputSchema)
    expect((await schema.validate?.(input))?.success).toBe(false)
  })
})

test('virtual uploaded files reject writes and edits before filesystem execution', async () => {
  fsWrite.mockClear()
  fsEdit.mockClear()
  exec.mockClear()
  const tools = getTools()
  expect(await execute(tools.write_file, { file_path: '/__chatbox__/files/report', content: 'new' })).toMatchObject({
    error: expect.stringContaining('read-only'),
  })
  expect(
    await execute(tools.edit_file, {
      file_path: '/__chatbox__/files/report',
      edits: [{ old_text: 'old', new_text: 'new' }],
    })
  ).toMatchObject({ error: expect.stringContaining('read-only') })
  expect(fsWrite).not.toHaveBeenCalled()
  expect(fsEdit).not.toHaveBeenCalled()
  expect(exec).not.toHaveBeenCalled()
})

test('reserved virtual paths cannot be listed or searched on disk', async () => {
  fsList.mockClear()
  exec.mockClear()
  const tools = getTools()
  for (const tool of [tools.list_files, tools.search_files]) {
    expect(await execute(tool, { path: '/__chatbox__/files/unknown', query: 'hello' })).toMatchObject({
      error: expect.stringContaining('virtual path'),
    })
  }
  expect(fsList).not.toHaveBeenCalled()
  expect(exec).not.toHaveBeenCalled()
})
