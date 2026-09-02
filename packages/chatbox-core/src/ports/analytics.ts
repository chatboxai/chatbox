export type AnalyticsEventValue = string | number | boolean | null | undefined

export interface AnalyticsPort {
  init(): Promise<void> | void
  event(name: string, params: Record<string, AnalyticsEventValue>): Promise<void> | void
}
