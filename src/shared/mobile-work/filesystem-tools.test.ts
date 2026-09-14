import { describe, expect, it, vi } from 'vitest'
import { buildLocalFilesystemTools } from './filesystem-tools'
import { textToBase64, type WorkspaceFiles } from './workspace-path'

function fixture() {
  const files: WorkspaceFiles = Object.fromEntries(
    Object.entries({
      'site/a.txt': 'hello world\nhello there',
      'other.txt': 'hello',
      'site/data.bin': '\u0000hello',
    }).map(([path, value]) => [path, { base64: textToBase64(value) }])
  )
  const commit = vi.fn(async (_session: string, changes: WorkspaceFiles) => {
    Object.assign(files, changes)
  })
  const tools = buildLocalFilesystemTools(
    {
      snapshot: async () => files,
      readBase64: async (_session, path) => files[path].base64,
      readText: async () => '',
      commit,
      deliver: vi.fn(),
    },
    { sessionId: 's', signal: new AbortController().signal }
  )
  const run = (name: string, input: unknown) => tools[name].execute?.(input, { toolCallId: name, messages: [] })
  return { run, commit, files }
}

describe('local filesystem tools', () => {
  it('filters directories and reads character ranges with bounds', async () => {
    const { run } = fixture()
    expect(await run('list_files', { path: 'site/' })).toHaveLength(2)
    expect(await run('read_file', { path: 'site/a.txt', offset: 6, limit: 5 })).toMatchObject({ text: 'world' })
    await expect(run('read_file', { path: 'site/a.txt', limit: 20001 })).rejects.toThrow()
    await expect(run('list_files', { path: '../' })).rejects.toThrow()
    await expect(run('read_file', { path: 'site/data.bin' })).rejects.toThrow('view_image')
  })
  it('commits ordered edits once and rejects partial or ambiguous changes', async () => {
    const { run, commit } = fixture()
    await expect(
      run('edit_file', {
        file_path: 'site/a.txt',
        edits: [
          { old_text: 'world', new_text: 'earth' },
          { old_text: 'missing', new_text: 'x' },
        ],
      })
    ).rejects.toThrow('not found')
    expect(commit).not.toHaveBeenCalled()
    await expect(
      run('edit_file', { file_path: 'site/a.txt', edits: [{ old_text: 'hello', new_text: 'hi' }] })
    ).rejects.toThrow('not unique')
    expect(commit).not.toHaveBeenCalled()
    await run('edit_file', {
      file_path: 'site/a.txt',
      edits: [
        { old_text: 'world', new_text: 'earth' },
        { old_text: 'earth', new_text: 'moon' },
      ],
    })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(await run('read_file', { path: 'site/a.txt' })).toMatchObject({ text: 'hello moon\nhello there' })
  })
  it('protects inputs and delivered artifacts', async () => {
    const { run, commit } = fixture()
    for (const file_path of ['input/a.txt', 'artifacts/a.txt'])
      await expect(run('edit_file', { file_path, edits: [{ old_text: 'a', new_text: 'b' }] })).rejects.toThrow(
        'read-only'
      )
    expect(commit).not.toHaveBeenCalled()
  })
  it('searches literal text with filename filters, bounded previews and binary skipping', async () => {
    const { run } = fixture()
    expect(await run('search_files', { path: 'site', query: 'hello', limit: 1 })).toMatchObject({
      matches: [{ path: 'site/a.txt', line: 1 }],
      truncated: true,
    })
    expect(await run('search_files', { path: 'site', query: 'hello', include: '*.txt' })).toMatchObject({
      matches: [{ line: 1 }, { line: 2 }],
      truncated: false,
      skippedBinary: 0,
    })
    expect(await run('search_files', { query: 'h.*o' })).toMatchObject({ matches: [], skippedBinary: 1 })
    await expect(run('search_files', { query: 'hello', regex: true })).rejects.toThrow()
  })
})
