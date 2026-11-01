import { BUILT_IN_BROWSER_SCRIPT_MAX_CHARS, type BuiltInBrowserDiagnostics } from '@shared/built-in-browser'
import { pageHelpersSource } from './page-helpers'

/** Entries kept per diagnostic list, so a noisy page cannot flood the model's context. */
export const MAX_DIAGNOSTIC_ENTRIES = 5
const MAX_MESSAGE_CHARS = 2_000
const MAX_URL_PATH_CHARS = 120

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (body: string) => unknown

/** Parses without running, so a syntax error is reported as such and the body cannot close the wrapper. */
export function scriptSyntaxError(code: string): string | undefined {
  try {
    new AsyncFunction(code)
    return undefined
  } catch (error) {
    return `The script has a syntax error: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Keeps the origin and a bounded path only: query strings, fragments and credentials often carry
 * tokens and signatures. CSP keywords such as `inline` or `eval` pass through unchanged.
 */
export function redactUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return /^[a-z-]+$/i.test(value) ? value : ''
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol.slice(0, -1)
  const path = url.pathname.length > MAX_URL_PATH_CHARS ? `${url.pathname.slice(0, MAX_URL_PATH_CHARS)}…` : url.pathname
  return url.origin === 'null' ? url.protocol : `${url.origin}${path}`
}

export type RunOutcome =
  | { kind: 'page_changed' }
  | { kind: 'value'; value: string; truncated: boolean; violations: unknown }
  | { kind: 'error'; message: string; violations: unknown }

/**
 * Wraps a script body for the page's main world. The wrapper reports a page that no longer has
 * `expectedUrl` without running the body, separates the body's own exceptions from failures to
 * run it, and collects the page's CSP violations while it runs. `operationKey` names the window
 * property holding the run's `{ cancelled, violations }` record, so the host can ask it to stop.
 */
export function runScriptSource(code: string, expectedUrl: string, operationKey: string): string {
  const key = JSON.stringify(operationKey)
  return `(async () => {
    if (location.href !== ${JSON.stringify(expectedUrl)}) return { kind: 'page_changed' };
    const __chatboxOperation = { cancelled: false, violations: [] };
    Object.defineProperty(window, ${key}, { value: __chatboxOperation, configurable: true });
    const __chatboxOnViolation = (event) => {
      if (__chatboxOperation.violations.length >= ${MAX_DIAGNOSTIC_ENTRIES}) return;
      __chatboxOperation.violations.push({ directive: String(event.effectiveDirective || event.violatedDirective || ''), blocked: String(event.blockedURI || '') });
    };
    document.addEventListener('securitypolicyviolation', __chatboxOnViolation, true);
    try {
      ${pageHelpersSource('__chatboxOperation')}
      const __chatboxFail = (prefix, error) => {
        const message = error && typeof error.message === 'string' ? error.message : String(error);
        return { kind: 'error', message: (prefix + message).slice(0, ${MAX_MESSAGE_CHARS}), violations: __chatboxOperation.violations };
      };
      // Violation events are queued as tasks; let those the body caused arrive before reporting.
      const __chatboxDrain = () => new Promise((resolve) => setTimeout(resolve, 0));
      let result;
      try {
        result = await (async () => {\n${code}\n})();
      } catch (error) {
        await __chatboxDrain();
        return __chatboxFail('', error);
      }
      await __chatboxDrain();
      let text;
      try {
        text = typeof result === 'string' ? result : JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? String(value) : value) ?? 'undefined';
      } catch (error) {
        return __chatboxFail('The script finished, but its return value cannot be serialized: ', error);
      }
      return { kind: 'value', value: text.slice(0, ${BUILT_IN_BROWSER_SCRIPT_MAX_CHARS}), truncated: text.length > ${BUILT_IN_BROWSER_SCRIPT_MAX_CHARS}, violations: __chatboxOperation.violations };
    } finally {
      document.removeEventListener('securitypolicyviolation', __chatboxOnViolation, true);
      delete window[${key}];
    }
  })()`
}

/** Asks a run that is still going to stop at its next helper call; returns its violations so far. */
export function cancelRunSource(operationKey: string): string {
  const key = JSON.stringify(operationKey)
  return `(() => {
    const operation = window[${key}];
    if (!operation) return null;
    operation.cancelled = true;
    return operation.violations;
  })()`
}

/** The page can replace the builtins the wrapper uses, so its result is checked and bounded again here. */
export function parseRunOutcome(result: unknown): RunOutcome | undefined {
  const record = result as { kind?: unknown; value?: unknown; truncated?: unknown; message?: unknown } | null
  if (record?.kind === 'page_changed') return { kind: 'page_changed' }
  const violations = (result as { violations?: unknown } | null | undefined)?.violations
  if (record?.kind === 'error' && typeof record.message === 'string') {
    return { kind: 'error', message: record.message.slice(0, MAX_MESSAGE_CHARS), violations }
  }
  if (record?.kind === 'value' && typeof record.value === 'string') {
    return {
      kind: 'value',
      value: record.value.slice(0, BUILT_IN_BROWSER_SCRIPT_MAX_CHARS),
      truncated: record.value.length > BUILT_IN_BROWSER_SCRIPT_MAX_CHARS || record.truncated === true,
      violations,
    }
  }
  return undefined
}

type CspViolation = NonNullable<BuiltInBrowserDiagnostics['cspViolations']>[number]
export type FailedRequest = NonNullable<BuiltInBrowserDiagnostics['failedRequests']>[number]

export function redactViolations(violations: unknown): CspViolation[] {
  if (!Array.isArray(violations)) return []
  return violations.slice(0, MAX_DIAGNOSTIC_ENTRIES).flatMap((entry) => {
    const { directive, blocked } = (entry ?? {}) as { directive?: unknown; blocked?: unknown }
    if (typeof directive !== 'string' || typeof blocked !== 'string') return []
    return [{ directive: directive.slice(0, 80), blocked: redactUrl(blocked) }]
  })
}

export function redactRequest(request: {
  method: string
  url: string
  status?: number
  error?: string
}): FailedRequest {
  return {
    method: request.method,
    url: redactUrl(request.url),
    ...(request.status !== undefined ? { status: request.status } : {}),
    ...(request.error ? { error: request.error.slice(0, 80) } : {}),
  }
}

export function diagnosticsOf(
  violations: CspViolation[],
  failedRequests: FailedRequest[]
): BuiltInBrowserDiagnostics | undefined {
  if (violations.length === 0 && failedRequests.length === 0) return undefined
  return {
    ...(violations.length ? { cspViolations: violations } : {}),
    ...(failedRequests.length ? { failedRequests: failedRequests.slice(0, MAX_DIAGNOSTIC_ENTRIES) } : {}),
  }
}
