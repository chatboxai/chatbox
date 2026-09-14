import { validatedToolSchema } from '@shared/validated-tool-schema'
import type { ToolSet } from 'ai'
import platform from '@/platform'
import { asRecord, contentOrErrorText, numberField, stringField, toTextModelOutput } from './model-output'

function formatKnowledgeBaseArray(
  output: unknown,
  formatItem: (item: Record<string, unknown>, index: number) => string
) {
  if (typeof output === 'string') return output
  if (!Array.isArray(output)) return contentOrErrorText(output)
  if (output.length === 0) return 'No results found.'
  return output
    .map((item, index) => {
      const record = asRecord(item)
      return record ? formatItem(record, index) : String(item)
    })
    .join('\n\n')
}

function formatSearchResults(output: unknown): string {
  return formatKnowledgeBaseArray(output, (item, index) => {
    const filename = stringField(item, 'filename') ?? 'Unknown file'
    const chunkIndex = numberField(item, 'chunkIndex')
    const score = numberField(item, 'score')
    const text = stringField(item, 'text') ?? ''
    const lines = [`Result ${index + 1}`, `Source: ${filename}`]
    if (chunkIndex !== undefined) lines.push(`Chunk: ${chunkIndex}`)
    if (score !== undefined) lines.push(`Score: ${score.toFixed(3)}`)
    lines.push('Text:', text)
    return lines.join('\n')
  })
}

function formatFileMeta(output: unknown): string {
  return formatKnowledgeBaseArray(output, (item, index) => {
    const filename = stringField(item, 'filename') ?? stringField(item, 'name') ?? `File ${index + 1}`
    const id = numberField(item, 'id')
    const chunks =
      numberField(item, 'chunk_count') ?? numberField(item, 'chunkCount') ?? numberField(item, 'total_chunks')
    const status = stringField(item, 'status')
    const lines = [`File ${index + 1}`, `Name: ${filename}`]
    if (id !== undefined) lines.push(`ID: ${id}`)
    if (chunks !== undefined) lines.push(`Chunks: ${chunks}`)
    if (status) lines.push(`Status: ${status}`)
    return lines.join('\n')
  })
}

function formatChunks(output: unknown): string {
  return formatKnowledgeBaseArray(output, (item, index) => {
    const filename = stringField(item, 'filename') ?? stringField(item, 'fileName') ?? 'Unknown file'
    const chunkIndex = numberField(item, 'chunkIndex') ?? numberField(item, 'chunk_index')
    const text = stringField(item, 'text') ?? stringField(item, 'content') ?? ''
    const lines = [`Chunk ${index + 1}`, `Source: ${filename}`]
    if (chunkIndex !== undefined) lines.push(`Chunk: ${chunkIndex}`)
    lines.push('Content:', text)
    return lines.join('\n')
  })
}

export const queryKnowledgeBaseTool = (kbId: number): ToolSet[string] => {
  return {
    description: `Search the knowledge base with a semantic query. Returns relevant document chunks.

Call this when the user's question is related to the attached documents and searching would help you answer more accurately. For greetings, chit-chat, or questions clearly unrelated to the knowledge base, answer directly. For follow-up questions on the same topic, reuse earlier results when they still apply.`,
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query - rephrase the user question for better semantic matching',
        },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const queryInput = input as { query: string }
      const knowledgeBaseController = platform.getKnowledgeBaseController()
      return await knowledgeBaseController.search(kbId, queryInput.query)
    },
    toModelOutput: toTextModelOutput(formatSearchResults),
  }
}

export function getFilesMetaTool(knowledgeBaseId: number): ToolSet[string] {
  return {
    description: `Get metadata for files in the current knowledge base. Use this to find out more about files returned from a search, like filename, size, and total number of chunks.`,
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        fileIds: {
          type: 'array',
          items: { type: 'number' },
          description: 'An array of file IDs to get metadata for.',
        },
      },
      required: ['fileIds'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const metaInput = input as { fileIds?: number[] }
      if (!metaInput.fileIds || metaInput.fileIds.length === 0) {
        return 'Please provide an array of file IDs.'
      }
      const knowledgeBaseController = platform.getKnowledgeBaseController()
      return await knowledgeBaseController.getFilesMeta(knowledgeBaseId, metaInput.fileIds)
    },
    toModelOutput: toTextModelOutput(formatFileMeta),
  }
}

