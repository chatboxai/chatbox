import { extractCommandBaseName, tokenizeShellWords } from './user-exec-command-utils'

/**
 * Whitelist rules for auto-approving safe user_exec commands.
 *
 * A command is auto-approved only when EVERY sub-command in the pipeline
 * (or compound expression) is read-only and matches the whitelist.
 *
 * Safety invariants:
 * - No output redirection (>, >>) except safe discards (>/dev/null, 2>&1)
 * - No command substitution ($(...) or backticks)
 * - No process substitution (<(...))
 * - Compound commands (|, &&, ||) require ALL parts to be safe
 * - Subcommand-aware matching for tools like git, docker, npm, etc.
 */

// ── Simple read-only commands (no subcommand check needed) ──────────

const SAFE_COMMANDS = new Set([
  // filesystem info (read-only)
  'ls',
  'pwd',
  'tree',
  'file',
  'stat',
  'du',
  'df',
  'find',
  'locate',
  'realpath',
  'dirname',
  'basename',
  'readlink',

  // text / stream processing
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'sort',
  'uniq',
  'cut',
  'tr',
  'column',
  'fmt',
  'fold',
  'nl',
  'rev',
  'tac',
  'paste',
  'join',
  'comm',
  'expand',
  'unexpand',

  // search
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'ack',

  // structured text processing
  'jq',
  'yq',
  'xq',

  // diff & compare
  'diff',
  'cmp',
  'md5sum',
  'md5',
  'sha256sum',
  'shasum',
  'b2sum',
  'cksum',

  // system info
  'date',
  'cal',
  'whoami',
  'id',
  'groups',
  'hostname',
  'uname',
  'uptime',
  'arch',
  'nproc',
  'lsb_release',
  'sw_vers',
  'sysctl',
  'vm_stat',

  // process info (read-only)
  'ps',
  'top',
  'htop',
  'pgrep',
  'lsof',

  // version / help
  'which',
  'where',
  'type',
  'whence',
  'man',
  'help',
  'info',

  // misc
  'echo',
  'printf',
  'true',
  'false',
  'test',
  '[',
  'expr',
  'seq',
  'yes',
  'printenv',
])

// ── Subcommand-aware rules ──────────────────────────────────────────

/** For commands that need subcommand-level matching: base → set of safe subcommands */
const SAFE_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set([
    'status',
    'log',
    'diff',
    'show',
    'shortlog',
    'describe',
    'rev-parse',
    'rev-list',
    'ls-files',
    'ls-tree',
    'ls-remote',
    'name-rev',
    'blame',
    'reflog',
    'cat-file',
    'count-objects',
    'for-each-ref',
  ]),
  docker: new Set(['ps', 'images', 'inspect', 'logs', 'version', 'info', 'stats', 'top', 'port', 'diff']),
  npm: new Set(['list', 'ls', 'view', 'info', 'show', 'outdated', 'audit', 'explain', 'why']),
  pnpm: new Set(['list', 'ls', 'view', 'info', 'show', 'outdated', 'audit', 'explain', 'why']),
  yarn: new Set(['list', 'info', 'why', 'outdated']),
  cargo: new Set(['tree', 'metadata', 'version', 'search', 'info']),
  go: new Set(['version', 'list', 'doc']),
  rustc: new Set(['--version', '-V', '--print']),
  java: new Set(['--version', '-version']),
  swift: new Set(['--version']),
  kubectl: new Set(['get', 'describe', 'logs', 'top', 'version', 'explain', 'api-resources', 'api-versions']),
  brew: new Set(['list', 'ls', 'info', 'search', 'outdated', 'config', 'doctor', 'deps']),
  apt: new Set(['list', 'show', 'search', 'depends', 'rdepends', 'policy']),
  pip: new Set(['list', 'show', 'freeze', 'check']),
  pip3: new Set(['list', 'show', 'freeze', 'check']),
  systemctl: new Set(['status', 'list-units', 'list-unit-files', 'is-active', 'is-enabled', 'show']),
  launchctl: new Set(['list', 'print']),
}

// ── Dangerous flags that make otherwise-safe commands unsafe ────────

const DANGEROUS_FLAGS: Record<string, string[]> = {
  sed: ['-i', '--in-place'],
  find: ['-delete', '-exec', '-execdir', '-ok', '-okdir'],
  git: ['--output'],
  xargs: [], // xargs itself can execute anything — always block
}

