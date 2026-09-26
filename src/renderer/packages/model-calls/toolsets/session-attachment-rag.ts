import type { SessionAttachmentQueryPlan } from '@shared/types'
import { jsonSchema, type ToolSet } from 'ai'
import * as remote from '@/packages/remote'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'
import { settingsStore } from '@/stores/settingsStore'
import { asRecord, contentOrErrorText, numberField, stringField, toTextModelOutput } from './model-output'

function formatArrayOutput(output: unknown, formatItem: (item: Record<string, unknown>, index: number) => string) {
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

function formatAttachments(output: unknown): string {
  return formatArrayOutput(output, (item, index) => {
    const filename = stringField(item, 'filename') ?? `Attachment ${index + 1}`
    const status = stringField(item, 'status') ?? stringField(item, 'indexStatus')
    const id = numberField(item, 'id')
    const chunks = numberField(item, 'chunkCount') ?? numberField(item, 'totalChunks')
    const lines = [`Attachment ${index + 1}`, `Name: ${filename}`]
    if (id !== undefined) lines.push(`ID: ${id}`)
    if (status) lines.push(`Status: ${status}`)
    if (chunks !== undefined) lines.push(`Chunks: ${chunks}`)
    return lines.join('\n')
  })
}

function formatSearchResults(output: unknown): string {
  return formatArrayOutput(output, (item, index) => {
    const filename = stringField(item, 'filename') ?? 'Unknown attachment'
    const sectionPath = stringField(item, 'sectionPath')
    const parentId = numberField(item, 'parentId')
    const score = numberField(item, 'score')
    const text = stringField(item, 'text') ?? ''
    const lines = [`Result ${index + 1}`, `Attachment: ${filename}`]
    if (sectionPath) lines.push(`Section: ${sectionPath}`)
    if (parentId !== undefined) lines.push(`Parent ID: ${parentId}`)
    if (score !== undefined) lines.push(`Score: ${score.toFixed(3)}`)
    lines.push('Text:', text)
    return lines.join('\n')
  })
}

function formatParents(output: unknown): string {
  return formatArrayOutput(output, (item, index) => {
    const filename = stringField(item, 'filename') ?? 'Unknown attachment'
    const sectionPath = stringField(item, 'sectionPath')
    const pageStart = numberField(item, 'pageStart')
    const pageEnd = numberField(item, 'pageEnd')
    const text = stringField(item, 'text') ?? ''
    const lines = [`Parent block ${index + 1}`, `Attachment: ${filename}`]
    if (sectionPath) lines.push(`Section: ${sectionPath}`)
    if (pageStart !== undefined && pageEnd !== undefined) lines.push(`Pages: ${pageStart}-${pageEnd}`)
    lines.push('Text:', text)
    return lines.join('\n')
  })
}

export async function getToolSet(attachmentIds: number[]) {
  const controller = platform.getSessionAttachmentRagController()
  const attachments = await controller.getAttachments(attachmentIds)
  const sessionRagConfig = await remote
    .getSessionRagConfig({ licenseKey: settingActions.getLicenseKey() || undefined })
    .catch(() => undefined)
  const remoteRerankModel = sessionRagConfig?.capabilities?.session_attachment_rerank
    ? sessionRagConfig?.models?.rerank
    : undefined
  const defaultRerankModel = settingsStore.getState().defaultRerankModel
  const defaultRerankModelString = defaultRerankModel
    ? `${defaultRerankModel.provider}:${defaultRerankModel.model}`
    : undefined
  const rerankModel = defaultRerankModelString || remoteRerankModel
  const readyAttachments = attachments.filter((attachment) => attachment.status === 'ready')
  const indexingAttachments = attachments.filter(
    (attachment) => attachment.status === 'pending' || attachment.status === 'indexing'
  )
  const failedAttachments = attachments.filter((attachment) => attachment.status === 'failed')

  const readyList =
    readyAttachments.length > 0
      ? readyAttachments.map((attachment) => `- "${attachment.filename}"`).join('\n')
      : '(None yet)'
  const indexingList =
    indexingAttachments.length > 0
      ? indexingAttachments.map((attachment) => `- "${attachment.filename}" (${attachment.status})`).join('\n')
      : ''
  const failedList =
    failedAttachments.length > 0 ? failedAttachments.map((attachment) => `- "${attachment.filename}"`).join('\n') : ''

  const buildQueryPlan = (limit?: number): SessionAttachmentQueryPlan => ({
    recallTopK: 20,
    finalTopK: Math.max(1, Math.min(limit ?? 8, 12)),
    rerank: {
      enabled: !!rerankModel,
      model: rerankModel,
    },
  })

  const tools: ToolSet = {
    list_session_attachments: {
      description: 'List large uploaded attachments in the current session and show their readiness status.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => controller.getAttachments(attachmentIds),
      toModelOutput: toTextModelOutput(formatAttachments),
    },
    query_session_attachment: {
      description: 'Search across ready large uploaded attachments with a semantic query.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A semantic query rewritten from the user request',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 12,
            default: 8,
          },
          currentChapter: {
            type: 'integer',
            description: 'Optional current story chapter number (to filter out future events and spoilers)',
          },
          currentTime: {
            type: 'string',
            description: 'Optional current story time or timeline stage',
          },
          entities: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of entities to prioritize (characters, gu, sects, locations)',
          },
        },
        required: ['query'],
        additionalProperties: false,
      }),
      execute: (input) => {
        const queryInput = input as {
          query: string
          limit?: number
          currentChapter?: number
          currentTime?: string
          entities?: string[]
        }
        const plan = buildQueryPlan(queryInput.limit)
        if (queryInput.currentChapter !== undefined || queryInput.currentTime || queryInput.entities?.length) {
          plan.storyFilter = {
            currentChapter: queryInput.currentChapter,
            currentTime: queryInput.currentTime,
            activeEntities: queryInput.entities,
          }
        }
        return controller.query({
          attachmentIds,
          query: queryInput.query,
          plan,
        })
      },
      toModelOutput: toTextModelOutput(formatSearchResults),
    },
    read_session_attachment_parents: {
      description: 'Read parent blocks for search hits from large uploaded attachments.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          parentIds: {
            type: 'array',
            items: { type: 'number' },
            description: 'Parent block IDs returned by query_session_attachment',
          },
        },
        required: ['parentIds'],
        additionalProperties: false,
      }),
      execute: (input) => {
        const readInput = input as { parentIds: number[] }
        return controller.readParents({ parentIds: readInput.parentIds, attachmentIds })
      },
      toModelOutput: toTextModelOutput(formatParents),
    },
  }

  return {
    description: `
## Session Attachments

Large uploaded files are available through retrieval tools instead of full inline context.
The conversation may contain <ATTACHMENT_FILE> tags with <RETRIEVAL_MODE>session_attachment_rag</RETRIEVAL_MODE>.
Treat those tags as real uploaded files. Their full content is not in the prompt.
When code execution is available, the same <ATTACHMENT_FILE> tags may also include <SANDBOX_PATH> and <PARSED_SANDBOX_PATH>; those fields describe sandbox file paths and do not replace retrieval for document-specific questions.

### Ready files
${readyList}

${indexingList ? `### Still indexing\n${indexingList}\n` : ''}${failedList ? `### Failed\n${failedList}\n` : ''}

### Tools
- **list_session_attachments** - List the current large attachments and their status.
- **query_session_attachment** - Semantic search across the ready large attachments.
- **read_session_attachment_parents** - Read the larger parent blocks behind search hits.

### Usage guidance
- Pay attention to <ATTACHMENT_FILE> tags. A tag with retrieval mode means the user uploaded a file whose content must be retrieved through these tools.
- First consider whether the user's current question might be related to any ready uploaded file listed above.
- If the question might be related to a ready uploaded file, use query_session_attachment before answering, even if you think you could answer from general knowledge alone.
- Prefer querying first with **query_session_attachment**, then read the most relevant parent blocks with **read_session_attachment_parents**.
- Rewrite the user's request into a focused semantic query. In multi-turn conversations, include the relevant previous topic or entity names when they are needed to make the query specific.
- Do not use retrieval for questions that are clearly unrelated to the uploaded files, such as general chat, writing requests with no document dependency, or simple calculations.
- If a file is still indexing, tell the user it is not ready yet instead of guessing.
- If a file has failed, tell the user indexing failed and ask them to retry instead of guessing.
`,
    tools,
  }
}
