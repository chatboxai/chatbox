import { sandboxAttachmentIdentity, sandboxAttachmentRelPath } from '@shared/sandbox/attachment-path'
import type { SessionContextBeforeTarget, SessionContextSeedAttachment } from '../ports/session-context-source'
import type { Message } from '../types/session'
import { deriveMessageFacts } from './message-facts'

function seedDestination(seed: SessionContextSeedAttachment): string {
  return sandboxAttachmentRelPath(seed.name, sandboxAttachmentIdentity(seed))
}

/**
 * Collects seeds once per sandbox destination across a path scan: a summary
 * seeds the same files as the messages it covers. Each seed is fingerprinted once.
 */
export class SeedAttachmentCollector {
  private readonly destinations: Set<string>

  /** Appends to `seeds`, which may already hold the seeds of an earlier part of the path. */
  constructor(readonly seeds: SessionContextSeedAttachment[]) {
    this.destinations = new Set(seeds.map(seedDestination))
  }

  add(seeds: readonly SessionContextSeedAttachment[]): void {
    for (const seed of seeds) {
      const destination = seedDestination(seed)
      if (this.destinations.has(destination)) continue
      this.destinations.add(destination)
      this.seeds.push(seed)
    }
  }
}

export function contextPathFacts(messages: Message[], prefix?: SessionContextBeforeTarget): SessionContextBeforeTarget {
  const facts: SessionContextBeforeTarget = prefix
    ? {
        ...prefix,
        sandboxSeedAttachments: [...prefix.sandboxSeedAttachments],
        fileResourceKeys: [...prefix.fileResourceKeys],
      }
    : {
        firstMessageTimestamp: messages[0]?.timestamp,
        userMessageCount: 0,
        hasAssistantMessage: false,
        hasLegacyCommandHistory: false,
        sandboxSeedAttachments: [],
        fileResourceKeys: [],
      }
  const seeds = new SeedAttachmentCollector(facts.sandboxSeedAttachments)
  for (const message of messages) {
    if (message.role === 'user') {
      facts.userMessageCount += 1
      facts.lastUserMessageId = message.id
    }
    if (message.role === 'assistant') facts.hasAssistantMessage = true
    if (
      message.contentParts.some(
        (part) => part.type === 'tool-call' && (part.toolName === 'user_exec' || part.toolName === 'code_execution')
      )
    ) {
      facts.hasLegacyCommandHistory = true
    }
    const messageFacts = deriveMessageFacts(message)
    seeds.add(messageFacts.seedAttachments ?? [])
    facts.fileResourceKeys.push(...(messageFacts.fileResourceKeys ?? []))
  }
  return facts
}
