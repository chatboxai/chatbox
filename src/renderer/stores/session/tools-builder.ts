import type { ModelInterface } from '@shared/models/types'
import type { SandboxProvider } from '@shared/sandbox-provider'
import type { KnowledgeBase, Message, SessionSettings } from '@shared/types'
import type { UserExecApprovalSource } from '@shared/types/user-exec'
import { getMessageText } from '@shared/utils/message'
import { jsonSchema, type ToolSet } from 'ai'
import { trackAgentModeFullAccessBypass } from '@/analytics/agent-mode'
import { mcpController } from '@/packages/mcp/controller'
import { generateCommandExplanation } from '@/packages/model-calls/command-explanation'
import { buildChatboxCliToolSet } from '@/packages/model-calls/toolsets/chatbox-cli'
import { buildCodeExecutionTools } from '@/packages/model-calls/toolsets/code-execution'
import fileToolSet from '@/packages/model-calls/toolsets/file'
import { buildFilesystemTools } from '@/packages/model-calls/toolsets/filesystem'
import { getToolSet as getKBToolSet } from '@/packages/model-calls/toolsets/knowledge-base'
import { asRecord, numberField, stringField, toTextModelOutput } from '@/packages/model-calls/toolsets/model-output'
import { remapPhantomHomePath } from '@/packages/model-calls/toolsets/sandbox-paths'
import { getToolSet as getSessionAttachmentRagToolSet } from '@/packages/model-calls/toolsets/session-attachment-rag'
import {
  anysearchBatchSearchTool,
  anysearchGetSubDomainsTool,
  anysearchSearchTool,
  getToolSetDescription,
  parseLinkTool,
  webSearchTool,
} from '@/packages/model-calls/toolsets/web-search'
import { skillsController, subscribeSkillsChanged } from '@/packages/skills/controller'
import { type ExplanationContext, requestUserExecApproval } from '@/packages/user-exec-approval'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import * as settingActions from '@/stores/settingActions'
import { settingsStore } from '@/stores/settingsStore'

// Cache discoverSkills() to avoid IPC on every message generation
let cachedSkills: Array<{ name: string; description: string }> | null = null
let cachedSkillsTimestamp = 0
const SKILLS_CACHE_TTL = 30_000 // 30 seconds

async function getDiscoveredSkills(): Promise<Array<{ name: string; description: string }>> {
  const now = Date.now()
  if (cachedSkills && now - cachedSkillsTimestamp < SKILLS_CACHE_TTL) {
    return cachedSkills
  }
  const allSkills = await skillsController.discoverSkills()
  cachedSkills = allSkills.map((s) => ({ name: s.name, description: s.description }))
  cachedSkillsTimestamp = now
  return cachedSkills
}

/** Reset the renderer-side skills cache. Call after installing/deleting skills. */
export function resetSkillsCache(): void {
  cachedSkills = null
  cachedSkillsTimestamp = 0
}

subscribeSkillsChanged(resetSkillsCache)

export interface BuildToolsOptions {
  sessionId?: string
  webBrowsing: boolean
  knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
  messages: Message[]
  agentMode: 'on' | 'off'
  sessionSettings?: SessionSettings
  codeExecution?: {
    sessionId: string
    provider: SandboxProvider
    files: Array<{ storageKey: string; rawStorageKey?: string; name: string }>
  }
  onAgentModeActivated?: () => void
}

export interface BuildToolsResult {
  tools: ToolSet
  instructions: string
}

/**
 * Tell the model where its sandbox working directory is and how to address files there.
 * Without this, models default to phantom home paths like /home/user (a training-prior
 * artifact from cloud sandboxes) that do not exist on the desktop host, wasting tool calls
 * on failed writes. workingDir may be null when the path is not yet known (e.g. cloud).
 */
