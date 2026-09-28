import type { PausedMemoryContext } from '@chatbox/core/application/memory'
import type { ModelInterface } from '@shared/models/types'
import type { SandboxSeedAttachment } from '@shared/sandbox/attachment-path'
import type { SandboxProvider } from '@shared/sandbox-provider'
import { formatLoadSkillOutput, type LoadedSkill } from '@shared/skills/catalog'
import { supportsToolResultImages } from '@shared/tools/view-image'
import type { KnowledgeBase, Message, SessionSettings, Settings } from '@shared/types'
import type { MemoryScope } from '@shared/types/agent-persona'
import { resolveCommandApprovalMode } from '@shared/types/command-execution'
import type { UserExecApprovalSource } from '@shared/types/user-exec'
import { getMessageText } from '@shared/utils/message'
import { validatedToolSchema } from '@shared/validated-tool-schema'
import type { ModelMessage, ToolSet } from 'ai'
import { trackAgentModeFullAccessBypass } from '@/analytics/agent-mode'
import { languageNameMap } from '@/i18n/locales'
import { mcpController } from '@/packages/mcp/controller'
import { generateCommandExplanation } from '@/packages/model-calls/command-explanation'
import { buildAgentMemoryTools, buildPausedAgentMemoryTools } from '@/packages/model-calls/toolsets/agent-memory'
import { getBuiltInBrowserToolSet } from '@/packages/model-calls/toolsets/built-in-browser'
import {
  BUILT_IN_BROWSER_SKILL_DESCRIPTION,
  BUILT_IN_BROWSER_SKILL_NAME,
  builtInBrowserSkillBody,
} from '@/packages/model-calls/toolsets/built-in-browser-skill'
import { buildChatboxCliToolSet } from '@/packages/model-calls/toolsets/chatbox-cli'
import { buildCodeExecutionTools } from '@/packages/model-calls/toolsets/code-execution'
import { buildFileTools, fileToolSetDescription } from '@/packages/model-calls/toolsets/file'
import { buildFilesystemTools } from '@/packages/model-calls/toolsets/filesystem'
import { getToolSet as getKBToolSet } from '@/packages/model-calls/toolsets/knowledge-base'
import { asRecord, numberField, stringField, toTextModelOutput } from '@/packages/model-calls/toolsets/model-output'
import { buildRunCommandTool } from '@/packages/model-calls/toolsets/run-command'
import { remapPhantomHomePath } from '@/packages/model-calls/toolsets/sandbox-paths'
import { getToolSet as getSessionAttachmentRagToolSet } from '@/packages/model-calls/toolsets/session-attachment-rag'
import {
  buildViewImageToolSet,
  type ImageToolResults,
  isViewImageAvailable,
  withImageFileReading,
} from '@/packages/model-calls/toolsets/view-image'
import { parseLinkTool, webSearchTool } from '@/packages/model-calls/toolsets/web-search'
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
  webBrowsing: boolean
  knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
  messages: Message[]
  /** Known file messages before model-context trimming. */
  fileMessages?: Message[]
  loadFileMessages?: () => Promise<Message[]>
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
  /** Frozen memory availability for an existing call being resumed or retried. */
  pausedMemoryContext?: PausedMemoryContext
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
function buildWorkingDirectoryInstruction(
  workingDir: string | null,
  userWorkingDirectories: string[] | undefined,
  commandPlatform: string | undefined
): string {
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
  const windowsGuidance = `- On Windows, prefer PowerShell for terminal commands and native filesystem paths. PowerShell accepts native paths such as \`C:\\Users\\name\` and also starts in the working directory, so do not prepend \`Set-Location <working-directory>\`. Use Bash only for POSIX-specific scripts.
- When using Bash on Windows, use Unix shell syntax and forward slashes; never paste a backslash path such as \`C:\\Users\\name\` into Bash. Git Bash accepts \`C:/Users/name/...\`, while WSL uses \`/mnt/c/Users/name/...\`. Because the active shell may differ, use relative paths for targets inside the working directory and structured file tools for host paths outside it.
- In Bash, \`~\` and \`$HOME\` point to the working directory. In PowerShell, use relative paths or \`$PWD\`; do not assume \`$HOME\` is the working directory.
`
  const shellPathGuidance =
    commandPlatform === 'win32'
      ? windowsGuidance
      : commandPlatform === 'harmony'
        ? ''
        : '- In Bash, \`~\` and \`$HOME\` point to the working directory.\n'
  return `
## Working Directory & File Paths
${dirLine}
- For files inside the working directory, prefer relative paths. They resolve from the working directory at the start of each tool call.
- Use an absolute path when the target is outside the working directory, including a user-granted real directory. For these host paths, prefer the structured file tools instead of passing the path to shell code.
- \`code_execution\` already starts in the working directory. Do not prepend \`cd <working-directory>\` to commands.
${shellPathGuidance}- Do NOT use absolute paths like /home/user or /root — they do not exist here. Write to the working directory instead.
- To create or modify files, prefer the write_file and edit_file tools over writing through code_execution scripts. The structured tools are more reliable and let the user see what changed.
${grantedDirsBlock}`
}

