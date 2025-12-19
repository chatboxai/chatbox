import { tool } from 'ai'
import { z } from 'zod'
import platform from '@/platform'

export const queryKnowledgeBaseTool = (kbId: number) => {
  return tool({
    description: 'Query a knowledge base',
    inputSchema: z.object({
      query: z.string().describe('The query to search the knowledge base'),
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
        return 'Please provide an array of file IDs.'
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
        return 'Please provide an array of chunks to read.'
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
const getToolSetDescription = (knowledgeBaseId: number, knowledgeBaseName: string) => {
  return `
  Toolset for interacting with a knowledge base ${knowledgeBaseName}. Includes tools to query the knowledge base, get file metadata, read file chunks, and list files.
  Available tools:
  1. query_knowledge_base: Query the knowledge base with a search query.
  2. get_files_meta: Get metadata for files in the knowledge base.
  3. read_file_chunks: Read content chunks from specified files in the knowledge base.
  4. list_files: List all files in the knowledge base.
`
}
export function getToolSet(knowledgeBaseId: number, knowledgeBaseName: string) {
  return {
    description: getToolSetDescription(knowledgeBaseId, knowledgeBaseName),
    tools: {
      query_knowledge_base: queryKnowledgeBaseTool(knowledgeBaseId),
      get_files_meta: getFilesMetaTool(knowledgeBaseId),
      read_file_chunks: readFileChunksTool(knowledgeBaseId),
      list_files: listFilesTool(knowledgeBaseId),
    },
  }
}
