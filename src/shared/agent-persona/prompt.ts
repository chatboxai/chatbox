import type { PlatformType } from '../platform'
import {
  COPILOT_PROMPT_MAX_CHARS,
  MEMORY_PROMPT_MAX_CHARS,
  type MemoryEntry,
  SOUL_MAX_CHARS,
  SOUL_VIRTUAL_PATH,
} from '../types/agent-persona'

/**
 * Agent-mode system prompt assembly.
 *
 * Pure string logic shared across renderer and native. Ordering is by stability so
 * provider prefix caches survive as long as possible: fixed identity first, then the
 * per-session Soul/memories snapshot, then tool instructions, with volatile metadata
 * (current model/date) appended last by the harness.
 */

const PLATFORM_LABELS: Record<PlatformType, string> = {
  desktop: 'Desktop',
  web: 'Web',
  mobile: 'Mobile',
}

export interface AgentIdentityOptions {
  platformType: PlatformType
  /** Result of getOS(): 'Windows' | 'Mac' | 'Linux' | 'Android' | 'iOS' | 'Unknown' */
  os: string
}

function formatPlatform({ platformType, os }: AgentIdentityOptions): string {
  const label = PLATFORM_LABELS[platformType] ?? 'Desktop'
  const osName = os === 'Mac' ? 'macOS' : os
  return osName && osName !== 'Unknown' ? `${label} (${osName})` : label
}

export function buildAgentIdentityPrompt(options: AgentIdentityOptions): string {
  return `You are Chatbox agent, running inside the Chatbox client.
You are an interactive agent that helps the user with their tasks.
Current platform: ${formatPlatform(options)}`
}

/**
 * Fallback persona used when the user's Soul is empty or still the untouched template.
 * Mirrors the identity Hermes/OpenClaw ship by default: helpful, direct, no filler.
 */
export const DEFAULT_SOUL_PERSONA = `Be genuinely helpful, not performatively helpful: skip filler like "Great question!" and just help.
Be direct and concise; expand only when depth actually serves the task.
Be resourceful before asking: read the file, check the context, search for it.
Admit uncertainty when it exists. Be careful with external or destructive actions, bold with internal read-only ones.`

/**
 * Strip template scaffolding (HTML comments, markdown headings, blockquote guidance)
 * and report what remains. A seeded-but-unedited template therefore counts as empty
 * and falls back to the default persona, without Hermes-style template fingerprinting.
 */
export function extractSoulContent(raw: string): string {
  const withoutComments = raw.replace(/<!--[\s\S]*?-->/g, '')
  const meaningful = withoutComments
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^#{1,6}\s/.test(line) && !line.startsWith('>'))
  return meaningful.length > 0 ? withoutComments.trim() : ''
}

function truncateWithMarker(text: string, maxChars: number, label: string): string {
  const marker = `\n[${label} truncated for context safety]`
  if (text.endsWith(marker)) {
    const body = text.slice(0, -marker.length)
    return body.length <= maxChars ? text : `${body.slice(0, maxChars)}${marker}`
  }
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}${marker}`
}

const COPILOT_OVERLAY_GUIDANCE = `This session is using a Copilot. Follow its instructions for this conversation. They are session-specific and must not be written into ${SOUL_VIRTUAL_PATH}.`

/** Trim and cap Copilot overlay text to the Copilot editor budget. */
export function boundCopilotPersona(text: string | undefined): string | undefined {
  const overlay = text?.trim() ?? ''
  if (!overlay) return undefined
  return truncateWithMarker(overlay, COPILOT_PROMPT_MAX_CHARS, 'Copilot')
}

export function buildSoulSection(soulRaw: string, copilotPersona?: string): string {
  const soul = extractSoulContent(soulRaw)
  const soulBody = soul ? truncateWithMarker(soul, SOUL_MAX_CHARS, 'Soul') : DEFAULT_SOUL_PERSONA
  const overlay = boundCopilotPersona(copilotPersona)
  const body = overlay ? `${soulBody}\n\n${COPILOT_OVERLAY_GUIDANCE}\n\n${overlay}` : soulBody
  return `
## Soul
Your persona, tone, and boundaries. The user can edit this in Settings; when asked to update it, use the file tools (read_file / write_file / edit_file) on the virtual path ${SOUL_VIRTUAL_PATH}. Changes take effect in future sessions.

<soul>
${body}
</soul>
`
}

export interface MemoriesSectionOptions {
  /**
   * Whether the save_memory/delete_memory tools are available in this session
   * (agent mode). Chat mode injects memories read-only, so the guidance must
   * not reference tools the model does not have.
   */
  includeToolGuidance?: boolean
}

export function buildMemoriesSection(memories: MemoryEntry[], options: MemoriesSectionOptions = {}): string {
  if (memories.length === 0) return ''
  const { includeToolGuidance = true } = options
  // Newest entries win the budget: they are more likely to still be accurate.
  const lines: string[] = []
  let used = 0
  let omitted = 0
  for (const entry of [...memories].reverse()) {
    const line = `- [${entry.id}] ${entry.content}`
    if (used + line.length > MEMORY_PROMPT_MAX_CHARS) {
      omitted += 1
      continue
    }
    used += line.length
    lines.push(line)
  }
  lines.reverse()
  const omittedNote = omitted > 0 ? `\n[${omitted} older memories omitted for context safety]` : ''
  const guidance = includeToolGuidance
    ? 'Facts saved from previous conversations via save_memory. Treat them as ground truth unless the user or direct evidence contradicts them — then delete or replace the stale entry.'
    : 'Facts saved from previous conversations. Treat them as ground truth unless the user or direct evidence contradicts them.'
  return `
## Memories
${guidance}

<memories>
${lines.join('\n')}${omittedNote}
</memories>
`
}

export interface AgentPersonaPromptOptions extends AgentIdentityOptions {
  soul: string
  memories: MemoryEntry[]
  /** Frozen Copilot prompt for this conversation; omitted when the session has none. */
  copilotPersona?: string
}

/** Identity + Soul + Memories — the stable head of the agent-mode system prompt. */
export function buildAgentPersonaPrompt(options: AgentPersonaPromptOptions): string {
  return `${buildAgentIdentityPrompt(options)}
${buildSoulSection(options.soul, options.copilotPersona)}${buildMemoriesSection(options.memories)}`
}
