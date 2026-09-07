import { Text } from '@mantine/core'
import { type FC, useEffect, useRef } from 'react'

export function getReasoningSummary(content: string, isThinking: boolean): string {
  const visibleContent = content.trimEnd()
  if (!visibleContent) return ''

  if (isThinking) {
    const lastLineBreak = visibleContent.lastIndexOf('\n')
    return lastLineBreak === -1 ? visibleContent : visibleContent.slice(lastLineBreak + 1)
  }

  const firstLineBreak = visibleContent.indexOf('\n')
  return firstLineBreak === -1 ? visibleContent : visibleContent.slice(0, firstLineBreak)
}

export function getLogicalEndScrollLeft(direction: string, scrollWidth: number, clientWidth: number): number {
  const scrollDistance = Math.max(0, scrollWidth - clientWidth)
  return direction === 'rtl' ? -scrollDistance : scrollDistance
}

// Mirrors the DeepSeek harness reasoning row: while streaming, show the latest
// line and keep its right edge in view; after completion, reset to a stable
// first-line summary. The full reasoning remains available in the disclosure.
export const ReasoningInlineSummary: FC<{ content: string; isThinking: boolean }> = ({ content, isThinking }) => {
  const summary = getReasoningSummary(content, isThinking)
  const summaryRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      const element = summaryRef.current
      if (!element) return
      element.scrollLeft = isThinking
        ? getLogicalEndScrollLeft(getComputedStyle(element).direction, element.scrollWidth, element.clientWidth)
        : 0
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [isThinking, summary])

  if (!summary) return null

  return (
    <Text
      ref={summaryRef}
      component="span"
      size="xs"
      c="chatbox-tertiary"
      lh="20px"
      data-follow-end={isThinking || undefined}
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textAlign: 'left',
        textOverflow: isThinking ? 'clip' : 'ellipsis',
      }}
    >
      · {summary}
    </Text>
  )
}
