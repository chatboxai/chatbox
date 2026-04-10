import type { ModelInterface } from '@shared/models/types'
import type { KnowledgeBase, Message } from '@shared/types'
import type { SkillInfo } from '@shared/types/skills'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { mcpController } from '@/packages/mcp/controller'
import fileToolSet from '@/packages/model-calls/toolsets/file'
import { getToolSet as getKBToolSet } from '@/packages/model-calls/toolsets/knowledge-base'
import sandboxToolSet from '@/packages/model-calls/toolsets/sandbox'
import websearchToolSet, { parseLinkTool, webSearchTool } from '@/packages/model-calls/toolsets/web-search'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import { skillsController } from '@/packages/skills/controller'
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

  const hasFileOrLink = messages.some((m) => m.files?.length || m.links?.length)
  const needFileToolSet = hasFileOrLink && model.isSupportToolUse('read-file')
  const kbSupported = knowledgeBase && model.isSupportToolUse('knowledge-base')
  const webSupported = webBrowsing && model.isSupportToolUse('web-browsing')

  let kbToolSet: Awaited<ReturnType<typeof getKBToolSet>> | null = null
  if (knowledgeBase && kbSupported) {
    try {
      kbToolSet = await getKBToolSet(knowledgeBase.id, knowledgeBase.name)
    } catch (err) {
      console.error('Failed to load knowledge base toolset:', err)
    }
  }

  let instructions = ''
  if (kbToolSet && kbSupported) {
    instructions += kbToolSet.description
  }
  if (needFileToolSet) {
    instructions += fileToolSet.description
  }
  if (webSupported) {
    instructions += websearchToolSet.description
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
    // Validation (Pro for build-in, API key for third parties) happens at execution time.
    const searchProvider = settingActions.getExtensionSettings().webSearch.provider
    if (PROVIDERS_WITH_PARSE_LINK.has(searchProvider)) {
      tools.parse_link = parseLinkTool
    }
  }

  if (kbToolSet && kbSupported) {
    tools = { ...tools, ...kbToolSet.tools }
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
              return { error: `Skill "${input.name}" is not enabled for this session.` }
            }
            const result = await skillsController.loadSkill(input.name)
            if (!result) {
              return { error: `Skill "${input.name}" not found or could not be loaded.` }
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
              return {
                success: false,
                stdout: '',
                stderr: `Skill "${input.skill_name}" is not enabled.`,
                exitCode: null,
              }
            }
            const result = await skillsController.executeScript(input.skill_name, input.script_name, input.arguments)
            return result
          },
        })
      }
    }
  }

  return { tools, instructions }
}