function buildRunCommandFileProcessingInstruction(
  workingDir: string | null,
  userWorkingDirectories?: string[]
): string {
  const formatPath = (filePath: string) => filePath.replace(/\\/g, '/')
  const directories = userWorkingDirectories?.length
    ? `\nUser-selected working directories:\n${userWorkingDirectories.map((dir) => `- ${formatPath(dir)}`).join('\n')}`
    : ''
  return `
## Working Directory & File Processing
Sandbox working directory: ${workingDir ? formatPath(workingDir) : '(created when first needed)'}${directories}
- Use read_file for sandbox files and explicitly provided absolute user paths; prefer write_file and edit_file for file changes.
- Do not assume Python, extra packages, or package installation is available.
`
}

function buildToolUseCommunicationInstruction(): string {
  return `
## Tool-use Communication
Before calling tools, write one short visible sentence in the user's language saying what you will do next and why; one sentence covers a batch of related calls. Skip it for trivial single lookups such as reading, listing, or searching.
`
}

function buildSkillToolsInstruction(
  enabledSkills: Array<{ name: string; description: string }>,
  agentFullAccess: boolean,
  userExecWorkingDirectory: string | undefined,
  legacyCommandTools: boolean,
  harmonyNodeExecution: boolean,
  sandboxCodeExecutionFallback: boolean,
  skillStagingDirectory: string | null,
  sandboxAvailable: boolean
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

  const installUnavailable = `
### Installing Skills
Installing skills requires the session sandbox, which is unavailable in this session.
`

  if (!legacyCommandTools) {
    if (!sandboxAvailable) return instruction + installUnavailable
    const stagingDirectory = skillStagingDirectory?.replace(/\\/g, '/')
    instruction += `
### Installing Skills
Use run_command with workdir set to ${stagingDirectory ?? 'the internal sandbox working directory shown above'} to download and unpack skill files. Keep the prepared skill directory beneath that sandbox root, ensure it contains a valid SKILL.md, then call install_skill with that path. User-granted working directories are not valid install_skill staging roots.
`
    return instruction
  }

  instruction += `
### Running Commands in User Environment
**user_exec** runs commands in the user's real environment with full system access. This is a privileged tool.
In Work Mode, use user_exec when the user's task requires their real environment, including when a loaded skill instructs you to run a host command. It is not limited to skill-driven tasks.
${sandboxAvailable ? "Prefer code_execution (sandbox) for file processing, data analysis, downloading files, and other work that does not require the user's host environment.\n" : ''}Unless Full Access is enabled, every command is still subject to the host approval policy and may pause for user confirmation.
On Windows, user_exec runs PowerShell commands; on macOS/Linux, it runs Bash commands. Write PowerShell syntax directly on Windows, and use newlines or semicolons instead of Bash-only operators such as && so the command also works with Windows PowerShell 5.1. Do not invoke PowerShell from Bash or paste a Windows path into Bash.
${userExecWorkingDirectory ? `user_exec already starts in the first user-granted working directory: ${userExecWorkingDirectory.replace(/\\/g, '/')}. Use relative paths there and do not prepend cd or Set-Location.\n` : 'Without a user-granted working directory, user_exec starts in the user home directory.\n'}
${agentFullAccess ? 'Full Access is enabled, so user_exec commands run without per-command approval.\n' : ''}`
  if (!sandboxAvailable) return instruction + installUnavailable
  instruction += `
### Installing Skills
You can install skills from any source:
1. Use code_execution (sandbox) to download and unpack the skill files
2. Ensure the directory contains a valid SKILL.md with name and description
3. Call install_skill with the sandbox path
The skill will be auto-enabled after installation.
`
  return instruction
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

  const fileMessages = options.fileMessages ?? messages
  const hasInlineFileOrLink = fileMessages.some(
    (m) => m.links?.length || m.files?.some((file) => file.ragMode !== 'session-retrieval')
  )
  const sessionAttachmentIds = getSessionAttachmentRagIds(messages)
  const hasStoredToolResults = fileMessages.some((message) =>
    message.contentParts.some((part) => part.type === 'tool-call' && part.resultStorageKey)
  )
  const needFileToolSet =
    (hasInlineFileOrLink || hasStoredToolResults || options.loadFileMessages) && model.isSupportToolUse('read-file')
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
  let instructions = includeAgentTools
    ? `## Context Management
In long conversations, earlier tool results may be compressed or summarized. Put key findings and essential data from tool results into your text response instead of relying on re-reading them later.
`
    : ''
  if (includeAgentTools) {
    instructions += options.workspaceInstructionsOverride ?? (await buildWorkspaceInstructions(userWorkingDirectories))
    instructions += `
## Git
When you create a Git branch, prefix its name with \`chatbox/\` (for example \`chatbox/fix-login-retry\`).

When you create a Git commit that includes code changes, append this exact trailer to the commit message:

\`Co-authored-by: Chatbox <chatbox@chatboxai.com>\`
`
  }
  if (sessionAttachmentRagToolSet) {
    instructions += sessionAttachmentRagToolSet.description
  }
  if (needFileToolSet) {
    instructions += fileToolSetDescription
  }

  let codeExecToolSet: ReturnType<typeof buildCodeExecutionTools> | null = null
  let sandboxWorkingDirectory: string | null = null
  const commandPlatform =
    includeAgentTools && (codeExecution || (!legacyCommandTools && options.commandExecution))
      ? await platform.getPlatform()
      : undefined
  const commandRunnerAvailable =
    commandPlatform === 'darwin' || commandPlatform === 'linux' || commandPlatform === 'win32'
  const runCommandAvailable =
    includeAgentTools && !legacyCommandTools && commandRunnerAvailable && commandExecution !== undefined
  const sandboxCodeExecutionFallback = !legacyCommandTools && !runCommandAvailable && codeExecution !== undefined
  const harmonyNodeExecution = sandboxCodeExecutionFallback && commandPlatform === 'harmony'
  // Exactly one script tool is registered: code_execution (legacy contract, or run_command
  // unavailable) or run_command. Tool guidance must name the registered one.
  const exposesCodeExecution = legacyCommandTools || sandboxCodeExecutionFallback
  if (includeAgentTools && codeExecution) {
    codeExecToolSet = buildCodeExecutionTools({
      ...codeExecution,
      scriptTool: exposesCodeExecution ? 'code_execution' : 'run_command',
    })
    sandboxWorkingDirectory = await codeExecution.provider
      .resolveWorkingDirectory(codeExecution.sessionId)
      .catch(() => null)
    if (exposesCodeExecution) {
      instructions += buildWorkingDirectoryInstruction(sandboxWorkingDirectory, userWorkingDirectories, commandPlatform)
      instructions += codeExecToolSet.description
    } else {
      instructions += buildRunCommandFileProcessingInstruction(sandboxWorkingDirectory, userWorkingDirectories)
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

  if (codeExecToolSet) {
    if (exposesCodeExecution) {
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

  if (needFileToolSet) {
    tools = {
      ...tools,
      ...buildFileTools(fileMessages, codeExecToolSet?.tools.read_file, options.loadFileMessages).tools,
    }
  }

  if (runCommandAvailable && commandExecution) {
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
  let imageResults: ImageToolResults | undefined
  const includeViewImageTool = includeAgentTools && model.isSupportVision() && isViewImageAvailable()
  if (includeViewImageTool) {
    const viewImageToolSet = buildViewImageToolSet({
      sessionId: options.sessionId ?? codeExecution?.sessionId,
      provider: codeExecution?.provider,
      toolResultImages: supportsToolResultImages(model.apiStyle),
    })
    instructions += viewImageToolSet.description
    tools = { ...tools, ...viewImageToolSet.tools }
    if (tools.read_file) tools.read_file = withImageFileReading(tools.read_file, viewImageToolSet)
    prepareStepMessages = viewImageToolSet.injectImagesIntoStepMessages
    imageResults = viewImageToolSet.imageResults
  }

  // The built-in browser is a Work Mode tool; only desktop platforms provide it. Its screenshot
  // command needs the image results of a vision model.
  const browserSessionId = options.sessionId ?? codeExecution?.sessionId
  const builtInBrowserToolSet =
    includeAgentTools && browserSessionId
      ? getBuiltInBrowserToolSet(platform.builtInBrowser?.forSession(browserSessionId), {
          hasParseLink: includeParseLinkTool,
          imageResults,
          fileAccess: {
            sessionId: codeExecution?.sessionId,
            provider: codeExecution?.provider,
            userWorkingDirectories: options.sessionSettings?.workingDirectories,
            fullAccess: commandApprovalMode === 'full_access',
          },
        })
      : null
  if (builtInBrowserToolSet) {
    tools = { ...tools, ...builtInBrowserToolSet.tools }
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
    const toolsetSkills = builtInBrowserToolSet
      ? [
          {
            name: BUILT_IN_BROWSER_SKILL_NAME,
            description: BUILT_IN_BROWSER_SKILL_DESCRIPTION,
            body: builtInBrowserSkillBody({ screenshot: imageResults !== undefined }),
          },
        ]
      : []
    const enabledSkills = [
      ...allSkills.filter(
        (s) => skillSettings.enabledSkillNames.includes(s.name) && !toolsetSkills.some((skill) => skill.name === s.name)
      ),
      ...toolsetSkills,
    ]
    const userExecWorkingDirectory = options.sessionSettings?.workingDirectories?.find((dir) => dir.trim().length > 0)
    instructions += buildSkillToolsInstruction(
      enabledSkills,
      commandApprovalMode === 'full_access',
      userExecWorkingDirectory,
      legacyCommandTools,
      harmonyNodeExecution,
      sandboxCodeExecutionFallback,
      sandboxWorkingDirectory,
      codeExecution !== undefined
    )
    tools.load_skill = buildLoadSkillTool(options, toolsetSkills)
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
      tools.install_skill = buildInstallSkillTool(options)
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
  if (options.pausedMemoryContext || (memoryToolsEnabled && modelSupportsAgentTools)) {
    const memoryToolSet = options.pausedMemoryContext
      ? buildPausedAgentMemoryTools({
          ...options.pausedMemoryContext,
          languageName: languageNameMap[globalSettingsForTools.language],
        })
      : buildAgentMemoryTools({
          languageName: languageNameMap[globalSettingsForTools.language],
          scope: memoryScope,
        })
    instructions += memoryToolSet.description
    tools = { ...tools, ...memoryToolSet.tools }
  }

  if (Object.keys(tools).length > 0) {
    instructions = buildToolUseCommunicationInstruction() + instructions
  }

  return { tools, instructions, ...(prepareStepMessages ? { prepareStepMessages } : {}) }
}

/**
 * `toolsetSkills` document tools that are present in this request. They load regardless of the
 * user's skill settings and take precedence over an installed skill with the same name.
 */
function buildLoadSkillTool(
  options: BuildToolsOptions,
  toolsetSkills: ReadonlyArray<{ name: string; body: string }>
): ToolSet[string] {
  return {
    description:
      "Load a skill by name to get its full instructions. Call this when the user's request " +
      'matches an available skill. Available skills are listed in the system instructions.',
    inputSchema: validatedToolSchema({
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
      const toolsetSkill = toolsetSkills.find((skill) => skill.name === skillInput.name)
      if (toolsetSkill) return { instructions: toolsetSkill.body } satisfies LoadedSkill
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
      } satisfies LoadedSkill
    },
    toModelOutput: toTextModelOutput(formatLoadSkillOutput, { emptyFallback: 'Skill instructions are empty.' }),
  }
}

function buildInstallSkillTool(options: BuildToolsOptions): ToolSet[string] {
  return {
    description:
      'Install a skill from a prepared sandbox directory containing a valid SKILL.md with name and description fields. ' +
      'Prepare it as described under Installing Skills. The skill is auto-enabled after installation.',
    inputSchema: validatedToolSchema({
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
      (options.codeExecution
        ? 'Prefer code_execution (sandbox) for work that does not need the host environment. '
        : '') +
      'Runs PowerShell on Windows and Bash on macOS/Linux with full system access. ' +
      (agentFullAccess
        ? 'Full Access is enabled, so commands run without per-command approval.'
        : commandApprovalMode === 'always_ask'
          ? 'Every command requires user approval.'
          : 'Clearly safe commands may be approved automatically; other commands require user approval.'),
    inputSchema: validatedToolSchema({
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
