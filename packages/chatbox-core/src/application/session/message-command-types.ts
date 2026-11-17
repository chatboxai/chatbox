/** Raised when a required insertion anchor is absent from the selected thread path. */
export class MessageAnchorNotFoundError extends Error {
  constructor(
    readonly sessionId: string,
    readonly anchorMessageId: string
  ) {
    super(`Anchor message ${anchorMessageId} not found in session ${sessionId}`)
    this.name = 'MessageAnchorNotFoundError'
  }
}

export interface MessageInsertOptions {
  /** Require the requested anchor instead of appending when it is unavailable. */
  requireAnchor?: boolean
}
