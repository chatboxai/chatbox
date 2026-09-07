import { MEMORY_ENTRY_MAX_CHARS, type MemoryScope } from '@shared/types/agent-persona'
import { jsonSchema, type ToolSet } from 'ai'
import { addMemoryForScope, deleteMemoryForScope } from '@/stores/agentPersonaStore'
import { asRecord, stringField, toTextModelOutput } from './model-output'

const GLOBAL_SCOPE: MemoryScope = { type: 'global' }

function formatMemoryOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error) return `Error: ${error}`
  const message = stringField(record, 'message')
  return message ?? JSON.stringify(output)
}

function buildSaveMemoryTool(scope: MemoryScope, languageName: string | undefined): ToolSet[string] {
  const languageLine = languageName
    ? `\nWrite the memory content in the user's preferred language: ${languageName}.`
    : ''
  return {
    description: `Save a durable fact to your persistent memory. It becomes part of your system prompt in FUTURE sessions (the current session keeps its frozen snapshot).
Save only facts that will still matter across sessions: stable user preferences, environment details, corrections to your approach, project-level conventions. Do not save one-off task state, secrets, or anything the user asked to keep out of memory. Keep each entry a single compact fact under ${MEMORY_ENTRY_MAX_CHARS} characters.${languageLine}`,
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact to remember, as one compact self-contained sentence or two',
        },
      },
      required: ['content'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const { content } = input as { content: string }
      const result = await addMemoryForScope(scope, content)
      if (!result.ok) return { error: result.error }
      return { message: `Memory saved with id ${result.entry.id}. It will be loaded in future agent sessions.` }
    },
    toModelOutput: toTextModelOutput(formatMemoryOutput),
  }
}

function buildDeleteMemoryTool(scope: MemoryScope): ToolSet[string] {
  return {
    description:
      'Delete a stale or incorrect entry from your persistent memory by id. Ids appear as [id] prefixes in the Memories section of your system prompt. The current session keeps its frozen snapshot; the deletion applies to future sessions.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The id of the memory entry to delete',
        },
      },
      required: ['id'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const { id } = input as { id: string }
      const deleted = await deleteMemoryForScope(scope, id)
      return deleted ? { message: `Memory ${id} deleted.` } : { error: `No memory found with id ${id}.` }
    },
    toModelOutput: toTextModelOutput(formatMemoryOutput),
  }
}

export interface AgentMemoryToolsOptions {
  /** Native name of the user's UI language (for example 简体中文); memories are written in it. */
  languageName?: string
  /** Memory store the tools read and write; defaults to the global one. */
  scope?: MemoryScope
}

export function buildAgentMemoryTools(options: AgentMemoryToolsOptions = {}): { tools: ToolSet; description: string } {
  const scope = options.scope ?? GLOBAL_SCOPE
  const languageLine = options.languageName
    ? `\n- Write memory content in the user's preferred language (${options.languageName}), regardless of the conversation language, so memories stay readable in Settings.`
    : ''
  const scopeLine =
    scope.type === 'copilot'
      ? '\n- Your memory belongs to the assistant persona of this conversation: entries load only in future sessions that use the same assistant.'
      : ''
  return {
    tools: {
      save_memory: buildSaveMemoryTool(scope, options.languageName),
      delete_memory: buildDeleteMemoryTool(scope),
    },
    description: `
## Persistent Memory
You have cross-session memory. Entries appear in the Memories section of your system prompt at session start; the prompt is a frozen snapshot, so writes apply to future sessions only.
- When the user states a durable preference, corrects your approach, or you learn a stable fact about their environment, save it with save_memory right away.
- When an existing memory turns out to be wrong or obsolete, delete it with delete_memory (then save a corrected entry if needed).
- Never store secrets (API keys, passwords) or information the user asked you not to keep.${scopeLine}${languageLine}
`,
  }
}
