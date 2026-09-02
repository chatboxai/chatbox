export const DESKTOP_DIRECT_REQUEST_CHANNELS = {
  start: 'desktop-direct-request:start',
  read: 'desktop-direct-request:read',
  cancel: 'desktop-direct-request:cancel',
} as const

export interface DesktopDirectRequestPayload {
  requestId: string
  url: string
  method: string
  headers: Record<string, string>
  body?: string | ArrayBuffer
}

export interface DesktopDirectResponseMetadata {
  status: number
  statusText: string
  headers: [string, string][]
  hasBody: boolean
}

export type DesktopDirectReadResult = { done: true } | { done: false; chunk: Uint8Array }
