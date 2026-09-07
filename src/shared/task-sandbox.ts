export const TASK_SANDBOX_DENY_READ_PATHS = [
  '~/.ssh',
  '~/.gnupg',
  '~/.aws',
  '~/.config/gh',
  '~/.kube',
  '~/.npmrc',
  '~/.netrc',
  '~/.docker',
  '~/.config/gcloud',
]

export const TASK_SANDBOX_DENY_WRITE_PATHS = ['.env', '.env.local', '.env.production']

// Top-level Git metadata that stays read-only inside user-granted directories (mirrors
// Codex's protected workspace metadata, but scoped to the host-escape vectors only):
// .git/config and .git/hooks are executed by the USER's next git invocation outside the
// sandbox (core.fsmonitor, pager, hooks), so a sandboxed write to them would outlive the
// sandbox. Objects/refs/index stay writable so commit/branch/rebase keep working.
// Top-level only — nested repos the agent clones itself are not protected, and neither is
// a `.git` pointer file (worktree/submodule layouts fall back to unprotected).
export const TASK_SANDBOX_PROTECTED_GIT_METADATA_PATHS = ['.git/config', '.git/hooks']

export const TASK_SANDBOX_EXTRA_WRITE_PATHS = ['/tmp']

// Large, rarely-searched directories skipped during file-content search. Shared by the
// sandbox grep path (renderer toolset) and the real-filesystem path (main process) so the
// two stay in sync.
export const SEARCH_EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.cache',
  'coverage',
  'vendor',
  'target',
]