function buildWorkingDirectoryInstruction(workingDir: string | null, userWorkingDirectories?: string[]): string {
  // Forward slashes remain valid for native Windows file APIs while avoiding copied native paths
  // that POSIX shells interpret differently.
  const formatPathForModel = (filePath: string) => filePath.replace(/\\/g, '/')
  const dirLine = workingDir
    ? `Your sandbox working directory is: ${formatPathForModel(workingDir)}`
    : 'You have a sandbox working directory.'
  // Directories the user requested through the working-directory feature. The host validates
  // them lazily during sandbox initialization, so avoid promising approval-free access here.
  const grantedDirsBlock = userWorkingDirectories?.length
    ? `\nThe user selected these real directories for working-directory access (use their absolute paths):\n${userWorkingDirectories.map((dir) => `- ${formatPathForModel(dir)}`).join('\n')}\nThe host validates each binding before use. Accepted bindings allow structured file-tool writes without additional approval; rejected bindings follow the normal approval flow.\n`
    : ''
  return `
## Working Directory & File Paths
${dirLine}
- For files inside the working directory, prefer relative paths. They resolve from the working directory at the start of each tool call.
- Use an absolute path when the target is outside the working directory, including a user-granted real directory. For these host paths, prefer the structured file tools instead of passing the path to shell code.
- \`code_execution\` already starts in the working directory. Do not prepend \`cd <working-directory>\` to commands.
- On Windows, prefer PowerShell for terminal commands and native filesystem paths. PowerShell accepts native paths such as \`C:\\Users\\name\` and also starts in the working directory, so do not prepend \`Set-Location <working-directory>\`. Use Bash only for POSIX-specific scripts.
- When using Bash on Windows, use Unix shell syntax and forward slashes; never paste a backslash path such as \`C:\\Users\\name\` into Bash. Git Bash accepts \`C:/Users/name/...\`, while WSL uses \`/mnt/c/Users/name/...\`. Because the active shell may differ, use relative paths for targets inside the working directory and structured file tools for host paths outside it.
- In Bash, \`~\` and \`$HOME\` point to the working directory. In PowerShell, use relative paths or \`$PWD\`; do not assume \`$HOME\` is the working directory.
- Do NOT use absolute paths like /home/user or /root — they do not exist here. Write to the working directory instead.
- To create or modify files, prefer the write_file and edit_file tools over writing through code_execution (echo, heredoc, fs.writeFileSync). The structured tools are more reliable and let the user see what changed.
${grantedDirsBlock}`
}

function buildToolUseCommunicationInstruction(): string {
  return `
## Tool-use Communication
When you are about to call one or more tools, first include one short visible sentence explaining what you will do next and why.
- Use the user's language for this sentence.
- Keep it action-oriented and concise.
- If several tool calls are part of the same immediate action, one sentence for the batch is enough.
- You may skip this sentence for trivial single-tool lookups such as reading, listing, or searching.
`
}

function buildSkillToolsInstruction(
  enabledSkills: Array<{ name: string; description: string }>,
  agentFullAccess: boolean,
  userExecWorkingDirectory?: string
): string {
  let instruction = `
## Skills
You have access to skills that can extend your capabilities.
`

  if (enabledSkills.length > 0) {
    instruction += `
### Available Skills
${enabledSkills.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}

When the user's request matches a skill's purpose, call load_skill to load its full instructions before proceeding.
Loading a skill activates agent mode.
`
  } else {
    instruction += `
No skills are currently enabled.
`
  }

  instruction += `
### Running Commands in User Environment
**user_exec** runs commands in the user's real environment with full system access. This is a privileged tool.
In Work Mode, use user_exec when the user's task requires their real environment, including when a loaded skill instructs you to run a host command. It is not limited to skill-driven tasks.
Prefer code_execution (sandbox) for file processing, data analysis, downloading files, and other work that does not require the user's host environment.
Unless Full Access is enabled, every command is still subject to the host approval policy and may pause for user confirmation.
On Windows, user_exec runs PowerShell commands; on macOS/Linux, it runs Bash commands. Write PowerShell syntax directly on Windows, and use newlines or semicolons instead of Bash-only operators such as && so the command also works with Windows PowerShell 5.1. Do not invoke PowerShell from Bash or paste a Windows path into Bash.
${userExecWorkingDirectory ? `user_exec already starts in the first user-granted working directory: ${userExecWorkingDirectory.replace(/\\/g, '/')}. Use relative paths there and do not prepend cd or Set-Location.\n` : 'Without a user-granted working directory, user_exec starts in the user home directory.\n'}
${agentFullAccess ? 'Full Access is enabled, so user_exec commands run without per-command approval.\n' : ''}

### Installing Skills
You can install skills from any source:
1. Use code_execution (sandbox) to download and unpack the skill files
2. Ensure the directory contains a valid SKILL.md with name and description
3. Call install_skill with the sandbox path
The skill will be auto-enabled after installation.
`
  return instruction
}

function formatLoadSkillOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error) return `Error: ${error}`
  const instructions = stringField(record, 'instructions') ?? JSON.stringify(output) ?? String(output)
  const skillRoot = stringField(record, 'skillRoot')
  const filesValue = record?.files
  const files = Array.isArray(filesValue) ? filesValue.filter((file): file is string => typeof file === 'string') : []

  const sections = [instructions]
  if (skillRoot) {
    sections.push(`Skill root: ${skillRoot}\nReplace <SKILL_ROOT> with this absolute path when using referenced files.`)
  }
  if (files.length > 0) {
    sections.push(`Available skill files:\n${files.map((file) => `- ${file}`).join('\n')}`)
  }
  return sections.join('\n\n')
}

function formatInstallSkillOutput(output: unknown): string {
  const record = asRecord(output)
  const error = stringField(record, 'error')
  if (error) return `Error: ${error}`
  const message = stringField(record, 'message')
  if (message) return `Status: success\nMessage: ${message}`
  if (stringField(record, 'message') === '') return 'Skill installation completed.'
  return JSON.stringify(output) ?? String(output)
}

function formatUserExecOutput(output: unknown): string {
  const record = asRecord(output)
  const stdout = stringField(record, 'stdout') ?? ''
  const stderr = stringField(record, 'stderr') ?? ''
  const exitCode = numberField(record, 'exitCode')
  const sections = [`Exit code: ${exitCode ?? 'unknown'}`]
  if (stdout) sections.push(`Stdout:\n${stdout}`)
  if (stderr) sections.push(`Stderr:\n${stderr}`)
  if (!stdout && !stderr) sections.push('(no output)')
  return sections.join('\n\n')
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

/**
 * Builds the tool set and instructions for a chat session based on model capabilities and session options.
 *
 * agentMode is the effective mode resolved by orchestration and controls skill and code execution tool availability:
 * - 'off': No skill or code execution tools
 * - 'on': Full suite — skills + code execution
 */
export async function buildToolsForSession(
  model: ModelInterface,
  options: BuildToolsOptions
): Promise<BuildToolsResult> {
  const { webBrowsing, knowledgeBase, messages, agentMode, codeExecution } = options

  // Agent mode tools require model to support the 'agent' scope.
  // Models with weak function calling (e.g. DeepSeek V3/R1) return false here,
  // so they won't get agent-specific tools (MCP, sandbox, skills, code execution).
  // Web search and Knowledge Base are independent — they work outside agent mode.
  const modelSupportsAgentTools = model.isSupportToolUse('agent')
  const includeAgentTools = agentMode === 'on' && modelSupportsAgentTools

  const hasInlineFileOrLink = messages.some(
    (m) => m.links?.length || m.files?.some((file) => file.ragMode !== 'session-retrieval')
  )
  const sessionAttachmentIds = getSessionAttachmentRagIds(messages)
  // When code execution is enabled, file tools are replaced by code_execution + sandbox read_file.
  const needFileToolSet = !codeExecution && hasInlineFileOrLink && model.isSupportToolUse('read-file')
  const needSessionAttachmentRagToolSet = sessionAttachmentIds.length > 0 && model.isSupportToolUse('read-file')
  const kbSupported = Boolean(knowledgeBase) && model.isSupportToolUse('knowledge-base')
  const webSupported = webBrowsing && model.isSupportToolUse('web-browsing')
  const searchProvider = settingActions.getExtensionSettings().webSearch.provider
  const includeParseLinkTool = webSupported && PROVIDERS_WITH_PARSE_LINK.has(searchProvider)
  const includeAnysearchAdvancedTools = webSupported && searchProvider === 'anysearch'

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

  let instructions = includeAgentTools
    ? `## Context Management
In long conversations, earlier tool call results may be automatically compressed or summarized to stay within the context window. When you receive important results from tool calls, always include the key findings and essential data in your text response — do not rely on being able to re-read previous tool outputs later.
`
    : ''
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
    instructions += getToolSetDescription({
      includeParseLink: includeParseLinkTool,
      includeAnysearchAdvanced: includeAnysearchAdvancedTools,
    })
  }

  let codeExecToolSet: ReturnType<typeof buildCodeExecutionTools> | null = null
  if (includeAgentTools && codeExecution) {
    codeExecToolSet = buildCodeExecutionTools(codeExecution)
    const workingDir = await codeExecution.provider.resolveWorkingDirectory(codeExecution.sessionId).catch(() => null)
    const userWorkingDirectories = options.sessionSettings?.workingDirectories?.filter((dir) => dir.trim().length > 0)
    instructions += buildWorkingDirectoryInstruction(workingDir, userWorkingDirectories)
    instructions += codeExecToolSet.description
  }

  let tools: ToolSet = {}

  // MCP tools: agent mode only, requires model support
  if (includeAgentTools) {
    tools = { ...mcpController.getAvailableTools() }
  }

  // Web search: works independently of agent mode
  if (webBrowsing && webSupported) {
    tools.web_search = webSearchTool
    // Inject parse_link based on the selected provider's declared capability.
    // Validation (Pro for build-in, API key for third parties) happens at execution time.
    if (includeParseLinkTool) {
      tools.parse_link = parseLinkTool
    }
    if (includeAnysearchAdvancedTools) {
      tools.anysearch_batch_search = anysearchBatchSearchTool
      tools.anysearch_get_sub_domains = anysearchGetSubDomainsTool
      tools.anysearch_search = anysearchSearchTool
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

  if (codeExecToolSet) {
    tools = { ...tools, ...codeExecToolSet.tools }
  }

  if (includeAgentTools) {
    const filesystemToolSet = buildFilesystemTools({
      sessionId: codeExecution?.sessionId,
      provider: codeExecution?.provider,
      userWorkingDirectories: options.sessionSettings?.workingDirectories?.filter((dir) => dir.trim().length > 0),
      fullAccess: options.sessionSettings?.agentFullAccess === true,
    })
    instructions += filesystemToolSet.description
    tools = { ...tools, ...filesystemToolSet.tools }
  }

  // Skills tools: agent mode only, requires model support
  if (includeAgentTools) {
    const allSkills = await getDiscoveredSkills()
    const skillSettings = settingsStore.getState().getSettings().skills
    const enabledSkills = allSkills.filter((s) => skillSettings.enabledSkillNames.includes(s.name))
    const userExecWorkingDirectory = options.sessionSettings?.workingDirectories?.find((dir) => dir.trim().length > 0)
    instructions += buildSkillToolsInstruction(
      enabledSkills,
      options.sessionSettings?.agentFullAccess === true,
      userExecWorkingDirectory
    )
    tools.load_skill = buildLoadSkillTool(options)
    if (enabledSkills.some((skill) => skill.name === 'chatbox-product-info')) {
      const chatboxCliToolSet = buildChatboxCliToolSet({
        sessionId: options.sessionId,
        onUsed: options.onAgentModeActivated,
      })
      instructions += chatboxCliToolSet.description
      tools = { ...tools, ...chatboxCliToolSet.tools }
    }
    tools.user_exec = buildUserExecTool(options)
    if (codeExecution) {
      tools.install_skill = buildInstallSkillTool(options)
    }
  }

  if (Object.keys(tools).length > 0) {
    instructions = buildToolUseCommunicationInstruction() + instructions
  }

  return { tools, instructions }
}

function buildLoadSkillTool(options: BuildToolsOptions): ToolSet[string] {
  return {
    description:
      "Load a skill by name to get its full instructions. Call this when the user's request " +
      'matches an available skill. Available skills are listed in the system instructions.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the skill to load',
        },
      },
      required: ['name'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const skillInput = input as { name: string }
      const skillSettings = settingsStore.getState().getSettings().skills
      if (!skillSettings.enabledSkillNames.includes(skillInput.name)) {
        return {
          error: `Skill "${skillInput.name}" is not enabled. Check available skills in the system instructions.`,
        }
      }

      const result = await skillsController.loadSkill(skillInput.name)
      if (!result) {
        return { error: `Skill "${skillInput.name}" not found or could not be loaded.` }
      }

      // Trigger agent mode activation
      try {
        options.onAgentModeActivated?.()
      } catch (err) {
        console.warn('onAgentModeActivated callback failed:', err)
      }

      return {
        instructions: result.body,
        skillRoot: result.skillRoot,
        files: result.files ?? [],
      }
    },
    toModelOutput: toTextModelOutput(formatLoadSkillOutput, { emptyFallback: 'Skill instructions are empty.' }),
  }
}

