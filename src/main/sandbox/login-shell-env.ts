import { shellEnv } from '../mcp/shell-env'
import { getLogger } from '../util'

const log = getLogger('sandbox:login-shell-env')

// POSIX-only: Windows GUI processes inherit the user's PATH normally, and the
// vendored shell-env returns process.env as-is on win32 anyway.

// A blocking shell profile (e.g. one sourcing a FIFO-backed env file) must not
// hang the first exec; past this deadline the probe resolves undefined and the
// caller keeps the inherited PATH.
const LOGIN_SHELL_PROBE_TIMEOUT_MS = 5_000

/**
 * Merge the inherited process PATH with the login-shell PATH: inherited entries
 * keep their position and precedence (a terminal launch with an activated
 * conda/direnv/nvm toolchain must keep resolving to the activated versions),
 * and login-shell entries missing from it are appended. A GUI-launched Electron
 * app only gets launchd's minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so
 * the appended entries are what make user-installed command locations such as
 * `/opt/homebrew/bin` or `~/.local/bin` resolvable at all.
 */
export function mergePathEntries(
  inheritedPath: string | undefined,
  loginShellPath: string | undefined
): string | undefined {
  const entries = [...(inheritedPath?.split(':') ?? []), ...(loginShellPath?.split(':') ?? [])].filter(Boolean)
  if (entries.length === 0) return undefined
  return [...new Set(entries)].join(':')
}

let cached: Promise<string | undefined> | undefined
let settledValue: string | undefined

/**
 * Resolve the inherited PATH extended with the user's login-shell PATH. Forking
 * the login shell costs a few hundred ms, so the result is computed once per
 * app run and cached; call sites may fire-and-forget this early (e.g. at
 * sandbox init) to warm the cache. Resolves undefined (probe at most once per
 * app run, even on failure) when the shell fails or exceeds the probe timeout.
 */
export function getLoginShellPath(): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined)
  if (!cached) {
    const probe = shellEnv().then(
      (env) => mergePathEntries(process.env.PATH, env.PATH),
      (err) => {
        log.warn('Failed to resolve login shell env, keeping inherited PATH', err)
        return undefined
      }
    )
    const timeout = new Promise<undefined>((resolve) => {
      const timer = setTimeout(() => {
        log.warn(`Login shell probe exceeded ${LOGIN_SHELL_PROBE_TIMEOUT_MS}ms, keeping inherited PATH`)
        resolve(undefined)
      }, LOGIN_SHELL_PROBE_TIMEOUT_MS)
      timer.unref?.()
      void probe.finally(() => clearTimeout(timer))
    })
    cached = Promise.race([probe, timeout])
    void cached.then((value) => {
      settledValue = value
    })
  }
  return cached
}

/**
 * Non-blocking variant: returns the login-shell PATH if the probe has already
 * settled, undefined otherwise (also kicks off the probe so a later call can
 * succeed). For call sites that must not add pre-spawn latency — e.g. user_exec,
 * where an await before spawn would open a window in which cancellation cannot
 * find the child yet.
 */
export function getLoginShellPathIfReady(): string | undefined {
  void getLoginShellPath()
  return settledValue
}
