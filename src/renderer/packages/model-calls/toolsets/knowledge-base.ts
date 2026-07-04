import { tool } from 'ai'
import { z } from 'zod'
import platform from '@/platform'

export const queryKnowledgeBaseTool = (kbId: number) => {
  return tool({
    description: `Search the knowledge base with a semantic query. Returns relevant document chunks.

Call this when the user's question is related to the attached documents and searching would help you answer more accurately. For greetings, chit-chat, or questions clearly unrelated to the knowledge base, answer directly. For follow-up questions on the same topic, reuse earlier results when they still apply.`,
    inputSchema: z.object({
      query: z.string().describe('The search query - rephrase the user question for better semantic matching'),
    }),
    execute: async (input: { query: string }) => {
      const knowledgeBaseController = platform.getKnowledgeBaseController()
      return await knowledgeBaseController.search(kbId, input.query)
    },
  })
}

export function getFilesMetaTool(knowledgeBaseId: number) {
  return tool({
    description: `Get metadata for files in the current knowledge base. Use this to find out more about files returned from a search, like filename, size, and total number of chunks.`,
    inputSchema: z.object({
      fileIds: z.array(z.number()).describe('An array of file IDs to get metadata for.'),
    }),
    execute: async (input: { fileIds: number[] }) => {
      if (!input.fileIds || input.fileIds.length === 0) {
        throw new Error('Please provide an array of file IDs.')
      }
      const knowledgeBaseController = platform.getKnowledgeBaseController()
      return await knowledgeBaseController.getFilesMeta(knowledgeBaseId, input.fileIds)
    },
  })
}

export function readFileChunksTool(knowledgeBaseId: number) {
  return tool({
    description: `Read content chunks from specified files in the current knowledge base. Use this to get the text content of a document.`,
    inputSchema: z.object({
      chunks: z
        .array(
          z.object({
            fileId: z.number().describe('The ID of the file.'),
            chunkIndex: z.number().describe('The index of the chunk to read, start from 0.'),
          })
        )
        .describe('An array of file and chunk index pairs to read.'),
    }),
    execute: async (input: { chunks: Array<{ fileId: number; chunkIndex: number }> }) => {
      if (!input.chunks || input.chunks.length === 0) {
        throw new Error('Please provide an array of chunks to read.')
      }
      const knowledgeBaseController = platform.getKnowledgeBaseController()
      return await knowledgeBaseController.readFileChunks(knowledgeBaseId, input.chunks)
    },
  })
}

export function listFilesTool(knowledgeBaseId: number) {
  return tool({
    description: `List all files in the current knowledge base. Returns file ID, filename, and chunk count for each file.`,
    inputSchema: z.object({
      page: z.number().describe('The page number to list, start from 0.'),
      pageSize: z.number().describe('The number of files to list per page.'),
    }),
    execute: async (input: { page: number; pageSize: number }) => {
      const knowledgeBaseController = platform.getKnowledgeBaseController()
      const files = await knowledgeBaseController.listFilesPaginated(knowledgeBaseId, input.page, input.pageSize)
      return files
        .filter((file) => file.status === 'done')
        .map((file) => ({
          id: file.id,
          filename: file.filename,
          chunkCount: file.chunk_count || 0,
        }))
    },
  })
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
