import type { Message } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { analyzeCurrentInputTokens } from '../analyzer'
import { calculateAttachmentTokens } from '../attachment-computation'
import type { TokenizerType } from '../types'

/** Draft attachments belong to React state, so their results never enter the persisted-message queue. */
export function useDraftAttachmentTokens(
  message: Message | undefined,
  tokenizerType: TokenizerType,
  modelSupportToolUseForFile: boolean,
  sandboxMode = false
) {
  const key = JSON.stringify([message?.files, message?.links, tokenizerType, modelSupportToolUseForFile, sandboxMode])
  const [resolved, setResolved] = useState<{ key: string; tokens: number; failed: boolean } | null>(null)
  const analysis = useMemo(
    () =>
      analyzeCurrentInputTokens({
        constructedMessage: message,
        tokenizerType,
        modelSupportToolUseForFile,
        sandboxMode,
        currentInputTextTokens: 0,
      }),
    [message, tokenizerType, modelSupportToolUseForFile, sandboxMode]
  )
  const matches = resolved?.key === key
  const inputRef = useRef({ message, analysis })
  inputRef.current = { message, analysis }
  useEffect(() => {
    const { message, analysis } = inputRef.current
    if (!analysis.pendingTasks.length) return
    let active = true
    const controller = new AbortController()
    void (async () => {
      let tokens = 0
      let failed = false
      for (const task of analysis.pendingTasks) {
        if (!active) return
        const attachment = (task.attachmentType === 'file' ? message?.files : message?.links)?.find(
          (item) => item.id === task.attachmentId
        )
        if (!attachment) {
          failed = true
          continue
        }
        try {
          const result = await calculateAttachmentTokens(
            attachment,
            {
              ...task,
              id: 'draft-attachment',
              createdAt: Date.now(),
              sessionId: 'new',
            },
            controller.signal
          )
          if (result.success && result.result) tokens += result.result.tokens
          else failed = true
        } catch {
          failed = true
        }
      }
      if (active) setResolved({ key, tokens, failed })
    })()
    return () => {
      active = false
      controller.abort()
    }
    // The key covers attachment values and policy; typing text does not restart attachment work.
  }, [key])
  const isCalculating = analysis.pendingTasks.length > 0 && !matches
  return {
    tokens: analysis.breakdown.attachments + (matches ? resolved.tokens : 0),
    isCalculating,
    isApproximate: analysis.hasApproximateText || isCalculating || (matches && resolved.failed),
  }
}
