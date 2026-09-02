import type { ReactNode } from 'react'
import { useStreamingTextSegments } from './streaming-text-fade'

export default function StreamingTextFade(props: {
  text: string
  streamKey?: string
  generating?: boolean
  className?: string
}) {
  const { text, streamKey, generating, className } = props
  const segments = useStreamingTextSegments(text, generating, streamKey)
  const textNodes: ReactNode[] = []
  let cursor = 0

  for (const segment of segments) {
    if (segment.startOffset > cursor) textNodes.push(text.slice(cursor, segment.startOffset))
    textNodes.push(
      <span key={segment.key} className="chatbox-streaming-text-fade" data-streaming-fade-key={segment.key}>
        {text.slice(segment.startOffset, segment.endOffset)}
      </span>
    )
    cursor = segment.endOffset
  }
  if (cursor < text.length) textNodes.push(text.slice(cursor))

  return <div className={className}>{segments.length > 0 ? textNodes : text}</div>
}
