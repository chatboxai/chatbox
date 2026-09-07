import type { SessionReadModel } from '@chatbox/core/ports'
import { useMemo } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import type { ContextTokenSource } from '@/packages/context-management/context-tokens'

/** Context estimation consumes a read-only source, independently of transcript paging. */
export function useSessionTokenContext(sessionId: string | null, readModel: SessionReadModel | null | undefined) {
  const session = readModel?.kind === 'full' ? readModel.session : undefined
  const { source: windowSource } = rendererApplication.sessionHooks.useSessionContextSource(sessionId, {
    enabled: readModel?.kind === 'window',
  })
  const messages = session?.messages
  const compactionPoints = session?.compactionPoints
  const textTokens = readModel?.kind === 'full' ? readModel.textTokens : undefined
  return useMemo<ContextTokenSource | null | undefined>(() => {
    if (messages) return { candidateMessages: messages, compactionPoints, textTokens }
    if (readModel?.kind !== 'window' || readModel.header.id !== sessionId) return undefined
    if (windowSource) return windowSource
    if (windowSource === null) return null
    // This preview belongs only to estimation; generation still reads its complete context source.
    return {
      candidateMessages: readModel.window.messages.map((row) => row.message),
      compactionPoints: readModel.window.thread.compactionPoints,
      textTokens: readModel.window.textTokens,
      isPartial: true,
    }
  }, [messages, compactionPoints, textTokens, windowSource, readModel, sessionId])
}
