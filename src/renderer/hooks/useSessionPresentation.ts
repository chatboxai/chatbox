import { type SessionReadModel, sessionReadModelHeader } from '@chatbox/core/ports'
import { useSessionTranscript as useSharedSessionTranscript } from '@chatbox/react/query'
import { useMemo } from 'react'
import { rendererApplication } from '@/app/renderer-application'

export function useSessionPresentation(sessionId: string | null) {
  const query = rendererApplication.sessionHooks.useSessionReadModel(sessionId)
  const model = query.readModel
  const header = useMemo(() => (model ? sessionReadModelHeader(model) : model), [model])
  return { ...query, header }
}

export function useSessionTranscript(model: SessionReadModel | null | undefined) {
  return useSharedSessionTranscript(model, rendererApplication.sessions)
}
