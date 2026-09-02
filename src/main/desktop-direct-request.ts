import type { WebContents } from 'electron'
import { ipcMain } from 'electron'
import {
  DESKTOP_DIRECT_REQUEST_CHANNELS,
  type DesktopDirectReadResult,
  type DesktopDirectRequestPayload,
  type DesktopDirectResponseMetadata,
} from '../shared/desktop-direct-request'
import type { FetchImplementation } from '../shared/request/request'
import { desktopSessionFetch } from './main-fetch'

interface ActiveRequest {
  controller: AbortController
  ownerId: number
  reader: ReadableStreamDefaultReader<Uint8Array> | null
}

function assertHttpUrl(url: string): void {
  const protocol = new URL(url).protocol
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`Unsupported desktop direct request protocol: ${protocol}`)
  }
}

export class DesktopDirectRequestManager {
  private readonly activeRequests = new Map<string, ActiveRequest>()

  constructor(private readonly fetchImpl: FetchImplementation = desktopSessionFetch) {}

  async start(ownerId: number, payload: DesktopDirectRequestPayload): Promise<DesktopDirectResponseMetadata> {
    if (this.activeRequests.has(payload.requestId)) {
      throw new Error(`Desktop direct request already exists: ${payload.requestId}`)
    }
    assertHttpUrl(payload.url)

    const activeRequest: ActiveRequest = {
      controller: new AbortController(),
      ownerId,
      reader: null,
    }
    this.activeRequests.set(payload.requestId, activeRequest)

    try {
      const response = await this.fetchImpl(payload.url, {
        method: payload.method,
        headers: payload.headers,
        body: payload.body,
        signal: activeRequest.controller.signal,
      })
      activeRequest.reader = response.body?.getReader() ?? null

      const headers: [string, string][] = []
      response.headers.forEach((value, name) => headers.push([name, value]))

      if (!activeRequest.reader) {
        this.deleteIfCurrent(payload.requestId, activeRequest)
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        hasBody: activeRequest.reader !== null,
      }
    } catch (error) {
      this.deleteIfCurrent(payload.requestId, activeRequest)
      throw error
    }
  }

  async read(ownerId: number, requestId: string): Promise<DesktopDirectReadResult> {
    const activeRequest = this.getOwnedRequest(ownerId, requestId)
    if (!activeRequest.reader) {
      this.deleteIfCurrent(requestId, activeRequest)
      return { done: true }
    }

    try {
      const result = await activeRequest.reader.read()
      if (result.done) {
        this.deleteIfCurrent(requestId, activeRequest)
        return { done: true }
      }
      return { done: false, chunk: result.value }
    } catch (error) {
      this.deleteIfCurrent(requestId, activeRequest)
      throw error
    }
  }

  async cancel(ownerId: number, requestId: string): Promise<void> {
    const activeRequest = this.activeRequests.get(requestId)
    if (!activeRequest) return
    if (activeRequest.ownerId !== ownerId) {
      throw new Error(`Desktop direct request belongs to another renderer: ${requestId}`)
    }

    this.deleteIfCurrent(requestId, activeRequest)
    activeRequest.controller.abort()
    await activeRequest.reader?.cancel('aborted').catch(() => undefined)
  }

  cancelOwner(ownerId: number): void {
    for (const [requestId, activeRequest] of this.activeRequests) {
      if (activeRequest.ownerId !== ownerId) continue
      this.deleteIfCurrent(requestId, activeRequest)
      activeRequest.controller.abort()
      void activeRequest.reader?.cancel('renderer unavailable').catch(() => undefined)
    }
  }

  private getOwnedRequest(ownerId: number, requestId: string): ActiveRequest {
    const activeRequest = this.activeRequests.get(requestId)
    if (!activeRequest) {
      throw new Error(`Desktop direct request not found: ${requestId}`)
    }
    if (activeRequest.ownerId !== ownerId) {
      throw new Error(`Desktop direct request belongs to another renderer: ${requestId}`)
    }
    return activeRequest
  }

  private deleteIfCurrent(requestId: string, activeRequest: ActiveRequest): void {
    if (this.activeRequests.get(requestId) === activeRequest) {
      this.activeRequests.delete(requestId)
    }
  }
}

export function registerDesktopDirectRequestHandlers(
  manager: DesktopDirectRequestManager = new DesktopDirectRequestManager()
): void {
  const boundSenders = new Set<number>()

  const bindSenderCleanup = (sender: WebContents) => {
    if (boundSenders.has(sender.id)) return
    boundSenders.add(sender.id)
    sender.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) {
        manager.cancelOwner(sender.id)
      }
    })
    sender.on('render-process-gone', () => manager.cancelOwner(sender.id))
    sender.once('destroyed', () => {
      boundSenders.delete(sender.id)
      manager.cancelOwner(sender.id)
    })
  }

  ipcMain.handle(DESKTOP_DIRECT_REQUEST_CHANNELS.start, (event, payload: DesktopDirectRequestPayload) => {
    bindSenderCleanup(event.sender)
    return manager.start(event.sender.id, payload)
  })
  ipcMain.handle(DESKTOP_DIRECT_REQUEST_CHANNELS.read, (event, requestId: string) => {
    return manager.read(event.sender.id, requestId)
  })
  ipcMain.handle(DESKTOP_DIRECT_REQUEST_CHANNELS.cancel, (event, requestId: string) => {
    return manager.cancel(event.sender.id, requestId)
  })
}
