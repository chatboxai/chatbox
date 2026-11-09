export type SessionStartupDiagnostic = {
  occurredAt: string
  phase: 'read' | 'render'
  errorName: string
  message: string
  stack: string
  /** Frame locations as the runtime reported them, so Sentry can attach debug IDs before its privacy filter runs. */
  reportStack: string
  reportId?: string
}

// Only application-owned messages may be included verbatim in a shareable report.
const SAFE_MESSAGES = new Set([
  'Active thread projection is unavailable',
  'Session row format is unavailable',
  'Unsupported row publication version',
  'Unsupported row format version',
  'Published session rows are missing',
  'Unpublished rows have no original input',
  'Record identity does not match',
  'Invalid row revision',
  'database is locked',
  'database disk image is malformed',
  'database or disk is full',
  'Failed to open database',
  'Failed to fetch',
])

export function createStartupDiagnostic(
  error: unknown,
  phase: SessionStartupDiagnostic['phase']
): SessionStartupDiagnostic {
  let errorName = 'Error'
  let message = 'Error details omitted to protect private data'
  let stack = ''
  let reportStack = ''
  try {
    const seen = new Set<Error>()
    for (let depth = 0; depth < 5 && error instanceof Error; depth++) {
      seen.add(error)
      if (!(error.cause instanceof Error) || seen.has(error.cause)) break
      error = error.cause
    }
    if (error instanceof Error) {
      if (/^[A-Za-z][A-Za-z0-9]*Error$/.test(error.name) || error.name === 'Error') errorName = error.name.slice(0, 64)
      if (SAFE_MESSAGES.has(error.message)) message = error.message
      const frames = stackFrames(error)
      // Keep code locations, never the exception header, local paths, URL parameters or arbitrary thrown values.
      stack = frames.map((frame) => `at ${frame.file}:${frame.line}:${frame.column}`).join('\n')
      reportStack = frames.map((frame) => `    at ${frame.location}:${frame.line}:${frame.column}`).join('\n')
    }
  } catch {
    // Diagnostics must also work for exceptions with throwing getters.
  }
  return { occurredAt: new Date().toISOString(), phase, errorName, message, stack, reportStack }
}

const FRAME_PATTERN =
  /(?:^|[\s(@])([^\s(@]*[/\\]([A-Za-z0-9_.-]+\.(?:js|mjs|cjs|ts|tsx))(?:[?#][^\s:]*)?):(\d+):(\d+)\)?\s*$/

function stackFrames(error: Error) {
  let text = error.stack ?? ''
  // V8 starts the stack with a `Name: message` header that can span lines; JavaScriptCore and SpiderMonkey omit it.
  const headerEnd = error.message ? text.indexOf(error.message) : -1
  if (headerEnd > 0 && headerEnd <= 128 && /^[^\n]*: $/.test(text.slice(0, headerEnd))) {
    text = text.slice(headerEnd + error.message.length)
  }
  return text
    .split('\n')
    .flatMap((line) => {
      const match = line.match(FRAME_PATTERN)
      if (!match) return []
      return [{ location: match[1].replace(/[?#].*$/, ''), file: match[2], line: match[3], column: match[4] }]
    })
    .slice(0, 20)
}

export function diagnosticSignature(diagnostic: SessionStartupDiagnostic): string {
  return `${diagnostic.phase}\n${diagnostic.errorName}\n${diagnostic.message}\n${diagnostic.stack}`
}

export function formatStartupDiagnostic(
  diagnostic: SessionStartupDiagnostic | undefined,
  environment: { version: string; platform: string }
): string {
  return [
    'Chatbox session loading diagnostics',
    `Version: ${environment.version}`,
    `Platform: ${environment.platform}`,
    ...(diagnostic
      ? [
          `Time: ${diagnostic.occurredAt}`,
          `Stage: ${diagnostic.phase}`,
          `${diagnostic.errorName}: ${diagnostic.message}`,
          diagnostic.stack,
          ...(diagnostic.reportId ? [`Sentry event ID: ${diagnostic.reportId}`] : []),
        ]
      : ['The previous load was interrupted. No error details were recorded.']),
  ]
    .filter(Boolean)
    .join('\n')
}
