import type { CopilotDetail } from '@shared/types'
import { isCopilotDetail } from './CopilotService'

export type CopilotUsageAction = 'use_copilot' | 'create_session' | 'create_thread' | 'create_message'

export interface FeaturedCopilotFilters {
  lang: string
  limit?: number
  cursor?: string
  tag?: string
  search?: string
}

export interface FeaturedCopilotPage {
  data: CopilotDetail[]
  next_cursor: string | null
}

export interface FeaturedCopilotClientOptions {
  request(input: string, init?: RequestInit): Promise<Response>
  apiOrigin: string | (() => string)
  deviceId(): Promise<string>
}

type CopilotRequestSignal = NonNullable<Parameters<FeaturedCopilotClientOptions['request']>[1]>['signal']

export class FeaturedCopilotClient {
  constructor(private readonly options: FeaturedCopilotClientOptions) {}

  async tags(lang: string, signal?: AbortSignal): Promise<string[]> {
    const result = await this.request(`/api/system_copilots/tags/${encodeURIComponent(lang)}`, {
      method: 'GET',
      // Forward the original signal across the native and DOM request declarations.
      signal: signal as CopilotRequestSignal,
    })
    if (!isRecord(result) || !Array.isArray(result.data) || !result.data.every((tag) => typeof tag === 'string')) {
      throw new Error('Invalid Copilot tags response')
    }
    return result.data
  }

  async list(filters: FeaturedCopilotFilters, signal?: AbortSignal): Promise<FeaturedCopilotPage> {
    const result = await this.request('/api/system_copilots/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...filters, limit: filters.limit ?? 18 }),
      signal: signal as CopilotRequestSignal,
    })
    if (
      !isRecord(result) ||
      !Array.isArray(result.data) ||
      !result.data.every(isCopilotDetail) ||
      (result.next_cursor !== undefined && result.next_cursor !== null && typeof result.next_cursor !== 'string')
    ) {
      throw new Error('Invalid Copilots response')
    }
    return { data: result.data, next_cursor: result.next_cursor ?? null }
  }

  async recordUsage(id: string, action: CopilotUsageAction): Promise<void> {
    try {
      await this.options.request(this.url('/api/system_copilots/record_usage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, device_id: await this.options.deviceId() }),
      })
    } catch {
      // Usage recording is best effort and cannot interrupt a local action.
    }
  }

  private url(path: string): string {
    const origin = typeof this.options.apiOrigin === 'function' ? this.options.apiOrigin() : this.options.apiOrigin
    return `${origin.replace(/\/+$/, '')}${path}`
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.options.request(this.url(path), init)
    if (!response.ok) throw new Error(`Copilots request failed (${response.status})`)
    return response.json()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
