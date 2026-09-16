import type { BlobStoragePort } from '@chatbox/core/ports'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { formatLoadSkillOutput } from '../skills/catalog'
import { throwIfWorkAborted } from './abort'
import { createLocalBuiltinSkillCatalog, getLocalSkillCapability } from './builtin-skills'
import { type LocalWorkCapabilityId, resolveLocalWorkCapabilities } from './capabilities'
import { buildLocalFilesystemTools } from './filesystem-tools'
import type { MobileExecutionService } from './MobileExecutionService'
import { buildMobileProductInfoTool, type MobileProductInfoHost } from './product-info-tools'
import { isMobileSkillEnabled, type MobileSkillPreferences } from './skill-settings'
import { textToBase64 } from './workspace-path'
import type { LocalWorkspacePort } from './workspace-port'

export interface MobileToolGroup {
  id: string
  description: string
  load(): Promise<ToolSet>
}

export interface WorkModeContext {
  skillPreferences?: MobileSkillPreferences
  capabilities?: readonly LocalWorkCapabilityId[]
  sessionId: string
  modelName: string
  modelIdentity?: string
  signal: AbortSignal
}

const loadSkillInput = z.object({ name: z.string().min(1).max(64).describe('The name of the skill to load') }).strict()

export class LocalWorkMode<W extends LocalWorkspacePort> {
  private queues = new Map<string, Promise<unknown>>()
  private runOperation<T>(sessionId: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(new Error('Tool execution stopped'))
    const prior = this.queues.get(sessionId) ?? Promise.resolve()
    let started = false
    const result = prior
      .catch(() => undefined)
      .then(() => {
        throwIfWorkAborted(signal)
        started = true
        return operation()
      })
    this.queues.set(sessionId, result)
    void result
      .finally(() => {
        if (this.queues.get(sessionId) === result) this.queues.delete(sessionId)
      })
      .catch(() => undefined)
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!started) reject(new Error('Tool execution stopped'))
      }
      signal.addEventListener('abort', abort, { once: true })
      void result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
  constructor(
    readonly workspace: W,
    readonly execution: MobileExecutionService,
    private readonly groups: (context: WorkModeContext) => MobileToolGroup[] = () => [],
    private readonly blobs?: BlobStoragePort,
    private readonly productInfoHost?: () => MobileProductInfoHost
  ) {}

  async createTools(context: WorkModeContext, webTools: ToolSet = {}, restoreActive = false) {
    const active = new Set<string>(Object.keys(webTools))
    const enabled = new Set(resolveLocalWorkCapabilities(context.capabilities))
    const groups = this.groups(context).filter((group) => enabled.has(group.id as LocalWorkCapabilityId))
    const catalog = createLocalBuiltinSkillCatalog(
      groups.map((group) => group.id),
      context.skillPreferences
    )
    const availableSkills = await catalog.list()
    const groupTools = new Map<string, string[]>()
    const tools: ToolSet = { ...webTools }
    for (const group of groups) {
      const members = await group.load()
      groupTools.set(group.id, Object.keys(members))
      for (const [name, member] of Object.entries(members)) {
        if (name in tools) throw new Error(`Duplicate work-mode tool: ${name}`)
        tools[name] = {
          ...member,
          execute: member.execute
            ? async (input, options) => {
                throwIfWorkAborted(context.signal)
                if (!active.has(name)) throw new Error('Load the corresponding skill first')
                return member.execute?.(input, options)
              }
            : undefined,
        }
      }
    }
    const baseTools: ToolSet = {
      ...(this.productInfoHost && isMobileSkillEnabled('chatbox-product-info', context.skillPreferences)
        ? { chatbox_cli: buildMobileProductInfoTool(this.productInfoHost(), context.signal) }
        : {}),
      load_skill: tool({
        description: `Load a built-in skill by name for its full instructions and any related tool definitions in the next step. Loading does not grant OS permissions or read data. Available skills: ${availableSkills.map((skill) => `${skill.name}: ${skill.description}`).join('; ')}`,
        inputSchema: loadSkillInput,
        execute: async (input) => {
          throwIfWorkAborted(context.signal)
          const { name } = loadSkillInput.parse(input)
          const loaded = await catalog.load(name)
          if (!loaded)
            return {
              error: `Skill "${name}" is not enabled or available. Available skills: ${availableSkills.map((skill) => skill.name).join(', ')}.`,
            }
          const capability = getLocalSkillCapability(name)
          if (capability) for (const toolName of groupTools.get(capability) ?? []) active.add(toolName)
          return loaded
        },
        toModelOutput: ({ output }) => {
          const text = formatLoadSkillOutput(output)
          return { type: 'text', value: text.trim() ? text : 'Skill instructions are empty.' }
        },
      }),
      ...buildLocalFilesystemTools(this.workspace, context),
      parse_file: tool({
        description:
          'Extract DOCX, XLSX, or PPTX content locally. Returns a text file path and short preview; use read_file for paginated content. No skill is required.',
        inputSchema: z.object({ path: z.string() }).strict(),
        execute: async ({ path }, options) => {
          const signal = options.abortSignal ?? context.signal
          const parsed = await this.execution.parseDocument(
            path,
            await this.workspace.readBase64(context.sessionId, path),
            signal
          )
          throwIfWorkAborted(signal)
          const outputPath = `parsed/document-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
          const content =
            parsed.text + (parsed.truncated ? '\n[Document text truncated at the local parsing limit.]' : '')
          await this.workspace.commit(context.sessionId, { [outputPath]: { base64: textToBase64(content) } }, signal)
          return { path: outputPath, preview: parsed.text.slice(0, 512), truncated: parsed.truncated }
        },
      }),
      write_file: tool({
        description:
          'Write a UTF-8 file in the session workspace. Input attachments and delivered files are read-only.',
        inputSchema: z.object({ path: z.string(), content: z.string().max(100_000) }),
        execute: async ({ path, content }, options) => {
          await this.workspace.commit(
            context.sessionId,
            { [path]: { base64: textToBase64(content) } },
            options.abortSignal ?? context.signal
          )
          return { path, success: true }
        },
      }),
      code_execution: tool({
        description:
          'Execute JavaScript locally in an isolated sandbox. Supports async/await, files API, and document helpers described by the spreadsheets and presentations skills. No Node.js, shell, Python, network, or system APIs. 20 second execution deadline.',
        inputSchema: z.object({ code: z.string().max(100_000) }),
        execute: async ({ code }, options) => {
          const signal = options.abortSignal ?? context.signal
          const files = await this.workspace.snapshot(context.sessionId)
          const result = await this.execution.execute(code, files, signal, undefined, context.skillPreferences)
          throwIfWorkAborted(signal)
          if (!result.error) await this.workspace.commit(context.sessionId, result.files, signal)
          return {
            stdout: result.stdout,
            error: result.error,
            exitCode: result.error ? 1 : 0,
            files: result.error ? [] : Object.keys(result.files),
          }
        },
      }),
      create_download: tool({
        description:
          'Deliver an existing workspace file as a persistent downloadable artifact. Use for final reports, Excel, PPT, and HTML website previews.',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          throwIfWorkAborted(context.signal)
          if (!this.blobs) throw new Error('Artifact storage is unavailable')
          const artifact = await this.workspace.deliver(context.sessionId, path)
          artifact.storageKey = `file:work-${Date.now()}-${Math.random().toString(36).slice(2)}:raw`
          await this.blobs.set(
            artifact.storageKey,
            `data:${artifact.mimeType};base64,${await this.workspace.readBase64(context.sessionId, artifact.path)}`
          )
          return { artifacts: [artifact] }
        },
      }),
    }
    for (const name of Object.keys(baseTools)) {
      if (name in tools) throw new Error(`Duplicate work-mode tool: ${name}`)
      active.add(name)
    }
    Object.assign(tools, baseTools)
    for (const [name, value] of Object.entries(tools)) {
      const execute = value.execute
      if (execute)
        tools[name] = {
          ...value,
          execute: (input, options) =>
            this.runOperation(context.sessionId, options.abortSignal ?? context.signal, async () =>
              execute(input, options)
            ),
        }
    }
    if (restoreActive) for (const name of Object.keys(tools)) active.add(name)
    return { tools, active }
  }
}

export const WORK_INSTRUCTIONS = `Work mode executes locally on this device using the user's configured model. Complete the requested task and verify outputs before reporting success. Use list_files to find attachments. Use parse_file to extract DOCX/XLSX/PPTX content to a text file, then read_file to inspect it; no skill is required for parsing. Input files are read-only; write outputs elsewhere in the workspace. Scripts run in a fresh JavaScript context each time; files persist across calls. Use console.log for concise results and await all files and docs methods. Call load_skill with a listed skill name when the user's task matches its description; full instructions and relevant system tools are loaded on demand. Use create_download to deliver final files. Loading a skill does not authorize reading system data or changing it. Respect the tools' permission flow and report system changes only after success. When execution is interrupted, inspect saved files before retrying.`
