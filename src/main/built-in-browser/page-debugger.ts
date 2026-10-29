import type { WebContents } from 'electron'

/** The page's developer tools or another client already holds its debugger. */
export class DebuggerUnavailableError extends Error {}

type EventListener = (method: string, params: unknown) => void

/**
 * Chrome DevTools Protocol access to one page. It attaches on first use and stays attached until the
 * page closes or another client takes the debugger over, so later commands reuse the same session.
 */
export class PageDebugger {
  private readonly listeners = new Set<EventListener>()
  private attached = false
  private endSession: (() => void) | null = null

  constructor(private readonly contents: WebContents) {}

  /** Sends a command; with `signal`, an aborted wait rejects, and a command aborted beforehand is not sent. */
  async send<T = unknown>(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    this.ensureAttached()
    const sent = this.contents.debugger.sendCommand(method, params) as Promise<T>
    if (!signal) return sent
    return await new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      sent.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }

  /**
   * Resolves with the params of the next `method` event, or null after `timeoutMs`. Listening starts
   * immediately, so an event caused by a command sent right after this call is not missed.
   */
  nextEvent<T>(method: string, timeoutMs: number, signal: AbortSignal): Promise<T | null> {
    this.ensureAttached()
    return new Promise<T | null>((resolve, reject) => {
      const finish = (settle: () => void) => {
        clearTimeout(timer)
        this.listeners.delete(listener)
        signal.removeEventListener('abort', onAbort)
        settle()
      }
      const listener: EventListener = (eventMethod, params) => {
        if (eventMethod === method) finish(() => resolve(params as T))
      }
      const onAbort = () => finish(() => reject(signal.reason))
      const timer = setTimeout(() => finish(() => resolve(null)), timeoutMs)
      this.listeners.add(listener)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Detaches from the page, which drops every state the session's commands set, such as file chooser
   * interception. The next command attaches again.
   */
  reset(): void {
    if (!this.attached) return
    try {
      this.contents.debugger.detach()
    } catch {
      // A destroyed page has no session left to end.
    }
    this.endSession?.()
  }

  private ensureAttached(): void {
    if (this.attached) return
    const target = this.contents.debugger
    if (target.isAttached()) {
      throw new DebuggerUnavailableError('The page is held by its developer tools or another debugger.')
    }
    try {
      target.attach('1.3')
    } catch (error) {
      throw new DebuggerUnavailableError(error instanceof Error ? error.message : String(error))
    }
    this.attached = true
    const onMessage = (_event: Electron.Event, method: string, params: unknown) => {
      for (const listener of [...this.listeners]) listener(method, params)
    }
    const onDetach = () => {
      target.off('message', onMessage)
      target.off('detach', onDetach)
      this.attached = false
      this.endSession = null
    }
    target.on('message', onMessage)
    target.on('detach', onDetach)
    this.endSession = onDetach
  }
}
