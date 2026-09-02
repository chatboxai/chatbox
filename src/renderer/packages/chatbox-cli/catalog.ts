import type { ChatboxCliCommandDefinition } from './types'

export type ChatboxCliCommandDomain = 'account' | 'settings' | 'chats' | 'image'

export interface ChatboxCliCommandCatalogEntry
  extends Pick<ChatboxCliCommandDefinition, 'path' | 'description' | 'usage'> {
  domain: ChatboxCliCommandDomain
}

/**
 * Pure command metadata. Keep this module free of renderer stores and services so
 * help/capability discovery never loads the runtime implementation of every domain.
 */
export const chatboxCliCommandCatalog: ChatboxCliCommandCatalogEntry[] = [
  {
    domain: 'account',
    path: ['version'],
    description: 'Show installed Chatbox client version and platform.',
    usage: 'chatbox version',
  },
  {
    domain: 'account',
    path: ['account', 'status'],
    description: 'Show masked account, plan, and cached quota status.',
    usage: 'chatbox account status',
  },
  {
    domain: 'account',
    path: ['account', 'license'],
    description: 'Show masked license and plan details.',
    usage: 'chatbox account license',
  },
  {
    domain: 'account',
    path: ['account', 'quota'],
    description: 'Show cached token, image, and expansion-pack quota.',
    usage: 'chatbox account quota',
  },
  {
    domain: 'account',
    path: ['account', 'refresh'],
    description: 'Refresh license and quota details from Chatbox API.',
    usage: 'chatbox account refresh',
  },
  {
    domain: 'settings',
    path: ['settings', 'list'],
    description: 'List settings exposed through the read-only CLI allowlist.',
    usage: 'chatbox settings list',
  },
  {
    domain: 'settings',
    path: ['settings', 'get'],
    description: 'Read one allowlisted setting.',
    usage: 'chatbox settings get <key>',
  },
  {
    domain: 'chats',
    path: ['chats', 'list'],
    description: 'List conversation metadata. Reading history does not require approval.',
    usage: 'chatbox chats list [--limit 10] [--cursor 0] [--archived]',
  },
  {
    domain: 'chats',
    path: ['chats', 'search'],
    description: 'Search message text across conversation history without approval.',
    usage: 'chatbox chats search <query> [--limit 10]',
  },
  {
    domain: 'chats',
    path: ['chats', 'read'],
    description: 'Read compact user/assistant messages from one conversation without approval.',
    usage: 'chatbox chats read <session-id> [--limit 20] [--cursor 0]',
  },
  {
    domain: 'image',
    path: ['image', 'generate'],
    description:
      'Request approval, then start a callback-driven image background task. Never poll for completion. When the user names a model, pass --model (model id or display name); without --model the first catalog model is used.',
    usage:
      'chatbox image generate --prompt <text> [--provider <id>] [--model <id-or-name>] [--count 1] [--aspect-ratio <ratio>]',
  },
  {
    domain: 'image',
    path: ['image', 'status'],
    description: 'Inspect one image record after a callback, on explicit request, or for recovery. Do not poll it.',
    usage: 'chatbox image status <record-id>',
  },
  {
    domain: 'image',
    path: ['image', 'history'],
    description: 'List the device-wide Image Creator history, not only the current conversation.',
    usage: 'chatbox image history [--limit 10] [--cursor 0]',
  },
  {
    domain: 'image',
    path: ['image', 'models'],
    description:
      'List configured image-capable models without exposing provider credentials. Run this when the user asks which models exist or names a model you cannot resolve.',
    usage: 'chatbox image models',
  },
]

export function sameCommandPath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index])
}
