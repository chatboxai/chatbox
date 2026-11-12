import { beforeEach, describe, expect, test, vi } from 'vitest'

const controller = vi.hoisted(() => ({
  search: vi.fn(),
  getFilesMeta: vi.fn(),
  readFileChunks: vi.fn(),
  listFilesPaginated: vi.fn(),
}))

vi.mock('@/platform', () => ({
  default: { getKnowledgeBaseController: () => controller },
}))

import { getToolSet } from './knowledge-base'

type TestTool = {
  description: string
  execute: (input: unknown, options: unknown) => Promise<unknown>
  toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => unknown
}

function kbFile(id: number, filename: string, chunkCount: number, status = 'done') {
  return { id, filename, chunk_count: chunkCount, status }
}

function fileMeta(id: number, filename: string, chunkCount: number, status = 'done', totalChunks = chunkCount) {
  return { id, filename, chunkCount, totalChunks, status }
}

async function loadTool() {
  const { tools } = await getToolSet(3, 'Product Docs')
  return tools.knowledge_base as unknown as TestTool
}

async function run(input: Record<string, unknown>) {
  const tool = await loadTool()
  const output = await tool.execute(input, {})
  return { output, text: (tool.toModelOutput({ toolCallId: 'call-1', input, output }) as { value: string }).value }
}

beforeEach(() => {
  vi.clearAllMocks()
  controller.listFilesPaginated.mockResolvedValue([kbFile(7, 'manual.pdf', 12), kbFile(8, 'draft.md', 0, 'processing')])
})

describe('knowledge_base tool', () => {
  test('description names the knowledge base and its ready files', async () => {
    const tool = await loadTool()
    expect(tool.description).toContain('"Product Docs"')
    expect(tool.description).toContain('- "manual.pdf"')
    expect(tool.description).not.toContain('draft.md')
    expect(controller.listFilesPaginated).toHaveBeenCalledWith(3, 0, 50)
  })

  test('search results carry the file ID, chunk index and file length', async () => {
    controller.search.mockResolvedValue([
      {
        id: 1,
        fileId: 7,
        filename: 'manual.pdf',
        mimeType: 'application/pdf',
        chunkIndex: 3,
        score: 0.92345,
        text: 'Hit.',
      },
    ])
    controller.getFilesMeta.mockResolvedValue([fileMeta(7, 'manual.pdf', 12)])

    const { text } = await run({ command: 'search', query: 'refund policy' })

    expect(controller.search).toHaveBeenCalledWith(3, 'refund policy')
    expect(text).toBe(
      'Result 1\nSource: manual.pdf\nFile ID: 7\nChunk: 3 (file has 12 chunks, 0–11)\nScore: 0.923\nText:\nHit.'
    )
  })

  test('search still returns hits when file metadata cannot be read', async () => {
    controller.search.mockResolvedValue([
      {
        id: 1,
        fileId: 7,
        filename: 'manual.pdf',
        mimeType: 'application/pdf',
        chunkIndex: 3,
        score: 0.5,
        text: 'Hit.',
      },
    ])
    controller.getFilesMeta.mockRejectedValue(new Error('db busy'))

    const { text } = await run({ command: 'search', query: 'refund' })

    expect(text).toContain('File ID: 7\nChunk: 3\n')
  })

  test('read returns a consecutive range and points to the next chunk', async () => {
    controller.getFilesMeta.mockResolvedValue([fileMeta(7, 'manual.pdf', 12)])
    controller.readFileChunks.mockResolvedValue([
      { fileId: 7, filename: 'manual.pdf', chunkIndex: 4, text: 'Four.' },
      { fileId: 7, filename: 'manual.pdf', chunkIndex: 5, text: 'Five.' },
    ])

    const { text } = await run({ command: 'read', fileId: 7, chunkIndex: 4, count: 2 })

    expect(controller.readFileChunks).toHaveBeenCalledWith(3, [
      { fileId: 7, chunkIndex: 4 },
      { fileId: 7, chunkIndex: 5 },
    ])
    expect(text).toBe(
      'File: manual.pdf (ID 7, 12 chunks, 0–11)\nShowing chunks 4–5\n\n[Chunk 4]\nFour.\n\n[Chunk 5]\nFive.\n\n[Next chunk: 6]'
    )
  })

  test('read stops at the end of the file', async () => {
    controller.getFilesMeta.mockResolvedValue([fileMeta(7, 'manual.pdf', 12)])
    controller.readFileChunks.mockResolvedValue([{ fileId: 7, filename: 'manual.pdf', chunkIndex: 11, text: 'Last.' }])

    const { text } = await run({ command: 'read', fileId: 7, chunkIndex: 11 })

    expect(controller.readFileChunks).toHaveBeenCalledWith(3, [{ fileId: 7, chunkIndex: 11 }])
    expect(text).toMatch(/\[End of file\]$/)
  })

  test('read does not report the end of a file that is still being indexed', async () => {
    controller.getFilesMeta.mockResolvedValue([fileMeta(7, 'manual.pdf', 4, 'paused', 12)])
    controller.readFileChunks.mockResolvedValue([
      { fileId: 7, filename: 'manual.pdf', chunkIndex: 2, text: 'Two.' },
      { fileId: 7, filename: 'manual.pdf', chunkIndex: 3, text: 'Three.' },
    ])

    const { text } = await run({ command: 'read', fileId: 7, chunkIndex: 2 })

    expect(controller.readFileChunks).toHaveBeenCalledWith(3, [
      { fileId: 7, chunkIndex: 2 },
      { fileId: 7, chunkIndex: 3 },
    ])
    expect(text).toContain('File: manual.pdf (ID 7, status paused, only 4 of 12 chunks indexed)')
    expect(text).toMatch(/\[End of the indexed chunks\. The rest of the file is not indexed \(status paused\)\.\]$/)
    expect((await run({ command: 'read', fileId: 7, chunkIndex: 4 })).text).toBe(
      'Error: Chunk 4 is not available: manual.pdf has status paused, only 4 of 12 chunks indexed.'
    )
  })

  test('read reports unknown files and out-of-range chunks', async () => {
    controller.getFilesMeta.mockResolvedValueOnce([])
    expect((await run({ command: 'read', fileId: 99 })).text).toBe('Error: No file with ID 99 in this knowledge base.')

    controller.getFilesMeta.mockResolvedValueOnce([fileMeta(7, 'manual.pdf', 12)])
    expect((await run({ command: 'read', fileId: 7, chunkIndex: 12 })).text).toBe(
      'Error: Chunk 12 is not available: manual.pdf has 12 chunks, 0–11.'
    )
    expect(controller.readFileChunks).not.toHaveBeenCalled()
  })

  test('list pages by offset and reports more pages', async () => {
    const tool = await loadTool()
    controller.listFilesPaginated.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => kbFile(100 + index, `doc-${index}.md`, 1))
    )

    const input = { command: 'list', page: 2 }
    const output = await tool.execute(input, {})
    const text = (tool.toModelOutput({ toolCallId: 'call-1', input, output }) as { value: string }).value

    expect(controller.listFilesPaginated).toHaveBeenLastCalledWith(3, 100, 50)
    expect(text).toContain('- ID 100: doc-0.md (1 chunks)')
    expect(text).toMatch(/More files: list page 3\.$/)
  })
})
