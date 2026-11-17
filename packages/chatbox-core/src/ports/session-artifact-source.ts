export interface SessionArtifactRequest {
  sessionId: string
  messageId: string
  signal?: AbortSignal
}

/** Markdown preceding a target, emitted in causal order at one committed revision. */
export interface SessionArtifactRepositoryPort {
  iterateSessionArtifactMarkdown(request: SessionArtifactRequest): AsyncIterable<string>
}