function buildInstallSkillTool(options: BuildToolsOptions): ToolSet[string] {
  return {
    description:
      'Install a skill from a prepared directory. ' +
      'First use code_execution (sandbox) to download/unpack the skill files, ensure the directory ' +
      'contains a valid SKILL.md with name and description fields, then call this tool. ' +
      'The skill will be auto-enabled after installation.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        sandboxPath: {
          type: 'string',
          description: 'Path to the skill directory (must contain SKILL.md)',
        },
        sourceInfo: {
          type: 'string',
          description: 'Where the skill came from (URL, repo, etc.) for tracking',
        },
      },
      required: ['sandboxPath'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const installInput = input as { sandboxPath: string; sourceInfo?: string }
      if (!options.codeExecution) {
        return { error: 'Code execution not available. Agent mode with sandbox is required.' }
      }

      // Tolerate phantom home paths (e.g. /home/user/skill) the model may emit; the
      // installer resolves relative paths against the sandbox working directory.
      const sandboxPath = remapPhantomHomePath(installInput.sandboxPath)

      const result = await skillsController.installFromSandbox(
        sandboxPath,
        options.codeExecution.sessionId,
        installInput.sourceInfo
      )

      if (!result.success) {
        return { error: result.error || 'Installation failed.' }
      }

      // Auto-enable the installed skill
      settingsStore.setState((state) => ({
        skills: {
          ...state.skills,
          enabledSkillNames: [...new Set([...state.skills.enabledSkillNames, result.skillName])],
        },
      }))

      // Reset renderer-side skills cache so load_skill sees the new skill immediately
      resetSkillsCache()

      // Trigger agent mode activation
      try {
        options.onAgentModeActivated?.()
      } catch (err) {
        console.warn('onAgentModeActivated callback failed:', err)
      }

      return {
        success: true,
        skillName: result.skillName,
        message: `Skill "${result.skillName}" installed and enabled. You can now use load_skill("${result.skillName}") to load it.`,
      }
    },
    toModelOutput: toTextModelOutput(formatInstallSkillOutput, { emptyFallback: 'Skill installation completed.' }),
  }
}

