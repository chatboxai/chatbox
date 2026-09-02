import type { MessageContentParts } from '@shared/types'
import { visibleContentParts } from '@shared/utils/message'

type MessageContentPart = MessageContentParts[number]
type TimelinePart = Extract<MessageContentPart, { type: 'reasoning' | 'text' | 'tool-call' }>
export type GroupedMessageContentPart = { type: 'step_group'; parts: TimelinePart[] } | MessageContentPart

interface MessageTimelineLayout {
  orderedContentParts: MessageContentParts
  lastStepIndex: number
  groupedContentParts: GroupedMessageContentPart[]
}

/**
 * Some providers return a single non-streaming response as `[text, reasoning]`.
 * In v1.21, content parts rendered in their stored order without a connected
 * timeline, so the text remained normal answer content and the reasoning block
 * followed it.
 *
 * Preserve that presentation only for the exact two-part compatibility case.
 * Multi-step timelines continue to use their stored order and semantics.
 */
function isLegacyNonStreamingTextReasoningPair(
  contentParts: MessageContentParts,
  isStreamingMode: boolean | undefined
): boolean {
  return (
    isStreamingMode === false &&
    contentParts.length === 2 &&
    contentParts[0].type === 'text' &&
    contentParts[1].type === 'reasoning'
  )
}

export function createMessageTimelineLayout(
  contentParts: MessageContentParts,
  isStreamingMode: boolean | undefined
): MessageTimelineLayout {
  const orderedContentParts = visibleContentParts(contentParts)
  const preserveLegacyTextReasoningPair = isLegacyNonStreamingTextReasoningPair(orderedContentParts, isStreamingMode)

  // Text before the last reasoning/tool-call part is intermediate narration;
  // text after it is the final answer.
  let lastStepIndex = -1
  for (let index = 0; index < orderedContentParts.length; index++) {
    const part = orderedContentParts[index]
    if (part.type === 'reasoning' || part.type === 'tool-call') lastStepIndex = index
  }

  const groupedContentParts: GroupedMessageContentPart[] = []
  const pushToStepGroup = (part: TimelinePart) => {
    const last = groupedContentParts[groupedContentParts.length - 1]
    if (last && 'parts' in last && last.type === 'step_group') {
      last.parts.push(part)
    } else {
      groupedContentParts.push({ type: 'step_group', parts: [part] })
    }
  }

  for (let index = 0; index < orderedContentParts.length; index++) {
    const part = orderedContentParts[index]
    if (part.type === 'tool-call' || part.type === 'reasoning') {
      pushToStepGroup(part)
    } else if (part.type === 'text' && index < lastStepIndex && !preserveLegacyTextReasoningPair) {
      pushToStepGroup(part)
    } else {
      groupedContentParts.push(part)
    }
  }

  return { orderedContentParts, lastStepIndex, groupedContentParts }
}

/**
 * Images the model emitted mid-run are answer content, not process noise: they must
 * stay visible while the process is collapsed.
 */
function collectImageParts(parts: MessageContentParts): GroupedMessageContentPart[] {
  return parts.filter((part) => part.type === 'image')
}

/**
 * Content shown while the process timeline is collapsed: the images produced along
 * the way, followed by the final answer.
 */
export function createCollapsedDisplayGroups(
  orderedContentParts: MessageContentParts,
  lastStepIndex: number
): GroupedMessageContentPart[] {
  const answerParts = orderedContentParts.slice(lastStepIndex + 1)
  if (answerParts.length > 0) {
    return [...collectImageParts(orderedContentParts.slice(0, lastStepIndex + 1)), ...answerParts]
  }
  // The message ended on a process step — fall back to showing that last step.
  const lastPart = orderedContentParts[orderedContentParts.length - 1]
  if (!lastPart) return []
  const precedingImages = collectImageParts(orderedContentParts.slice(0, orderedContentParts.length - 1))
  if (lastPart.type === 'tool-call' || lastPart.type === 'reasoning') {
    return [...precedingImages, { type: 'step_group' as const, parts: [lastPart] }]
  }
  return [...precedingImages, lastPart]
}
