// No-op stand-in for the removed Sentry integration (local-first: no telemetry).
// Single module for both processes; call sites keep the Sentry-like API so
// error-reporting intent stays grep-able, but nothing is ever sent anywhere.

export interface SentryScopeLike {
  setTag(key: string, value: string | number | boolean): void
  setExtra(key: string, value: unknown): void
  setLevel(level: string): void
  setContext(name: string, context: Record<string, unknown>): void
}

const noopScope: SentryScopeLike = {
  setTag() {},
  setExtra() {},
  setLevel() {},
  setContext() {},
}

export function captureException(_error: unknown): void {}

export function getCurrentScope(): SentryScopeLike {
  return noopScope
}

export function withScope(callback: (scope: SentryScopeLike) => void): void {
  callback(noopScope)
}

export const sentry = { captureException, withScope }