function buildUserExecTool(options: BuildToolsOptions): ToolSet[string] {
  const agentFullAccess = options.sessionSettings?.agentFullAccess === true
  const userExecWorkingDirectory = options.sessionSettings?.workingDirectories?.find((dir) => dir.trim().length > 0)
  type UserExecResult = {
    success: boolean
    exitCode: number | null
    stdout: string
    stderr: string
    cancelled?: boolean
  }
  const executionCache = new Map<string, { command: string; promise: Promise<UserExecResult> }>()

  return {
    description:
      "Execute a command in the user's real environment (not sandbox). " +
      'RESTRICTED: Only use when a loaded skill explicitly requires running a command in the user environment. ' +
      'Do NOT use for general tasks — use code_execution (sandbox) instead. ' +
      'Runs PowerShell on Windows and Bash on macOS/Linux with full system access. ' +
      (agentFullAccess
        ? 'Full Access is enabled, so commands run without per-command approval.'
        : 'Clearly safe commands may be approved automatically; other commands require user approval.'),
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'PowerShell command on Windows; Bash command on macOS/Linux',
        },
      },
      required: ['command'],
      additionalProperties: false,
    }),
    execute: (input, toolOptions) => {
      const execInput = input as { command: string }
      const existingExecution = executionCache.get(toolOptions.toolCallId)
      if (existingExecution) {
        if (existingExecution.command !== execInput.command) {
          return Promise.reject(new Error(`Tool call ${toolOptions.toolCallId} was reused with a different command`))
        }
        return existingExecution.promise
      }

      const alreadyApproved = (toolOptions as typeof toolOptions & { approved?: boolean }).approved
      let hostExecutionStarted = false
      const execution = Promise.resolve().then(async (): Promise<UserExecResult> => {
        const recentUserMsgs = options.messages
          .filter((m) => m.role === 'user')
          .slice(-3)
          .map((m) => getMessageText(m, true, false).slice(0, 500))
        const userContext = recentUserMsgs.join('\n---\n')

        const sessionSettings = options.sessionSettings
        const explanationCtx: ExplanationContext | undefined = sessionSettings
          ? {
              userContext,
              generateExplanation: (cmd, ctx, onStream, signal) =>
                generateCommandExplanation(sessionSettings, cmd, ctx, onStream, signal),
            }
          : undefined

        let approvalSource: UserExecApprovalSource
        if (alreadyApproved) {
          approvalSource = 'user'
        } else if (agentFullAccess) {
          approvalSource = 'full_access'
        } else {
          approvalSource = await requestUserExecApproval(
            toolOptions.toolCallId,
            execInput.command,
            explanationCtx,
            toolOptions.abortSignal
          )
        }

        // Track when Full Access skipped an approval, regardless of whether the
        // command later succeeds — failed bypassed attempts are the audit signal.
        if (!alreadyApproved && agentFullAccess) {
          trackAgentModeFullAccessBypass({ tool: 'user_exec' })
        }
        throwIfAborted(toolOptions.abortSignal)
        hostExecutionStarted = true
        const sessionId = options.sessionId ?? options.codeExecution?.sessionId
        const cancelHostExecution = () => {
          void skillsController.cancelUserExec({ sessionId, toolCallId: toolOptions.toolCallId })
        }
        toolOptions.abortSignal?.addEventListener('abort', cancelHostExecution, { once: true })
        let result: Awaited<ReturnType<typeof skillsController.userExec>>
        try {
          result = await skillsController.userExec(execInput.command, {
            ...(userExecWorkingDirectory ? { cwd: userExecWorkingDirectory } : {}),
            sessionId,
            toolCallId: toolOptions.toolCallId,
            approvalSource,
          })
        } finally {
          toolOptions.abortSignal?.removeEventListener('abort', cancelHostExecution)
        }

        try {
          options.onAgentModeActivated?.()
        } catch {
          // ignore
        }

        return {
          success: result.success,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(result.cancelled ? { cancelled: true } : {}),
        }
      })

      executionCache.set(toolOptions.toolCallId, { command: execInput.command, promise: execution })
      void execution.catch(() => {
        if (!hostExecutionStarted && executionCache.get(toolOptions.toolCallId)?.promise === execution) {
          executionCache.delete(toolOptions.toolCallId)
        }
      })
      return execution
    },
    toModelOutput: toTextModelOutput(formatUserExecOutput),
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}
