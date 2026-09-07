import {
  type ChatboxCliCommandCatalogEntry,
  type ChatboxCliCommandDomain,
  chatboxCliCommandCatalog,
  sameCommandPath,
} from './catalog'
import { ChatboxCliUsageError, parseArguments, parseChatboxCliInput } from './parser'
import type {
  ChatboxCliCommandContext,
  ChatboxCliCommandDefinition,
  ChatboxCliInput,
  ChatboxCliOptions,
  ChatboxCliToolContext,
} from './types'

export const CHATBOX_CLI_API_VERSION = 1

const domainLoaders: Record<ChatboxCliCommandDomain, () => Promise<ChatboxCliCommandDefinition[]>> = {
  account: async () => (await import('./account')).accountCommands,
  settings: async () => (await import('./settings')).settingsCommands,
  chats: async () => (await import('./chats')).chatCommands,
  image: async () => (await import('./images')).imageCommands,
}

async function executeCatalogCommand(
  entry: ChatboxCliCommandCatalogEntry,
  context: ChatboxCliCommandContext
): Promise<Record<string, unknown>> {
  const definitions = await domainLoaders[entry.domain]()
  const definition = definitions.find((candidate) => sameCommandPath(candidate.path, entry.path))
  if (!definition)
    throw new Error(`Chatbox CLI command is registered without an implementation: ${entry.path.join(' ')}`)
  return await definition.execute(context)
}

function normalizeAliases(argv: string[]): string[] {
  const [first, second] = argv.map((value) => value.toLowerCase())
  if (first === 'status' || first === 'whoami') return ['account', 'status', ...argv.slice(1)]
  if (first === 'quota' || first === 'usage') return ['account', 'quota', ...argv.slice(1)]
  if (first === 'license' && (second === 'refresh' || second === 'sync'))
    return ['account', 'refresh', ...argv.slice(2)]
  if (first === 'license') return ['account', 'license', ...argv.slice(1)]
  if (first === 'refresh' || first === 'sync') return ['account', 'refresh', ...argv.slice(1)]
  if (first === 'account' && !second) return ['account', 'status']
  return argv
}

function commandHelp(domain?: string): Record<string, unknown> {
  const visible = domain
    ? chatboxCliCommandCatalog.filter((command) => command.domain === domain || command.path[0] === domain)
    : chatboxCliCommandCatalog
  return {
    apiVersion: CHATBOX_CLI_API_VERSION,
    virtual: true,
    commands: visible.map((command) => ({
      command: command.path.join(' '),
      usage: command.usage,
      description: command.description,
    })),
    domains: ['account', 'settings', 'chats', 'image'],
    notes: [
      'This is a controlled virtual CLI, not a system shell.',
      'Conversation history reads do not require approval.',
      'Settings access is read-only. Guide users to Chatbox Settings for changes.',
      'Starting image generation requires explicit user approval in Chatbox.',
      'Image generation defaults to the first catalog model; pass --model (id or display name) when the user names one.',
      'After image generate is accepted, end the turn and wait for the automated callback. Never poll image status.',
      'Chatbox shows generated images to the user inline at the generate tool call. Never repeat them in replies.',
      'Image history is the device-wide Image Creator history, not the current conversation only.',
    ],
  }
}

function isApprovalPause(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AppActionApprovalPausedError')
}

export async function executeChatboxCli(
  input: ChatboxCliInput,
  toolContext: ChatboxCliToolContext,
  options: ChatboxCliOptions = {}
): Promise<Record<string, unknown>> {
  let displayCommand = 'chatbox'
  try {
    const parsedInput = parseChatboxCliInput(input)
    displayCommand = parsedInput.displayCommand
    const argv = normalizeAliases(parsedInput.argv)
    const first = argv[0]?.toLowerCase()

    if (!first || first === 'help' || first === '--help' || first === '-h') {
      return { ok: true, command: 'help', ...commandHelp(argv[1]?.toLowerCase()) }
    }
    if (first === 'capabilities') {
      return { ok: true, command: 'capabilities', ...commandHelp() }
    }

    const definition = [...chatboxCliCommandCatalog]
      .sort((a, b) => b.path.length - a.path.length)
      .find((candidate) => candidate.path.every((part, index) => argv[index]?.toLowerCase() === part))
    if (!definition) {
      return {
        ok: false,
        command: displayCommand,
        error: `Unsupported chatbox_cli command: ${displayCommand}`,
        ...commandHelp(first),
      }
    }

    const args = argv.slice(definition.path.length)
    const result = await executeCatalogCommand(definition, {
      argv: args,
      parsed: parseArguments(args),
      displayCommand,
      sessionId: options.sessionId,
      toolCallId: toolContext.toolCallId,
      approved: toolContext.approved === true,
      approvalDetails: toolContext.approvalDetails,
      abortSignal: toolContext.abortSignal,
    })
    return {
      ok: true,
      command: definition.path.join(' '),
      apiVersion: CHATBOX_CLI_API_VERSION,
      ...result,
    }
  } catch (error) {
    if (isApprovalPause(error) || (error instanceof DOMException && error.name === 'AbortError')) throw error
    return {
      ok: false,
      command: displayCommand,
      apiVersion: CHATBOX_CLI_API_VERSION,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ChatboxCliUsageError ? { kind: 'usage' } : {}),
    }
  }
}

export function getChatboxCliDescription(): string {
  return `
### Chatbox Virtual CLI
Use \`chatbox_cli\` for Chatbox account status, read-only settings, conversation history, and image generation.
Prefer structured \`argv\` input. This is a controlled app tool, not a real shell.
- Read history without approval: \`["chats", "list"]\`, \`["chats", "search", "query"]\`, \`["chats", "read", "<id>"]\`.
- Read safe settings: \`["settings", "list"]\`, \`["settings", "get", "appearance.theme"]\`. Settings cannot be changed through this tool; guide the user to the returned Chatbox Settings location to change them manually.
- Start background image work: \`["image", "generate", "--prompt", "..."]\`. Chatbox shows a localized approval card before submitting the potentially billable request.
- When the user names an image model, pass \`--model\` (model id or display name). Use \`["image", "models"]\` to discover models. Never silently fall back to the default model when the user asked for a specific one.
- After an accepted image task, end the turn and wait for Chatbox's automated callback. Never poll \`image status\`; use it only after a callback, on explicit user request, or for recovery diagnostics.
- Chatbox shows generated images to the user inline at the generate tool call. Never repeat them in replies: no markdown images and no image links.
- \`image history\` reads the device-wide Image Creator history, not only the current conversation.
Background completion arrives as an automated user-role message that explicitly states no human input or approval occurred.
`
}
