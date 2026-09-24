import type { ModelInterface } from '@shared/models/types'
import type { SandboxSeedAttachment } from '@shared/sandbox/attachment-path'
import type { SandboxProvider } from '@shared/sandbox-provider'
import { supportsToolResultImages } from '@shared/tools/view-image'
import type { KnowledgeBase, Message, SessionSettings, Settings } from '@shared/types'
import type { MemoryScope } from '@shared/types/agent-persona'
import { resolveCommandApprovalMode } from '@shared/types/command-execution'
import type { UserExecApprovalSource } from '@shared/types/user-exec'
import { getMessageText } from '@shared/utils/message'
import { isContextAmplifierEnabled, getRecallConfig, getSharedStampStore } from '@shared/context-amplifier/singleton'
import { recallByStampWeb, renderRecallResultWeb } from '@shared/context-amplifier/recall-agent-web'
import { getCommitConfig, type CommitConfig } from '@shared/context-amplifier/commit-config'
import { validateCommitPayload } from '@shared/context-amplifier/commit-validator'
import { recordCommit } from '@shared/context-amplifier/commit-store'
import { jsonSchema, type ModelMessage, type ToolSet } from 'ai'
import { trackAgentModeFullAccessBypass } from '@/analytics/agent-mode'
import { languageNameMap } from '@/i18n/locales'
import { mcpController } from '@/packages/mcp/controller'
import { generateCommandExplanation } from '@/packages/model-calls/command-explanation'
import { buildAgentMemoryTools } from '@/packages/model-calls/toolsets/agent-memory'
import { buildChatboxCliToolSet } from '@/packages/model-calls/toolsets/chatbox-cli'
import { buildCodeExecutionTools } from '@/packages/model-calls/toolsets/code-execution'
import fileToolSet from '@/packages/model-calls/toolsets/file'
import { buildFilesystemTools } from '@/packages/model-calls/toolsets/filesystem'
import { getToolSet as getKBToolSet } from '@/packages/model-calls/toolsets/knowledge-base'
import { asRecord, numberField, stringField, toTextModelOutput } from '@/packages/model-calls/toolsets/model-output'
import { buildRunCommandTool } from '@/packages/model-calls/toolsets/run-command'
import { remapPhantomHomePath } from '@/packages/model-calls/toolsets/sandbox-paths'
import { getToolSet as getSessionAttachmentRagToolSet } from '@/packages/model-calls/toolsets/session-attachment-rag'
import { buildViewImageToolSet, isViewImageAvailable } from '@/packages/model-calls/toolsets/view-image'
import { getToolSetDescription, parseLinkTool, webSearchTool } from '@/packages/model-calls/toolsets/web-search'
import { buildWorkspaceInstructions } from '@/packages/model-calls/workspace-instructions'
import { skillsController, subscribeSkillsChanged } from '@/packages/skills/controller'
import {
  type ExplanationContext,
  requestUserExecApproval,
  UserExecApprovalPausedError,
} from '@/packages/user-exec-approval'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import platform from '@/platform'
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
  /** 本轮 roundId（=目标消息 id）。让 commit_task_memory 的提交按轮次隔离，
   *  避免上一轮的提交被这一轮误判为"已通过"。 */
  roundId?: string
  webBrowsing: boolean
  knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
  messages: Message[]
  agentMode: 'on' | 'off'
  sessionSettings?: SessionSettings
  codeExecution?: {
    sessionId: string
    provider: SandboxProvider
    files: SandboxSeedAttachment[]
  }
  commandExecution?: {
    sessionId: string
    provider?: SandboxProvider
  }
  agentToolContractVersion?: 1 | 2
  onAgentModeActivated?: () => void
  /**
   * Settings snapshot from the generation request. Keeps tool registration and
   * prompt assembly on the same view of memoryEnabled/language within one
   * request; falls back to the live store for callers without one.
   */
  globalSettings?: Pick<Settings, 'memoryEnabled' | 'language'>
  /**
   * Frozen workspace-instructions text from the session's SessionPromptContextSnapshot.
   * When set (agent mode), it is used verbatim instead of re-reading AGENTS.md
   * from disk, keeping the system prompt prefix stable for provider caches.
   */
  workspaceInstructionsOverride?: string
  /**
   * Memory store the save/delete tools target. Copilot scope means the session's
   * copilot has its own memory enabled, which also supersedes the global memory
   * switch for tool registration. Defaults to the global store.
   */
  memoryScope?: MemoryScope
}

