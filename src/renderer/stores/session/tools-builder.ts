import type { ModelInterface } from '@shared/models/types'
import type { KnowledgeBase, Message } from '@shared/types'
import type { SkillInfo } from '@shared/types/skills'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { mcpController } from '@/packages/mcp/controller'
import fileToolSet from '@/packages/model-calls/toolsets/file'
import { getToolSet as getKBToolSet } from '@/packages/model-calls/toolsets/knowledge-base'
import sandboxToolSet from '@/packages/model-calls/toolsets/sandbox'
import { getToolSet as getSessionAttachmentRagToolSet } from '@/packages/model-calls/toolsets/session-attachment-rag'
import { getToolSetDescription, parseLinkTool, webSearchTool } from '@/packages/model-calls/toolsets/web-search'
import { skillsController } from '@/packages/skills/controller'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import * as settingActions from '@/stores/settingActions'

export interface BuildToolsOptions {
  webBrowsing: boolean
  knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
  messages: Message[]
  sandboxEnabled?: boolean
  enabledSkillNames?: string[]
}

export interface BuildToolsResult {
  tools: ToolSet
  instructions: string
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Normalizes tool failures onto a single channel: a thrown Error.
 *
 * Every toolset added below reports infrastructure failures by throwing; the AI SDK
 * turns a throw into a `tool-error` stream part, forwards the message to the model,
 * and continues the step loop. This wrapper is the safety net at the assembly
 * boundary for tools that don't follow the convention (e.g. third-party MCP tools):
 * non-Error throws are wrapped, and returned Error instances — which would otherwise
 * JSON-serialize to `{}` in the tool result the model sees — are converted to throws.
 * Aborts pass through untouched so cancellation keeps its existing semantics.
 */
export function normalizeToolSetErrors(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    const execute = t.execute?.bind(t)
    if (!execute) {
      wrapped[name] = t
      continue
    }
    wrapped[name] = {
      ...t,
      execute: async (args, options) => {
        let result: unknown
        try {
          result = await execute(args, options)
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err
          }
          throw err instanceof Error ? err : new Error(`Tool "${name}" failed: ${String(err)}`)
        }
        if (result instanceof Error) {
          throw result
        }
        return result
      },
    }
  }
  return wrapped
}

function getSessionAttachmentRagIds(messages: Message[]): number[] {
  return Array.from(
    new Set(
      messages.flatMap((message) =>
        (message.files ?? [])
          .filter(
            (file) =>
              file.ragMode === 'session-retrieval' &&
              file.sessionAttachmentAvailability !== 'blocked' &&
              typeof file.sessionAttachmentId === 'number'
          )
          .map((file) => file.sessionAttachmentId as number)
      )
    )
  )
}

export function generateSkillsXml(skills: SkillInfo[], toolUseSupported = false): string {
  const skillEntries = skills
    .map(
      (s) => `<skill>
  <name>${escapeXml(s.name)}</name>
  <description>${escapeXml(s.description)}</description>
</skill>`
    )
    .join('\n')

  const toolHint = toolUseSupported
    ? "\nWhen a task matches a skill's description, use the load_skill tool to load its full instructions before proceeding.\n"
    : '\n'

  return `
<available_skills>
${skillEntries}
</available_skills>
${toolHint}`
}

/**
 * Builds the tool set and instructions for a chat session based on model capabilities and session options.
 *
 * Returns tools only for features the model supports.
 * Returns instructions for the system prompt describing available toolsets.
 */