export function readFileChunksTool(knowledgeBaseId: number): ToolSet[string] {
  return {
    description: `Read content chunks from specified files in the current knowledge base. Use this to get the text content of a document.`,
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        chunks: {
          type: 'array',
          description: 'An array of file and chunk index pairs to read.',
          items: {
            type: 'object',
            properties: {
              fileId: {
                type: 'number',
                description: 'The ID of the file.',
              },
              chunkIndex: {
                type: 'number',
                description: 'The index of the chunk to read, start from 0.',
              },
            },
            required: ['fileId', 'chunkIndex'],
            additionalProperties: false,
          },
        },
      },
      required: ['chunks'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const chunksInput = input as { chunks?: Array<{ fileId: number; chunkIndex: number }> }
      if (!chunksInput.chunks || chunksInput.chunks.length === 0) {
        return 'Please provide an array of chunks to read.'
      }
      const knowledgeBaseController = platform.getKnowledgeBaseController()
      return await knowledgeBaseController.readFileChunks(knowledgeBaseId, chunksInput.chunks)
    },
    toModelOutput: toTextModelOutput(formatChunks),
  }
}

export function listFilesTool(knowledgeBaseId: number): ToolSet[string] {
  return {
    description: `List all files in the current knowledge base. Returns file ID, filename, and chunk count for each file.`,
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: 'The page number to list, start from 0.',
        },
        pageSize: {
          type: 'integer',
          description: 'The number of files to list per page.',
        },
      },
      required: ['page', 'pageSize'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const listInput = input as { page: number; pageSize: number }
      const knowledgeBaseController = platform.getKnowledgeBaseController()
      const files = await knowledgeBaseController.listFilesPaginated(
        knowledgeBaseId,
        listInput.page,
        listInput.pageSize
      )
      return files
        .filter((file) => file.status === 'done')
        .map((file) => ({
          id: file.id,
          filename: file.filename,
          chunkCount: file.chunk_count || 0,
        }))
    },
    toModelOutput: toTextModelOutput(formatFileMeta),
  }
}
async function getToolSetDescription(knowledgeBaseId: number, knowledgeBaseName: string) {
  // 预加载文件列表，让模型知道知识库中有什么文件
  const knowledgeBaseController = platform.getKnowledgeBaseController()
  const files = await knowledgeBaseController.listFilesPaginated(knowledgeBaseId, 0, 50)
  const doneFiles = files.filter((f) => f.status === 'done')
  const fileListStr =
    doneFiles.length > 0 ? doneFiles.map((f) => `- "${f.filename}"`).join('\n') : '(No files available yet)'

  return `
## Knowledge Base: "${knowledgeBaseName}"

You have access to a knowledge base containing these documents:

${fileListStr}

### Tools:
- **query_knowledge_base** - Semantic search over the documents.
- **read_file_chunks** - Read document content.
- **get_files_meta** - Get file metadata.
- **list_files** - List all files (paginated).

### When to search:
- Search when the user's question is related to these documents and searching would help you answer accurately.
- For greetings, small talk, or questions clearly unrelated to the knowledge base, answer directly without searching.
- For follow-ups on the same topic, reuse earlier results; re-search when the topic meaningfully shifts or earlier results don't cover the new question.
`
}

export async function getToolSet(knowledgeBaseId: number, knowledgeBaseName: string) {
  return {
    description: await getToolSetDescription(knowledgeBaseId, knowledgeBaseName),
    tools: {
      query_knowledge_base: queryKnowledgeBaseTool(knowledgeBaseId),
      get_files_meta: getFilesMetaTool(knowledgeBaseId),
      read_file_chunks: readFileChunksTool(knowledgeBaseId),
      list_files: listFilesTool(knowledgeBaseId),
    },
  }
}