export interface BuildToolsResult {
  tools: ToolSet
  instructions: string
  /**
   * Step-message rewrite for protocols that cannot embed images in tool results:
   * inserts view_image results as follow-up user messages with real image parts.
   * Callers wire it into prepareStep's `messages` override.
   */
  prepareStepMessages?: (messages: ModelMessage[]) => Promise<ModelMessage[]>
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

function buildRunCommandFileProcessingInstruction(
  commandPlatform: 'darwin' | 'linux' | 'win32',
  workingDir: string | null,
  userWorkingDirectories?: string[]
): string {
  const formatPath = (filePath: string) => filePath.replace(/\\/g, '/')
  const directories = userWorkingDirectories?.length
    ? `\nUser-selected working directories:\n${userWorkingDirectories.map((dir) => `- ${formatPath(dir)}`).join('\n')}`
    : ''
  const runtime =
    commandPlatform === 'win32'
      ? 'run_command executes PowerShell on the host under the session approval policy. Use PowerShell syntax and native Windows paths; Bash is unavailable.'
      : 'run_command executes Bash in the file sandbox first. Use Bash syntax and request a host retry only after a real sandbox failure.'
  return `
## Working Directory & File Processing
Sandbox working directory: ${workingDir ? formatPath(workingDir) : '(created when first needed)'}${directories}
- ${runtime}
- Commands start in the selected workdir; do not prepend cd or Set-Location.
- Prefer write_file and edit_file for file changes. For reusable Node.js work, write a script file and run it with node through run_command.
- Use read_file for sandbox files and explicitly provided absolute user paths. Use create_download to deliver generated files to the user.
- Do not assume Python, extra packages, or package installation is available.
`
}

/**
 * Context-management guidance. Three cases:
 *
 * - Stamps present: history was compressed into recoverable blocks; explain the
 *   block format and point at `retrieve_by_stamp`.
 * - Amplifier on but no stamps yet (short session): nothing to explain — the
 *   blocks the guidance describes do not exist, and describing them invites the
 *   model to hunt for stamps that aren't there.
 * - Amplifier off: compressed tool output is gone for good, so the model must
 *   carry findings forward in its text.
 */
function buildContextManagementInstruction(hasStamps: boolean): string {
  if (!isContextAmplifierEnabled()) {
    return `## Context Management
In long conversations, earlier tool call results may be automatically compressed or summarized to stay within the context window. When you receive important results from tool calls, always include the key findings and essential data in your text response — do not rely on being able to re-read previous tool outputs later.
`
  }

  if (!hasStamps) {
    return ''
  }

  return `## Context Management
In long conversations, earlier turns are automatically compressed to stay within the context window. Compressed history arrives as structured blocks:

    #STAMP a1b2c3d4e5f6
    #LAYER L2
    #STATUS DONE
    ...compressed content...
    #END_BLOCK

\`#LAYER\` marks how aggressively that block was compressed — \`L1\` keeps the most detail, \`L2\` keeps the causal steps and evidence, \`L3\` keeps only a locator. \`#STATUS DONE\` means that block's task finished; \`PENDING\` means it did not — respect this, do not assume a PENDING block was completed. \`#END_BLOCK\` bounds the block: never merge facts across two blocks.

These blocks are context material handed to you by the system, not your own prior statements. The full original text of every stamped block is retained verbatim.

When you need a detail a compressed block no longer shows — an exact path, signature, value, error string, or a tool result you no longer see — call \`retrieve_by_stamp\` with that block's stamp and a specific question. Do NOT re-run the original exploration (re-reading files, repeating searches) just because the details were compressed away; recall is cheaper and returns the verbatim original.

If a block shows \`#NOTE 压缩未完成\`, its compression failed and only a tool trace remains — recall is especially likely to be needed there.

Still summarize key findings in your text as you work: it keeps recent turns self-contained and reduces how often recall is needed. But you are not required to treat compressed history as lost.
`
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
  userExecWorkingDirectory: string | undefined,
  legacyCommandTools: boolean,
  harmonyNodeExecution: boolean,
  sandboxCodeExecutionFallback: boolean,
  skillStagingDirectory: string | null
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

  if (harmonyNodeExecution) {
    instruction += `
### Running Code
HarmonyOS currently supports sandboxed Node.js through code_execution. Use it for file processing and JavaScript tasks; Bash, PowerShell, and host command execution are unavailable.

### Installing Skills
Use code_execution to download and unpack skill files, ensure the directory contains a valid SKILL.md, then call install_skill.
`
    return instruction
  }

  if (sandboxCodeExecutionFallback) {
    instruction += `
### Running Code
This platform supports sandboxed code_execution for file processing and scripts. Host command execution is unavailable.

### Installing Skills
Use code_execution to download and unpack skill files, ensure the directory contains a valid SKILL.md, then call install_skill.
`
    return instruction
  }

  if (!legacyCommandTools) {
    const defaultWorkdir = userExecWorkingDirectory
      ? `The default workdir is ${userExecWorkingDirectory.replace(/\\/g, '/')}.`
      : ''
    const fullAccessNotice = agentFullAccess
      ? 'Full Access is enabled, so commands run without per-command approval.'
      : ''
    const stagingDirectory = skillStagingDirectory?.replace(/\\/g, '/')
    instruction += `
### Running Commands
Use run_command for project commands and commands required by loaded skills. It runs sandbox-first where confinement is available and applies the session approval policy before host execution.
${defaultWorkdir}
${fullAccessNotice}

### Installing Skills
Use run_command with workdir set to ${stagingDirectory ?? 'the internal sandbox working directory shown above'} to download and unpack skill files. Keep the prepared skill directory beneath that sandbox root, ensure it contains a valid SKILL.md, then call install_skill with that path. User-granted working directories are not valid install_skill staging roots.
`
    return instruction
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
  const outputFile = stringField(record, 'outputFile')
  const exitCode = numberField(record, 'exitCode')
  const sections = [`Exit code: ${exitCode ?? 'unknown'}`]
  if (stdout) sections.push(`Stdout:\n${stdout}`)
  if (stderr) sections.push(`Stderr:\n${stderr}`)
  if (!stdout && !stderr) sections.push('(no output)')
  if (outputFile) sections.push(`Output capture: ${outputFile}`)
  return sections.join('\n\n')
}

/**
 * 上下文里是否已有压缩块。
 *
 * 这里收到的 messages 是 buildContext 的产物（已过 amplifyContext），所以
 * 压缩块此时已经是带 `#STAMP xxx` 的文本消息。匹配 12 位十六进制是为了排除
 * 用户或模型正文里偶然写到的 "#STAMP" 字样——那不代表存在可召回的块。
 * 有界投影（projection）的标记位于 tool-call 的 result 字符串内，一并识别。
 */
function hasStampMarker(messages: Message[]): boolean {
  const marker = /#STAMP\s+[0-9a-f]{12}\b/
  return messages.some((message) =>
    message.contentParts?.some((part) => {
      if (part.type === 'text') return marker.test(part.text)
      if (part.type === 'tool-call' && typeof part.result === 'string') return marker.test(part.result)
      return false
    })
  )
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
  const { webBrowsing, knowledgeBase, messages, agentMode, codeExecution, commandExecution } = options
  const agentToolContractVersion = options.agentToolContractVersion ?? 1
  const legacyCommandTools = agentToolContractVersion === 1
  const commandApprovalMode = resolveCommandApprovalMode(options.sessionSettings ?? {})

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

  const userWorkingDirectories = options.sessionSettings?.workingDirectories?.filter((dir) => dir.trim().length > 0)
  // 压缩块可能出现在非 agent 模式（压缩不看 agentMode），所以这段说明的
  // 触发条件是"上下文里真有戳"，而不是 includeAgentTools。
  const stampsPresent = isContextAmplifierEnabled() && hasStampMarker(messages)
  let instructions =
    includeAgentTools || stampsPresent ? buildContextManagementInstruction(stampsPresent) : ''
  if (includeAgentTools) {
    instructions += options.workspaceInstructionsOverride ?? (await buildWorkspaceInstructions(userWorkingDirectories))
    instructions += `
## Git
When you create a Git branch, prefix its name with \`chatbox/\` (for example \`chatbox/fix-login-retry\`).

When you create a Git commit that includes code changes, append this exact trailer to the commit message:

\`Co-authored-by: Chatbox <chatbox@chatboxai.com>\`
`
  }
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

  let codeExecToolSet: ReturnType<typeof buildCodeExecutionTools> | null = null
  let sandboxWorkingDirectory: string | null = null
  const commandPlatform =
    includeAgentTools && (codeExecution || (!legacyCommandTools && options.commandExecution))
      ? await platform.getPlatform()
      : undefined
  const commandRunnerAvailable =
    commandPlatform === 'darwin' || commandPlatform === 'linux' || commandPlatform === 'win32'
  const sandboxCodeExecutionFallback = !legacyCommandTools && !commandRunnerAvailable && codeExecution !== undefined
  const harmonyNodeExecution = sandboxCodeExecutionFallback && commandPlatform === 'harmony'
  if (includeAgentTools && codeExecution) {
    codeExecToolSet = buildCodeExecutionTools(codeExecution)
    sandboxWorkingDirectory = await codeExecution.provider
      .resolveWorkingDirectory(codeExecution.sessionId)
      .catch(() => null)
    if (legacyCommandTools || sandboxCodeExecutionFallback) {
      instructions += buildWorkingDirectoryInstruction(sandboxWorkingDirectory, userWorkingDirectories)
      instructions += codeExecToolSet.description
    } else if (commandRunnerAvailable) {
      instructions += buildRunCommandFileProcessingInstruction(
        commandPlatform,
        sandboxWorkingDirectory,
        userWorkingDirectories
      )
    }
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
    if (legacyCommandTools || sandboxCodeExecutionFallback) {
      tools = { ...tools, ...codeExecToolSet.tools }
      const legacyCodeExecution = tools.code_execution
      if (commandPlatform === 'win32' && commandApprovalMode !== 'full_access' && legacyCodeExecution?.execute) {
        const executeLegacyCode = legacyCodeExecution.execute
        tools.code_execution = {
          ...legacyCodeExecution,
          execute: async (input, toolOptions) => {
            const alreadyApproved = (toolOptions as typeof toolOptions & { approved?: boolean }).approved === true
            if (!alreadyApproved) {
              const codeInput = input as { code: string; language?: string }
              const language = codeInput.language ?? 'node'
              throw new UserExecApprovalPausedError(
                toolOptions.toolCallId,
                `${language} (legacy code_execution):\n${codeInput.code}`
              )
            }
            return await executeLegacyCode(input, toolOptions)
          },
        }
      }
    } else {
      const nonCommandTools = { ...codeExecToolSet.tools }
      delete nonCommandTools.code_execution
      tools = { ...tools, ...nonCommandTools }
    }
  }

  if (includeAgentTools && !legacyCommandTools && commandRunnerAvailable && commandExecution) {
    const sessionSettings = options.sessionSettings
    const recentUserMsgs = messages
      .filter((message) => message.role === 'user')
      .slice(-3)
      .map((message) => getMessageText(message, true, false).slice(0, 500))
    const userContext = recentUserMsgs.join('\n---\n')
    const runCommand = buildRunCommandTool({
      sessionId: commandExecution.sessionId,
      platform: commandPlatform,
      provider: commandExecution.provider,
      ensureSandbox: codeExecToolSet?.ensureSandbox,
      workingDirectories: userWorkingDirectories ?? [],
      approvalMode: commandApprovalMode,
      requestSmartApproval: (toolCallId, command, signal, workdir) => {
        const explanationCtx: ExplanationContext | undefined = sessionSettings
          ? {
              userContext,
              generateExplanation: (cmd, ctx, onStream, explanationSignal) =>
                generateCommandExplanation(
                  sessionSettings,
                  commandExecution.sessionId,
                  cmd,
                  ctx,
                  onStream,
                  explanationSignal
                ),
            }
          : undefined
        return requestUserExecApproval(toolCallId, command, explanationCtx, signal, workdir)
      },
      onUsed: options.onAgentModeActivated,
    })
    tools.run_command = runCommand.tool
    instructions += runCommand.description
  }

  // Image viewing: agent mode + vision. prepareStepMessages bounds replay for every
  // protocol; chat-completions style protocols also use it to inject real user image parts.
  let prepareStepMessages: BuildToolsResult['prepareStepMessages']
  const includeViewImageTool = includeAgentTools && model.isSupportVision() && isViewImageAvailable()
  if (includeViewImageTool) {
    const viewImageToolSet = buildViewImageToolSet({
      sessionId: options.sessionId ?? codeExecution?.sessionId,
      provider: codeExecution?.provider,
      toolResultImages: supportsToolResultImages(model.apiStyle),
    })
    instructions += viewImageToolSet.description
    tools = { ...tools, ...viewImageToolSet.tools }
    prepareStepMessages = viewImageToolSet.injectImagesIntoStepMessages
  }

  if (includeAgentTools) {
    const filesystemToolSet = buildFilesystemTools({
      sessionId: codeExecution?.sessionId,
      provider: codeExecution?.provider,
      userWorkingDirectories: options.sessionSettings?.workingDirectories?.filter((dir) => dir.trim().length > 0),
      fullAccess: commandApprovalMode === 'full_access',
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
      commandApprovalMode === 'full_access',
      userExecWorkingDirectory,
      legacyCommandTools,
      harmonyNodeExecution,
      sandboxCodeExecutionFallback,
      sandboxWorkingDirectory
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
    if (legacyCommandTools) tools.user_exec = buildUserExecTool(options)
    if (codeExecution) {
      tools.install_skill = buildInstallSkillTool(
        options,
        legacyCommandTools || sandboxCodeExecutionFallback,
        sandboxWorkingDirectory
      )
    }
  }

  // Persistent memory: independent of agent mode (chat mode can save/recall too),
  // gated on the memory switch that applies to this session — the copilot's own
  // switch when its memory scope is active, the global switch otherwise. Writes
  // persist immediately but the running session keeps its frozen persona
  // snapshot, so they only affect future sessions. The 'agent' tool-use scope
  // keeps weak function-calling models tool-free.
  const globalSettingsForTools = options.globalSettings ?? settingsStore.getState().getSettings()
  const memoryScope = options.memoryScope ?? { type: 'global' as const }
  const memoryToolsEnabled = memoryScope.type === 'copilot' || globalSettingsForTools.memoryEnabled !== false
  if (memoryToolsEnabled && modelSupportsAgentTools) {
    const memoryToolSet = buildAgentMemoryTools({
      languageName: languageNameMap[globalSettingsForTools.language],
      scope: memoryScope,
    })
    instructions += memoryToolSet.description
    tools = { ...tools, ...memoryToolSet.tools }
  }

  // Context Amplifier 召回工具。注册条件不能是 agent 模式：压缩在 buildContext
  // 里发生，不看 agentMode。曾经把它放在 includeAgentTools 分支内，结果非 agent
  // 模式下压缩照做、#STAMP 照样进上下文，而召回工具不存在——模型看得见戳却
  // 兑现不了，只能退回重新探索，正是要解决的问题。
  //
  // 但也不能无条件注册：纯聊天会话一条戳都没有，凭空多一个工具会让
  // hasTools 变 true，从而拉进 Response Language 等仅在有工具时才该出现的
  // 系统说明。所以按"上下文里是否真有戳"决定。
  if (stampsPresent) {
    tools.retrieve_by_stamp = buildRetrieveByStampTool()
  }

  // 实时自报：只在这个会话确实会被压缩时才注册。
  //
  // 判据用"上下文里已有 #STAMP 块"，与召回工具一致。原因是纯聊天会话（几轮
  // 问答，从没触发过压缩）不需要因果记忆——凭空多一个必填 9 个字段的工具，
  // 既让模型每轮多花一次调用，也会把 Response Language 等"有工具才注入"的
  // 系统说明拉进纯聊天路径。
  //
  // 代价是第一次触发压缩之前的那些块拿不到自报记录，只能走 curator 事后整理。
  // 这是有意的取舍：压缩尚未发生时，那些块还完整躺在 L0 里，没有信息损失。
  const commitConfig = stampsPresent ? getCommitConfig() : null
  if (commitConfig && options.sessionId) {
    countedMessagesForCommit.set(options.sessionId, messages.length)
    tools[commitConfig.toolName] = buildCommitTaskMemoryTool(options.sessionId, commitConfig, options.roundId)
    instructions += commitConfig.notice ? `\n${commitConfig.notice}\n` : ''
  }

  if (Object.keys(tools).length > 0) {
    instructions = buildToolUseCommunicationInstruction() + instructions
  }

  return { tools, instructions, ...(prepareStepMessages ? { prepareStepMessages } : {}) }
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

function buildInstallSkillTool(
  options: BuildToolsOptions,
  legacyCommandTools: boolean,
  skillStagingDirectory: string | null
): ToolSet[string] {
  const stagingRequirement =
    !legacyCommandTools && skillStagingDirectory
      ? ` Set run_command workdir to ${skillStagingDirectory.replace(/\\/g, '/')} and keep the prepared directory beneath it; user-granted working directories are not accepted.`
      : ''
  return {
    description:
      'Install a skill from a prepared directory. ' +
      `First use ${legacyCommandTools ? 'code_execution (sandbox)' : 'run_command'} to download/unpack the skill files, ensure the directory ` +
      'contains a valid SKILL.md with name and description fields, then call this tool. ' +
      stagingRequirement +
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
  const commandApprovalMode = resolveCommandApprovalMode(options.sessionSettings ?? {})
  const agentFullAccess = commandApprovalMode === 'full_access'
  const sessionId = options.sessionId ?? options.codeExecution?.sessionId
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
      "Use when the task requires the user's host environment, including when a loaded skill instructs you to run a host command; it is not limited to skill-driven tasks. " +
      'Prefer code_execution (sandbox) for work that does not need the host environment. ' +
      'Runs PowerShell on Windows and Bash on macOS/Linux with full system access. ' +
      (agentFullAccess
        ? 'Full Access is enabled, so commands run without per-command approval.'
        : commandApprovalMode === 'always_ask'
          ? 'Every command requires user approval.'
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

      const approvalContext = toolOptions as typeof toolOptions & { approved?: boolean; approvalWorkdir?: string }
      const alreadyApproved = approvalContext.approved
      let hostExecutionStarted = false
      const execution = Promise.resolve().then(async (): Promise<UserExecResult> => {
        const recentUserMsgs = options.messages
          .filter((m) => m.role === 'user')
          .slice(-3)
          .map((m) => getMessageText(m, true, false).slice(0, 500))
        const userContext = recentUserMsgs.join('\n---\n')

        const sessionSettings = options.sessionSettings
        const explanationCtx: ExplanationContext | undefined =
          sessionSettings && sessionId
            ? {
                userContext,
                generateExplanation: (cmd, ctx, onStream, signal) =>
                  generateCommandExplanation(sessionSettings, sessionId, cmd, ctx, onStream, signal),
              }
            : undefined

        let approvalSource: UserExecApprovalSource
        if (alreadyApproved && approvalContext.approvalWorkdir === userExecWorkingDirectory) {
          approvalSource = 'user'
        } else if (agentFullAccess) {
          approvalSource = 'full_access'
        } else if (commandApprovalMode === 'always_ask') {
          throw new UserExecApprovalPausedError(
            toolOptions.toolCallId,
            execInput.command,
            undefined,
            undefined,
            userExecWorkingDirectory
          )
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
          ...(result.outputFile ? { outputFile: result.outputFile } : {}),
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

/**
 * 实时自报工具。模型在给出最终答复前调用它提交本轮任务记忆。
 *
 * 与 curator 事后整理的区别：模型此刻手里有完整上下文，知道自己为什么否决了
 * 某个方案、哪一步失败及原因。事后让 curator 读历史只能推断这些因果，而且
 * 容易把"被否决的方案"当噪音删掉——那恰好是防止后续重复踩坑的关键。
 *
 * schema 与描述来自外部配置（CTX_AMP_COMMIT），不写在源码里。
 */
function buildCommitTaskMemoryTool(sessionId: string, config: CommitConfig, roundId?: string): ToolSet[string] {
  return {
    description: config.description,
    inputSchema: jsonSchema(config.parameters as Parameters<typeof jsonSchema>[0]),
    execute: async (input) => {
      const payload = (input ?? {}) as Record<string, unknown>
      const validation = validateCommitPayload(payload, config.requiredFields)
      const messageCount = countedMessagesForCommit.get(sessionId) ?? 0
      recordCommit(sessionId, payload, messageCount, validation, roundId)

      if (!validation.valid) {
        // 把错误原样回传给模型。原设计靠这条回环让模型自己修正字段，
        // harness 从不代填——代填等于伪造模型没确认过的事实。
        return [
          '[COMMIT_TASK_MEMORY][REJECTED]',
          `未通过校验：${validation.errors.join('；')}`,
          '请修正这些字段后重新调用本工具。只写本轮已确认的事实，不要编造。',
        ].join('\n')
      }

      return [
        '[COMMIT_TASK_MEMORY][ACCEPTED]',
        '本轮任务记忆已通过结构化校验并留存。现在可以给出最终答复。',
        '该确认属于内部协议，不要向用户复述本次工具调用。',
      ].join('\n')
    },
  }
}

/**
 * 记录构建上下文时该会话的消息数。commit 工具执行时用它定位提交归属的任务块
 * ——工具执行上下文里拿不到消息列表，只能在构建工具集时先存一份。
 */
const countedMessagesForCommit = new Map<string, number>()

function buildRetrieveByStampTool(): ToolSet[string] {
  return {
    description: `Retrieve compressed context by stamp identifier. Use this when you see a #STAMP marker in the conversation history and need the full original content.

Usage strategy (two-tier recall):
1. First, try searchScope='compressed' (default) — searches L1/L2/L3 compressed layers
2. If not found or the stamp is marked [ARCHIVE], use searchScope='archive' — searches the ancient archive (full original blocks beyond 712KB)

The compressed layers are faster and closer in time; only fall back to archive when explicitly needed.`,
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        stamp: {
          type: 'string',
          description: 'The stamp identifier (e.g., "a1b2c3d4e5f6")',
        },
        question: {
          type: 'string',
          description: 'What specific information you need from this stamped block',
        },
        searchScope: {
          type: 'string',
          enum: ['compressed', 'archive'],
          description:
            "Search scope: 'compressed' (default, L1/L2/L3 layers) or 'archive' (ancient blocks beyond 712KB). Try 'compressed' first.",
        },
      },
      required: ['stamp', 'question'],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const recallInput = input as { stamp: string; question: string; searchScope?: 'compressed' | 'archive' }
      const config = getRecallConfig()
      const result = await recallByStampWeb(
        getSharedStampStore(),
        recallInput,
        config ? { ...config, timeout: 90_000 } : undefined
      )
      return renderRecallResultWeb(result)
    },
  }
}
