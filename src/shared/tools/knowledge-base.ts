/** The knowledge base is one tool whose `command` selects the operation. */
export const KNOWLEDGE_BASE_TOOL_NAME = 'knowledge_base'

export const KNOWLEDGE_BASE_COMMANDS = ['search', 'read', 'list'] as const

export type KnowledgeBaseCommand = (typeof KNOWLEDGE_BASE_COMMANDS)[number]

export function knowledgeBaseCommandOf(input: unknown): KnowledgeBaseCommand | undefined {
  const command = (input as { command?: unknown } | null | undefined)?.command
  return KNOWLEDGE_BASE_COMMANDS.find((known) => known === command)
}