/** Any command with only one of these flags is safe (e.g. `rustup --version`) */
const VERSION_HELP_FLAGS = new Set(['--version', '-v', '-V', '--help', '-h'])

// ── Shell metacharacter detection ───────────────────────────────────

const UNSAFE_PATTERNS = [
  /[\r\n]/,
  /`/,
  /\$\(/,
  /<\(/,
  />\(/,
  /\bsudo\b/,
  /\bsu\b/,
  /\beval\b/,
  /\bsource\b/,
  /\bdbus-send\b/,
  /\bosascript\b/,
]

/**
 * Safe redirect patterns stripped before checking for unsafe `>`.
 * Matches: 2>/dev/null, 2>>/dev/null, >/dev/null, &>/dev/null, 2>&1, 1>&2
 */
const SAFE_REDIRECT_PATTERN = /&?>>?\s*\/dev\/null|\d*>>?\s*\/dev\/null|\d+>&\d+/g

// ── Core logic ──────────────────────────────────────────────────────

/**
 * Check if a full shell command string is safe to auto-approve.
 */
export function isCommandAutoApprovable(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false

  // Quick reject: unsafe shell metacharacters
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(trimmed)) return false
  }

  // Check for unsafe redirections: strip safe ones (2>/dev/null, >/dev/null, 2>&1),
  // then reject if any `>` remains (meaning it writes to a real file).
  const withoutSafeRedirects = trimmed.replace(SAFE_REDIRECT_PATTERN, '')
  if (/>/.test(withoutSafeRedirects)) return false

  // Split on compound operators: |, &&, ||, ;
  // Each segment must independently be safe.
  const segments = splitCompoundCommand(trimmed)
  return segments.every(isSegmentSafe)
}

/**
 * Split a command by shell compound operators (|, &&, ||, ;).
 * This is a simplified parser — it doesn't handle quoted strings perfectly,
 * but errs on the side of caution (failing to split means the whole command
 * is checked as one segment, which is stricter).
 */
function splitCompoundCommand(cmd: string): string[] {
  const segments: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let i = 0

  while (i < cmd.length) {
    const ch = cmd[i]

    // Track quoting
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      i++
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
      i++
      continue
    }

    // Only split outside quotes
    if (!inSingle && !inDouble) {
      if (ch === '|' && cmd[i + 1] === '|') {
        segments.push(current)
        current = ''
        i += 2
        continue
      }
      if (ch === '&' && cmd[i + 1] === '&') {
        segments.push(current)
        current = ''
        i += 2
        continue
      }
      if (ch === '|' || ch === ';') {
        segments.push(current)
        current = ''
        i++
        continue
      }
    }

    current += ch
    i++
  }

  if (current.trim()) segments.push(current)
  return segments.map((s) => s.trim()).filter(Boolean)
}

/**
 * Check if a single command segment (no pipes/compounds) is safe.
 */
function isSegmentSafe(segment: string): boolean {
  // Tokenize respecting quotes
  const tokens = tokenizeShellWords(segment)
  if (!tokens || tokens.length === 0) return false

  const baseCmd = extractCommandBaseName(tokens[0])
  const args = tokens.slice(1)

  if (baseCmd === 'env') {
    return args.length === 0 || (args.length === 1 && VERSION_HELP_FLAGS.has(args[0]))
  }

  if (baseCmd === 'command') {
    return (
      args.length >= 2 && (args[0] === '-v' || args[0] === '-V') && args.slice(1).every((arg) => !arg.startsWith('-'))
    )
  }

  if (baseCmd === 'git') return isSafeGitCommand(args)
  if (baseCmd === 'npm' || baseCmd === 'pnpm' || baseCmd === 'yarn') {
    return isSafePackageManagerCommand(baseCmd, args)
  }
  if (baseCmd === 'pip' || baseCmd === 'pip3') return isSafePipCommand(args)
  if (baseCmd === 'docker') return isSafeDockerCommand(args)
  if (baseCmd === 'kubectl') return isSafeKubectlCommand(args)
  if (baseCmd === 'go' && args[0] === 'env')
    return !args.slice(1).some((arg) => arg.startsWith('-w') || arg.startsWith('-u'))

  // Simple safe command (no subcommand check)
  if (SAFE_COMMANDS.has(baseCmd)) {
    return !hasDangerousFlags(baseCmd, args)
  }

  // Subcommand-aware check
  const safeSubs = SAFE_SUBCOMMANDS[baseCmd]
  if (safeSubs && args.length > 0) {
    const subCmd = args[0]
    if (safeSubs.has(subCmd)) {
      return !hasDangerousFlags(baseCmd, args)
    }
  }

  if (args.length === 1 && VERSION_HELP_FLAGS.has(args[0])) {
    return true
  }

  return false
}

function isSafeGitCommand(args: string[]): boolean {
  const subCommand = args[0]
  const subArgs = args.slice(1)
  if (!subCommand) return false

  const unconditionallyReadOnly = SAFE_SUBCOMMANDS.git
  if (unconditionallyReadOnly.has(subCommand)) return !hasDangerousFlags('git', subArgs)

  switch (subCommand) {
    case 'branch': {
      const mutatingFlags = new Set([
        '-d',
        '-D',
        '-m',
        '-M',
        '-c',
        '-C',
        '--delete',
        '--move',
        '--copy',
        '--edit-description',
        '--unset-upstream',
      ])
      if (subArgs.some((arg) => mutatingFlags.has(arg) || arg.startsWith('--set-upstream-to'))) return false
      return (
        subArgs.length === 0 ||
        subArgs.every((arg) => arg.startsWith('-')) ||
        subArgs.includes('--list') ||
        subArgs.includes('-l')
      )
    }
    case 'tag':
      return (
        !subArgs.some((arg) => arg === '--delete' || arg === '-d' || arg === '--force' || arg === '-f') &&
        (subArgs.length === 0 || subArgs[0] === '--list' || subArgs[0] === '-l')
      )
    case 'remote':
      return (
        subArgs.length === 0 ||
        subArgs.every((arg) => arg === '-v' || arg === '--verbose') ||
        subArgs[0] === 'show' ||
        subArgs[0] === 'get-url'
      )
    case 'stash':
      return subArgs[0] === 'list' || subArgs[0] === 'show'
    case 'config': {
      const readFlags = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin', '--show-scope'])
      return (
        subArgs.some((arg) => readFlags.has(arg)) && !subArgs.some((arg) => arg === '--unset' || arg === '--unset-all')
      )
    }
    case 'worktree':
      return subArgs[0] === 'list'
    default:
      return false
  }
}

function isSafePackageManagerCommand(packageManager: 'npm' | 'pnpm' | 'yarn', args: string[]): boolean {
  const [subCommand, configAction] = args
  if (!subCommand) return false
  if (subCommand === 'config') return configAction === 'get' || configAction === 'list' || configAction === 'ls'
  if (subCommand === 'audit' && args.slice(1).some((arg) => arg === '--fix' || arg.startsWith('--fix='))) return false
  return SAFE_SUBCOMMANDS[packageManager].has(subCommand)
}

function isSafePipCommand(args: string[]): boolean {
  const [subCommand, configAction] = args
  if (!subCommand) return false
  if (subCommand === 'config') return configAction === 'get' || configAction === 'list' || configAction === 'debug'
  return SAFE_SUBCOMMANDS.pip.has(subCommand)
}

function isSafeDockerCommand(args: string[]): boolean {
  const [subCommand, imageAction] = args
  if (!subCommand) return false
  if (subCommand === 'image') {
    return imageAction === 'ls' || imageAction === 'list' || imageAction === 'inspect' || imageAction === 'history'
  }
  return SAFE_SUBCOMMANDS.docker.has(subCommand)
}

function isSafeKubectlCommand(args: string[]): boolean {
  const [subCommand, configAction] = args
  if (!subCommand) return false
  if (subCommand === 'config') {
    return configAction === 'view' || configAction === 'get-contexts' || configAction === 'current-context'
  }
  return SAFE_SUBCOMMANDS.kubectl.has(subCommand)
}

function hasDangerousFlags(baseCmd: string, args: string[]): boolean {
  const dangerous = DANGEROUS_FLAGS[baseCmd]
  if (!dangerous) return false
  if (dangerous.length === 0) return true // command itself is dangerous (like xargs)
  return args.some((arg) =>
    dangerous.some((flag) => arg === flag || arg.startsWith(`${flag}=`) || (flag === '-i' && arg.startsWith('-i')))
  )
}
