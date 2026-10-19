import { toSandboxSeedAttachment } from '@shared/sandbox/attachment-path'
import type { SessionContextBeforeTarget } from '../ports/session-context-source'
import type { Message } from '../types/session'
import { deriveMessageFacts } from './message-facts'

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
    facts.sandboxSeedAttachments.push(...(message.files?.map(toSandboxSeedAttachment) ?? []))
    facts.fileResourceKeys.push(...(deriveMessageFacts(message).fileResourceKeys ?? []))
  }
  return facts
}
