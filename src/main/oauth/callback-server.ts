import http from 'node:http'
import log from 'electron-log/main'

export interface CallbackResult {
  code: string
  state?: string
  /** RFC 9207 issuer identifier; the MCP SDK rejects the callback without it when the server advertises support */
  iss?: string
}

const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

const ACCEPTED_PATHS = ['/callback', '/auth/callback', '/oauth2callback']

/**
 * Creates a local HTTP server to receive OAuth callbacks.
 * The server listens on the specified port and waits for a single callback.
 * Automatically times out after 5 minutes.
 */
export function createCallbackServer(
  port: number,
  signal?: AbortSignal,
  host = '127.0.0.1'
): { promise: Promise<CallbackResult>; close: () => void } {
  let server: http.Server | null = null
  let resolved = false
  let resolvePromise: (value: CallbackResult) => void
  let rejectPromise: (reason: Error) => void
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const close = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (server) {
      server.close()
      server = null
    }
  }

  const promise = new Promise<CallbackResult>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject

    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${host}:${port}`)

      if (ACCEPTED_PATHS.includes(url.pathname)) {
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const iss = url.searchParams.get('iss')
        const error = url.searchParams.get('error')
        const errorDescription = url.searchParams.get('error_description')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Authorization failed</h1><p>You can close this window.</p></body></html>')
          if (!resolved) {
            resolved = true
            reject(new Error(`OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ''}`))
          }
        } else if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body><h1>Authorization successful!</h1><p>You can close this window and return to Chatbox.</p></body></html>'
          )
          if (!resolved) {
            resolved = true
            resolve({ code, state: state || undefined, iss: iss || undefined })
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Missing authorization code</h1></body></html>')
          if (!resolved) {
            resolved = true
            reject(new Error('Missing authorization code in callback'))
          }
        }

        // Close server after handling callback
        setTimeout(() => close(), 100)
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    server.listen(port, host, () => {
      log.info(`[OAuth] Callback server listening on http://${host}:${port}`)
    })

    server.on('error', (err) => {
      log.error('[OAuth] Callback server error:', err)
      if (!resolved) {
        resolved = true
        reject(err)
      }
    })

    // Timeout
    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error('OAuth login timed out'))
        close()
      }
    }, OAUTH_CALLBACK_TIMEOUT_MS)
  })

  if (signal) {
    if (signal.aborted) {
      close()
      // Return already-rejected promise
      return {
        promise: Promise.reject(new Error('OAuth login aborted')),
        close,
      }
    }
    signal.addEventListener(
      'abort',
      () => {
        if (!resolved) {
          resolved = true
          rejectPromise(new Error('OAuth login aborted'))
        }
        close()
      },
      { once: true }
    )
  }

  return { promise, close }
}