export async function buildToolsForSession(
  model: ModelInterface,
  options: BuildToolsOptions
): Promise<BuildToolsResult> {
  const { webBrowsing, knowledgeBase, messages, sandboxEnabled, enabledSkillNames } = options

  const hasInlineFileOrLink = messages.some(
    (m) => m.links?.length || m.files?.some((file) => file.ragMode !== 'session-retrieval')
  )
  const sessionAttachmentIds = getSessionAttachmentRagIds(messages)
  const needFileToolSet = hasInlineFileOrLink && model.isSupportToolUse('read-file')
  const needSessionAttachmentRagToolSet = sessionAttachmentIds.length > 0 && model.isSupportToolUse('read-file')
  const kbSupported = knowledgeBase && model.isSupportToolUse('knowledge-base')
  const webSupported = webBrowsing && model.isSupportToolUse('web-browsing')
  const searchProvider = settingActions.getExtensionSettings().webSearch.provider
  const includeParseLinkTool = webSupported && PROVIDERS_WITH_PARSE_LINK.has(searchProvider)

  let kbToolSet: Awaited<ReturnType<typeof getKBToolSet>> | null = null
  if (knowledgeBase && kbSupported) {
    try {
      kbToolSet = await getKBToolSet(knowledgeBase.id, knowledgeBase.name)
    } catch (err) {
      console.error('Failed to load knowledge base toolset:', err)
    }
  }

  let sessionAttachmentRagToolSet: Awaited<ReturnType<typeof getSessionAttachmentRagToolSet>> | null = null
  if (needSessionAttachmentRagToolSet) {
    try {
      sessionAttachmentRagToolSet = await getSessionAttachmentRagToolSet(sessionAttachmentIds)
    } catch (err) {
      console.error('Failed to load session attachment RAG toolset:', err)
    }
  }

  let instructions = ''
  if (kbToolSet && kbSupported) {
    instructions += kbToolSet.description
  }
  if (sessionAttachmentRagToolSet) {
    instructions += sessionAttachmentRagToolSet.description
  }
  if (needFileToolSet) {
    instructions += fileToolSet.description
  }
  if (webSupported) {
    instructions += getToolSetDescription({ includeParseLink: includeParseLinkTool })
  }
  if (sandboxEnabled) {
    instructions += sandboxToolSet.description
  }

  let tools: ToolSet = {
    ...mcpController.getAvailableTools(),
  }

  if (webBrowsing && webSupported) {
    tools.web_search = webSearchTool
    // Inject parse_link based on the selected provider's declared capability.
    // Provider-specific validation, such as API keys, happens at execution time.
    if (includeParseLinkTool) {
      tools.parse_link = parseLinkTool
    }
  }

  if (kbToolSet && kbSupported) {
    tools = { ...tools, ...kbToolSet.tools }
  }

  if (sessionAttachmentRagToolSet) {
    tools = { ...tools, ...sessionAttachmentRagToolSet.tools }
  }

  if (needFileToolSet) {
    tools = { ...tools, ...fileToolSet.tools }
  }

  if (sandboxEnabled) {
    tools = { ...tools, ...sandboxToolSet.tools }
  }

  // Skills integration
  if (enabledSkillNames && enabledSkillNames.length > 0) {
    let allSkills: SkillInfo[] = []
    try {
      allSkills = await skillsController.discoverSkills()
    } catch (err) {
      console.error('Failed to discover skills:', err)
    }

    const enabledSkills = allSkills.filter((s) => enabledSkillNames.includes(s.name))

    if (enabledSkills.length > 0) {
      instructions += generateSkillsXml(enabledSkills, model.isSupportToolUse())

      if (model.isSupportToolUse()) {
        tools.load_skill = tool({
          description:
            "Load the full instructions of a skill by name. Call this when a task matches a skill's description from the available_skills list.",
          inputSchema: z.object({
            name: z.string().describe('The name of the skill to load'),
          }),
          execute: async (input: { name: string }) => {
            if (!enabledSkillNames.includes(input.name)) {
              throw new Error(`Skill "${input.name}" is not enabled for this session.`)
            }
            const result = await skillsController.loadSkill(input.name)
            if (!result) {
              throw new Error(`Skill "${input.name}" not found or could not be loaded.`)
            }
            return { instructions: result.body }
          },
        })

        tools.execute_skill_script = tool({
          description:
            "Execute a script from a skill's scripts directory. Use when a loaded skill references executable scripts.",
          inputSchema: z.object({
            skill_name: z.string().describe('The name of the skill'),
            script_name: z.string().describe('The script filename to execute'),
            arguments: z.array(z.string()).optional().describe('Optional arguments to pass to the script'),
          }),
          execute: async (input: { skill_name: string; script_name: string; arguments?: string[] }) => {
            if (!enabledSkillNames.includes(input.skill_name)) {
              throw new Error(`Skill "${input.skill_name}" is not enabled for this session.`)
            }
            // A script that ran but exited non-zero is a result ({success, stdout,
            // stderr, exitCode}), not an error — the model needs the output detail.
            const result = await skillsController.executeScript(input.skill_name, input.script_name, input.arguments)
            return result
          },
        })
      }
    }
  }

  return { tools: normalizeToolSetErrors(tools), instructions }
}
