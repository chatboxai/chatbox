import {
  KNOWLEDGE_BASE_COMMANDS,
  KNOWLEDGE_BASE_TOOL_NAME,
  type KnowledgeBaseCommand,
  knowledgeBaseCommandOf,
} from '@shared/tools/knowledge-base'
import { validatedToolSchema } from '@shared/validated-tool-schema'
import type { ToolSet } from 'ai'
import platform from '@/platform'
import { asRecord, contentOrErrorText, toTextModelOutput } from './model-output'

const PREVIEW_FILE_COUNT = 50
const LIST_PAGE_SIZE = 50
const DEFAULT_READ_CHUNKS = 5
const MAX_READ_CHUNKS = 20

interface KnowledgeBaseToolInput {
  command: KnowledgeBaseCommand
  query?: string
  fileId?: number
  chunkIndex?: number
  count?: number
  page?: number
}

/** Search also reaches files still being indexed, whose chunks are only partly available. */
interface KnowledgeBaseFileState {
  status: string
  indexedChunks: number
  totalChunks: number
}

export interface KnowledgeBaseSearchOutput {
  results: Array<{
    fileId: number
    filename: string
    chunkIndex: number
    /** Present when the file's metadata could be read. */
    file?: KnowledgeBaseFileState
    score: number
    text: string
  }>
}

export interface KnowledgeBaseReadOutput {
  fileId: number
  filename: string
  file: KnowledgeBaseFileState
  chunks: Array<{ chunkIndex: number; text: string }>
}

export interface KnowledgeBaseListOutput {
  page: number
  hasMore: boolean
  files: Array<{ id: number; filename: string; chunkCount: number }>
}

type KnowledgeBaseToolOutput =
  | KnowledgeBaseSearchOutput
  | KnowledgeBaseReadOutput
  | KnowledgeBaseListOutput
  | { error: string }

function chunkRange(chunks: number): string {
  return chunks > 0 ? `${chunks} chunks, 0–${chunks - 1}` : 'no chunks'
}

function describeFile(file: KnowledgeBaseFileState): string {
  if (file.status === 'done') return chunkRange(file.indexedChunks)
  const total = file.totalChunks > 0 ? ` of ${file.totalChunks}` : ''
  return `status ${file.status}, only ${file.indexedChunks}${total} chunks indexed`
}

function fileState(meta: { status: string; chunkCount: number; totalChunks: number }): KnowledgeBaseFileState {
  return { status: meta.status, indexedChunks: meta.chunkCount, totalChunks: meta.totalChunks }
}

function formatSearch(output: KnowledgeBaseSearchOutput): string {
  if (output.results.length === 0) return 'No results found.'
  return output.results
    .map((result, index) => {
      const file = result.file ? ` (file has ${describeFile(result.file)})` : ''
      return [
        `Result ${index + 1}`,
        `Source: ${result.filename}`,
        `File ID: ${result.fileId}`,
        `Chunk: ${result.chunkIndex}${file}`,
        `Score: ${result.score.toFixed(3)}`,
        'Text:',
        result.text,
      ].join('\n')
    })
    .join('\n\n')
}

function formatRead(output: KnowledgeBaseReadOutput): string {
  const first = output.chunks[0]?.chunkIndex
  const last = output.chunks[output.chunks.length - 1]?.chunkIndex
  const header = `File: ${output.filename} (ID ${output.fileId}, ${describeFile(output.file)})`
  if (first === undefined || last === undefined) return `${header}\nNo chunks found in the requested range.`
  const body = output.chunks.map((chunk) => `[Chunk ${chunk.chunkIndex}]\n${chunk.text}`).join('\n\n')
  const next =
    last < output.file.indexedChunks - 1
      ? `\n\n[Next chunk: ${last + 1}]`
      : output.file.status === 'done'
        ? '\n\n[End of file]'
        : `\n\n[End of the indexed chunks. The rest of the file is not indexed (status ${output.file.status}).]`
  return `${header}\nShowing chunks ${first}–${last}\n\n${body}${next}`
}

function formatList(output: KnowledgeBaseListOutput): string {
  const files = output.files.map((file) => `- ID ${file.id}: ${file.filename} (${file.chunkCount} chunks)`)
  const lines = files.length > 0 ? files : ['No files on this page.']
  if (output.hasMore) lines.push(`More files: list page ${output.page + 1}.`)
  return lines.join('\n')
}

function formatOutput(command: KnowledgeBaseCommand | undefined, output: unknown): string {
  const record = asRecord(output)
  if (!record || typeof record.error === 'string') return contentOrErrorText(output)
  if (command === 'read') return formatRead(record as unknown as KnowledgeBaseReadOutput)
  if (command === 'list') return formatList(record as unknown as KnowledgeBaseListOutput)
  return formatSearch(record as unknown as KnowledgeBaseSearchOutput)
}

