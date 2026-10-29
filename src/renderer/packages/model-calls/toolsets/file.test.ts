import { describe, expect, test, vi } from 'vitest'
import { InMemorySessionRepository } from '@chatbox/core/testing'

vi.mock('@/platform', () => ({
  default: {
    getStoreBlob: vi.fn(),
    readLocalFileContent: vi.fn(),
  },
}))

import { asSchema } from 'ai'
import platform from '@/platform'
import { buildFileTools } from './file'
import { uploadedFilePath, readFileSchema } from '@shared/uploaded-file-tools'
const fileToolSet = buildFileTools([
  {
    id: 'm',
    role: 'user',
    contentParts: [],
    files: [{ id: 'f', name: 'report', fileType: 'text/plain', storageKey: 'report' }],
  },
])

async function toModelOutput(tool: unknown, output: unknown) {
  const mapper = tool as {
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => Promise<unknown> | unknown
  }
  return await mapper.toModelOutput({
    toolCallId: 'tool-call-id',
    input: { file_path: uploadedFilePath('report') },
    output,
  })
}

describe('uploaded file tools model output', () => {
  test('read_file maps empty content to an empty-file result', async () => {
    await expect(toModelOutput(fileToolSet.tools.read_file, { content: '' })).resolves.toEqual({
      type: 'text',
      value: 'File is empty.',
    })
  })
})

async function read(input: unknown) {
  const tool = fileToolSet.tools.read_file
  const result = await asSchema(tool.inputSchema).validate?.(input)
  if (!result?.success) throw new Error('Invalid test input')
  if (!tool.execute) throw new Error('Missing executor')
  return tool.execute(result.value, { toolCallId: 'read-test', messages: [], context: undefined })
}

describe('uploaded file contract', () => {
  test('uses the shared read schema and rejects non-path arguments', async () => {
    expect(Object.keys(fileToolSet.tools)).toEqual(['read_file', 'search_file_content'])
    expect(asSchema(fileToolSet.tools.read_file.inputSchema).jsonSchema).toEqual(readFileSchema)
    const schema = asSchema(fileToolSet.tools.read_file.inputSchema)
    for (const input of [
      { fileKey: 'report' },
      { FILE_KEY: 'report' },
      { file_path: uploadedFilePath('report'), lineOffset: 0 },
      { file_path: uploadedFilePath('report'), offset: 0 },
    ])
      expect((await schema.validate?.(input))?.success).toBe(false)
  })

  test('reads an inclusive 1-based range and returns an executable continuation hint', async () => {
    vi.mocked(platform.getStoreBlob).mockResolvedValue('one\ntwo\nthree\nfour')
    const output = await read({ file_path: uploadedFilePath('report'), offset: 2, limit: 2 })
    expect(output).toMatchObject({ offset: 2, linesRead: 2, content: '     2\ttwo\n     3\tthree' })
    await expect(toModelOutput(fileToolSet.tools.read_file, output)).resolves.toEqual({
      type: 'text',
      value: '     2\ttwo\n     3\tthree\n\n[1 more lines. Use offset=4 to continue.]',
    })
    const last = await read({ file_path: uploadedFilePath('report'), offset: 4, limit: 2 })
    await expect(toModelOutput(fileToolSet.tools.read_file, last)).resolves.toEqual({
      type: 'text',
      value: '     4\tfour',
    })
  })

  test('starts at the first line by default', async () => {
    vi.mocked(platform.getStoreBlob).mockResolvedValue('first\nsecond')
    expect(await read({ file_path: uploadedFilePath('report'), limit: 1 })).toMatchObject({
      offset: 1,
      content: '     1\tfirst',
    })
  })
})

