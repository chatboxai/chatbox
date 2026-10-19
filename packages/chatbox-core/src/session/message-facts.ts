import { PROMPT_CACHE_CONFIRM_MIN_CHARS } from './prompt-cache-policy'
import { toSandboxSeedAttachment } from '@shared/sandbox/attachment-path'
import { isContextEligibleMessage } from '@shared/context/message-eligibility'
import { messageHasChatboxSearchSignInError } from '@shared/session/web-search-sign-in-error'
import { isMessageEligibleForAutoTitle } from './message-success'
import { hasPendingPauseInteraction } from '../message-approval'
import type { Message } from '../types/session'
import type { MessageRowMetadata, SessionMessageFacts, SessionThreadSummary } from './session-tree/types'

export function deriveMessageFacts(message: Message): SessionMessageFacts {
  return {
    autoTitleEligible: isMessageEligibleForAutoTitle(message),
    role: message.role,
    contextEligible: isContextEligibleMessage(message),
    promptCacheChars: Math.min(
      PROMPT_CACHE_CONFIRM_MIN_CHARS,
      message.contentParts.reduce(
        (count, part) =>
          count +
          (part.type === 'text' || part.type === 'reasoning' ? part.text.length : part.type === 'image' ? 7 : 0),
        0
      )
    ),
    hasToolCall: message.contentParts.some((part) => part.type === 'tool-call'),
    isForkMarker: message.isForkMarker === true,
    hasFiles: Boolean(message.files?.length),
    paused: hasPendingPauseInteraction([message]),
    webSearchSignInError: messageHasChatboxSearchSignInError(message),
    hasLegacyCommand: message.contentParts.some(
      (part) => part.type === 'tool-call' && (part.toolName === 'user_exec' || part.toolName === 'code_execution')
    ),
    steered: message.steered === true,
    hasError: Boolean(message.error || message.errorCode),
    finishReason: message.finishReason,
    timestamp: message.timestamp,
    seedAttachments: message.files?.map(toSandboxSeedAttachment),
    imageStorageKeys: [
      ...new Set(
        message.contentParts.flatMap((part) => (part.type === 'image' && part.storageKey ? [part.storageKey] : []))
      ),
    ],
    attachmentOwnershipIds: [
      ...new Set(
        (message.files ?? []).flatMap((file) =>
          typeof file.sessionAttachmentId === 'number' ? [file.sessionAttachmentId] : []
        )
      ),
    ],
    fileResourceKeys: [
      ...new Set([
        ...(message.files ?? [])
          .filter((file) => file.ragMode !== 'session-retrieval')
          .flatMap((file) => (file.storageKey ? [file.storageKey] : file.localPath ? [`local:${file.localPath}`] : [])),
        ...(message.links ?? []).flatMap((link) => (link.storageKey ? [link.storageKey] : [])),
        ...message.contentParts.flatMap((part) =>
          part.type === 'tool-call' && part.resultStorageKey ? [part.resultStorageKey] : []
        ),
      ]),
    ],
  }
}

export function emptyThreadSummary(): SessionThreadSummary {
  return {
    hasAutoTitleContent: false,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    fileMessageCount: 0,
    generatingMessageCount: 0,
    pausedMessageCount: 0,
    webSearchSignInErrorCount: 0,
    legacyCommandMessageCount: 0,
    steeredMessageCount: 0,
  }
}

/** Append one selected row in path order using only its stored facts. */
export function addSummaryRow(
  summary: SessionThreadSummary,
  row: Pick<MessageRowMetadata, 'messageId' | 'kind' | 'status'> & { facts: SessionMessageFacts }
): SessionThreadSummary {
  const facts = row.facts
  return {
    firstNamingUserMessageId:
      summary.firstNamingUserMessageId ??
      (facts.role === 'user' && facts.autoTitleEligible ? row.messageId : undefined),
    lastNamingAssistantMessageId:
      facts.role === 'assistant' && facts.autoTitleEligible ? row.messageId : summary.lastNamingAssistantMessageId,
    hasAutoTitleContent:
      summary.hasAutoTitleContent ||
      Boolean(summary.firstNamingUserMessageId && facts.role === 'assistant' && facts.autoTitleEligible),
    messageCount: summary.messageCount + 1,
    userMessageCount: summary.userMessageCount + Number(facts.role === 'user'),
    assistantMessageCount: summary.assistantMessageCount + Number(facts.role === 'assistant'),
    fileMessageCount: summary.fileMessageCount + Number(facts.hasFiles),
    generatingMessageCount: summary.generatingMessageCount + Number(row.status === 'generating'),
    pausedMessageCount: summary.pausedMessageCount + Number(facts.paused),
    webSearchSignInErrorCount: summary.webSearchSignInErrorCount + Number(facts.webSearchSignInError),
    legacyCommandMessageCount: summary.legacyCommandMessageCount + Number(facts.hasLegacyCommand),
    steeredMessageCount: summary.steeredMessageCount + Number(facts.steered),
    ...(facts.role === 'user'
      ? { lastUserMessageId: row.messageId }
      : summary.lastUserMessageId
        ? { lastUserMessageId: summary.lastUserMessageId }
        : {}),
    ...(row.kind !== 'summary'
      ? { lastNonSummaryMessageId: row.messageId }
      : summary.lastNonSummaryMessageId
        ? { lastNonSummaryMessageId: summary.lastNonSummaryMessageId }
        : {}),
    ...(row.kind !== 'summary' && facts.role !== 'system' && !facts.isForkMarker
      ? { lastConversationMessageId: row.messageId }
      : summary.lastConversationMessageId
        ? { lastConversationMessageId: summary.lastConversationMessageId }
        : {}),
    ...(row.kind === 'summary'
      ? { lastSummaryMessageId: row.messageId }
      : summary.lastSummaryMessageId
        ? { lastSummaryMessageId: summary.lastSummaryMessageId }
        : {}),
    ...(summary.firstSystemMessageId
      ? { firstSystemMessageId: summary.firstSystemMessageId }
      : facts.role === 'system'
        ? { firstSystemMessageId: row.messageId }
        : {}),
  }
}