async function search(knowledgeBaseId: number, query: string | undefined): Promise<KnowledgeBaseToolOutput> {
  if (!query?.trim()) return { error: 'The search command needs a query.' }
  const controller = platform.getKnowledgeBaseController()
  const hits = await controller.search(knowledgeBaseId, query)
  const fileIds = [...new Set(hits.map((hit) => hit.fileId))]
  const metas = fileIds.length > 0 ? await controller.getFilesMeta(knowledgeBaseId, fileIds).catch(() => []) : []
  const files = new Map(metas.map((meta) => [Number(meta.id), fileState(meta)]))
  return {
    results: hits.map((hit) => ({
      fileId: hit.fileId,
      filename: hit.filename,
      chunkIndex: hit.chunkIndex,
      file: files.get(Number(hit.fileId)),
      score: hit.score,
      text: hit.text,
    })),
  }
}

async function read(knowledgeBaseId: number, input: KnowledgeBaseToolInput): Promise<KnowledgeBaseToolOutput> {
  if (input.fileId === undefined) return { error: 'The read command needs a fileId.' }
  const controller = platform.getKnowledgeBaseController()
  const [meta] = await controller.getFilesMeta(knowledgeBaseId, [input.fileId])
  if (!meta) return { error: `No file with ID ${input.fileId} in this knowledge base.` }
  const start = input.chunkIndex ?? 0
  const file = fileState(meta)
  if (start >= file.indexedChunks) {
    return { error: `Chunk ${start} is not available: ${meta.filename} has ${describeFile(file)}.` }
  }
  const end = Math.min(start + (input.count ?? DEFAULT_READ_CHUNKS), file.indexedChunks)
  const requested = Array.from({ length: end - start }, (_, offset) => ({
    fileId: input.fileId as number,
    chunkIndex: start + offset,
  }))
  const chunks = await controller.readFileChunks(knowledgeBaseId, requested)
  return {
    fileId: input.fileId,
    filename: meta.filename,
    file,
    chunks: chunks.map((chunk) => ({ chunkIndex: chunk.chunkIndex, text: chunk.text })),
  }
}

async function list(knowledgeBaseId: number, page = 0): Promise<KnowledgeBaseToolOutput> {
  const files = await platform
    .getKnowledgeBaseController()
    .listFilesPaginated(knowledgeBaseId, page * LIST_PAGE_SIZE, LIST_PAGE_SIZE)
  return {
    page,
    hasMore: files.length === LIST_PAGE_SIZE,
    files: files
      .filter((file) => file.status === 'done')
      .map((file) => ({ id: file.id, filename: file.filename, chunkCount: file.chunk_count || 0 })),
  }
}

async function describeTool(knowledgeBaseId: number, knowledgeBaseName: string): Promise<string> {
  const files = await platform.getKnowledgeBaseController().listFilesPaginated(knowledgeBaseId, 0, PREVIEW_FILE_COUNT)
  const doneFiles = files.filter((file) => file.status === 'done')
  const fileList =
    doneFiles.length > 0 ? doneFiles.map((file) => `- "${file.filename}"`).join('\n') : '(No files available yet)'
  const more = files.length === PREVIEW_FILE_COUNT ? '\nMore files may exist; the list command shows them all.' : ''
  return `Search and read the "${knowledgeBaseName}" knowledge base attached to this conversation. It contains:
${fileList}${more}
Commands:
- search: semantic search for query. Results carry their file ID and chunk index.
- read: consecutive chunks of fileId from chunkIndex (default 0), count chunks at a time (default ${DEFAULT_READ_CHUNKS}). Use it for the text around a search hit or to read a file in order.
- list: files with their IDs, ${LIST_PAGE_SIZE} per page.
Search when the user's question relates to these documents; answer greetings, small talk and unrelated questions directly. For follow-ups on the same topic, reuse earlier results, and search again when the topic shifts or they no longer cover the question.`
}

export async function getToolSet(knowledgeBaseId: number, knowledgeBaseName: string): Promise<{ tools: ToolSet }> {
  const tool: ToolSet[string] = {
    description: await describeTool(knowledgeBaseId, knowledgeBaseName),
    inputSchema: validatedToolSchema({
      type: 'object',
      properties: {
        command: { type: 'string', enum: [...KNOWLEDGE_BASE_COMMANDS] },
        query: {
          type: 'string',
          description: 'search: the question rephrased for semantic matching.',
        },
        fileId: { type: 'integer', description: 'read: file ID from search or list.' },
        chunkIndex: { type: 'integer', minimum: 0, description: 'read: first chunk, starting from 0.' },
        count: { type: 'integer', minimum: 1, maximum: MAX_READ_CHUNKS, description: 'read: number of chunks.' },
        page: { type: 'integer', minimum: 0, description: 'list: page, starting from 0.' },
      },
      required: ['command'],
      additionalProperties: false,
    }),
    execute: (rawInput) => {
      const input = rawInput as KnowledgeBaseToolInput
      if (input.command === 'read') return read(knowledgeBaseId, input)
      if (input.command === 'list') return list(knowledgeBaseId, input.page)
      return search(knowledgeBaseId, input.query)
    },
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) =>
      toTextModelOutput((output) => formatOutput(knowledgeBaseCommandOf(options.input), output))(options),
  }
  return { tools: { [KNOWLEDGE_BASE_TOOL_NAME]: tool } }
}