describe('virtual file routing', () => {
  test('delegates physical paths with arguments and execution options intact', async () => {
    const execute = vi.fn(async () => ({ content: 'disk' }))
    const toModelOutput = vi.fn(() => ({ type: 'text' as const, value: 'disk' }))
    const tool = buildFileTools([], { inputSchema: fileToolSet.tools.read_file.inputSchema, execute, toModelOutput })
      .tools.read_file
    const input = { file_path: '/tmp/report.txt', offset: 8, limit: 2 }
    const options = { toolCallId: 'disk', messages: [], context: undefined }
    await tool.execute?.(input, options)
    expect(execute).toHaveBeenCalledWith(input, options)
    await tool.toModelOutput?.({ toolCallId: 'disk', input, output: { content: 'disk' } })
    expect(toModelOutput).toHaveBeenCalledOnce()
  })

  test('unknown virtual paths cannot fall through to disk or decode arbitrary local keys', async () => {
    const execute = vi.fn(async () => 'disk')
    const tool = buildFileTools([], { inputSchema: fileToolSet.tools.read_file.inputSchema, execute }).tools.read_file
    vi.mocked(platform.getStoreBlob).mockClear()
    vi.mocked(platform.readLocalFileContent!).mockClear()
    for (const path of [
      uploadedFilePath('other-session'),
      uploadedFilePath('local:/etc/passwd'),
      '/__chatbox__/files/../secret',
    ]) {
      expect(
        await tool.execute?.({ file_path: path }, { toolCallId: 'missing', messages: [], context: undefined })
      ).toContain('File not found')
    }
    expect(execute).not.toHaveBeenCalled()
    expect(platform.getStoreBlob).not.toHaveBeenCalled()
    expect(platform.readLocalFileContent).not.toHaveBeenCalled()
  })

  test('reads explicitly attached local files and saved tool results by virtual path', async () => {
    const tools = buildFileTools([
      {
        id: 'm',
        role: 'user',
        files: [{ id: 'f', name: 'report', fileType: 'text/plain', localPath: '/tmp/report.txt' }],
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call',
            toolName: 'lookup',
            args: {},
            result: 'preview',
            resultStorageKey: 'result:123',
          },
        ],
      },
    ]).tools
    vi.mocked(platform.readLocalFileContent!).mockResolvedValue('local')
    vi.mocked(platform.getStoreBlob).mockResolvedValue('saved')
    expect(
      await tools.read_file.execute?.(
        { file_path: uploadedFilePath('local:/tmp/report.txt') },
        { toolCallId: 'local', messages: [], context: undefined }
      )
    ).toMatchObject({ content: '     1\tlocal' })
    expect(
      await tools.read_file.execute?.(
        { file_path: uploadedFilePath('result:123') },
        { toolCallId: 'saved', messages: [], context: undefined }
      )
    ).toMatchObject({ content: '     1\tsaved' })
  })

  test('separates equal filenames using their storage identities', () => {
    expect(uploadedFilePath('upload:one/report.txt')).not.toEqual(uploadedFilePath('upload:two/report.txt'))
    expect(uploadedFilePath('a/b')).not.toEqual(uploadedFilePath('a%2Fb'))
  })
})

test('resolves an attachment omitted by the real compacted repository source on demand', async () => {
  const { contextSession } = await import(
    '../../../../../packages/chatbox-core/src/persistence/session-context-read.test-support'
  )
  const session = contextSession()
  session.messages[1].files = [{ id: 'old', name: 'older.txt', fileType: 'txt', storageKey: 'older' }]
  const repo = new InMemorySessionRepository()
  await repo.seedSession(session)
  const source = await repo.getSessionContextSource({ sessionId: session.id, targetMessageId: 'target' })
  expect(source?.mode).toBe('compacted')
  expect(source?.candidateMessages.flatMap((message) => message.files ?? [])).toEqual([])
  const readBodies = vi.spyOn(repo.rowStore, 'readMessages')
  const tool = buildFileTools(source?.candidateMessages ?? [], undefined, source?.beforeTarget.fileResourceKeys).tools
    .read_file
  vi.mocked(platform.getStoreBlob).mockResolvedValue('archived attachment')
  const input = { file_path: uploadedFilePath('older') }
  const options = { toolCallId: 'old', messages: [], context: undefined }
  expect(await tool.execute?.(input, options)).toMatchObject({ content: '     1\tarchived attachment' })
  await tool.execute?.(input, options)
  expect(readBodies).not.toHaveBeenCalled()
  expect(await tool.execute?.({ file_path: uploadedFilePath('other-branch') }, options)).toContain('File not found')
  expect(readBodies).not.toHaveBeenCalled()
})

test('does not disclose host paths in virtual identifiers', () => {
  const key = 'local:/Users/alice/Documents/2026-tax-return.pdf'
  const path = uploadedFilePath(key)
  expect(decodeURIComponent(path)).not.toContain('alice')
  expect(path).not.toContain('tax-return')
  expect(uploadedFilePath(key)).toBe(path)
})

test('retrieval attachments cannot be read through the virtual registry', async () => {
  const tool = buildFileTools([
    {
      id: 'm',
      role: 'user',
      contentParts: [],
      files: [{ id: 'f', name: 'large', fileType: 'txt', storageKey: 'retrieval', ragMode: 'session-retrieval' }],
    },
  ]).tools.read_file
  vi.mocked(platform.getStoreBlob).mockClear()
  expect(
    await tool.execute?.(
      { file_path: uploadedFilePath('retrieval') },
      { toolCallId: 'rag', messages: [], context: undefined }
    )
  ).toContain('File not found')
  expect(platform.getStoreBlob).not.toHaveBeenCalled()
})

test('retries resource reads after transient blob storage failure', async () => {
  const tool = buildFileTools([], undefined, ['report']).tools.read_file
  const input = { file_path: uploadedFilePath('report') }
  const options = { toolCallId: 'retry', messages: [], context: undefined }
  vi.mocked(platform.getStoreBlob)
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValueOnce('recovered')
  await expect(tool.execute?.(input, options)).rejects.toThrow('storage unavailable')
  await expect(tool.execute?.(input, options)).resolves.toMatchObject({ content: '     1\trecovered' })
})

test('reports a past-EOF offset and rejects oversized line counts', async () => {
  vi.mocked(platform.getStoreBlob).mockResolvedValue('one\ntwo')
  const output = await read({ file_path: uploadedFilePath('report'), offset: 100 })
  await expect(toModelOutput(fileToolSet.tools.read_file, output)).resolves.toMatchObject({
    value: expect.stringContaining('2 total lines'),
  })
  const schema = asSchema(fileToolSet.tools.read_file.inputSchema)
  expect((await schema.validate?.({ file_path: uploadedFilePath('report'), limit: 2001 }))?.success).toBe(false)
})

test('row resource references cannot expose an attachment from a sibling branch', async () => {
  const session: import('@shared/types').Session = {
    id: 's',
    name: 'branches',
    messages: [
      { id: 'pivot', role: 'user', contentParts: [] },
      {
        id: 'branch-a-file',
        role: 'user',
        contentParts: [],
        files: [{ id: 'a', name: 'a', fileType: 'txt', storageKey: 'a' }],
      },
      { id: 'target-a', role: 'assistant', contentParts: [] },
    ],
    messageForksHash: {
      pivot: {
        position: 0,
        createdAt: 1,
        lists: [
          { id: 'current', messages: [] },
          {
            id: 'alternative',
            messages: [
              {
                id: 'branch-b-file',
                role: 'user',
                contentParts: [],
                files: [{ id: 'b', name: 'b', fileType: 'txt', storageKey: 'b' }],
              },
              { id: 'target-b', role: 'assistant', contentParts: [] },
            ],
          },
        ],
      },
    },
  }
  vi.mocked(platform.getStoreBlob).mockClear().mockResolvedValue('branch content')
  const repository = new InMemorySessionRepository()
  await repository.seedSession(session)
  const source = await repository.getSessionContextSource({ sessionId: session.id, targetMessageId: 'target-b' })
  const tool = buildFileTools([], undefined, source?.beforeTarget.fileResourceKeys).tools.read_file
  const options = { toolCallId: 'branch', messages: [], context: undefined }
  expect(await tool.execute?.({ file_path: uploadedFilePath('a') }, options)).toContain('File not found')
  expect(platform.getStoreBlob).not.toHaveBeenCalled()
  expect(await tool.execute?.({ file_path: uploadedFilePath('b') }, options)).toMatchObject({
    content: '     1\tbranch content',
  })
})
