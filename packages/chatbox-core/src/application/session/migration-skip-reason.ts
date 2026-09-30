/** Stable category of a reason `RowBackedSessionRepository` reports when a session stays in V1 form. */
export type SessionMigrationSkipCategory =
  | 'publish-failed'
  | 'released-client-content'
  | 'orphaned-rows'
  | 'duplicate-message-id'
  | 'summary-pivot'
  | 'fork-position'
  | 'active-branch-messages'
  | 'unreachable-fork'
  | 'thread-id-collision'
  | 'thread-name'
  | 'round-trip-mismatch'
  | 'tree-invariant'

const TOPOLOGY_PATTERNS: ReadonlyArray<[RegExp, SessionMigrationSkipCategory]> = [
  [/^duplicate message id /, 'duplicate-message-id'],
  [/^fork pivot .+ is a summary message$/, 'summary-pivot'],
  [/^fork .+ has out-of-range position /, 'fork-position'],
  [/^fork .+ stores messages in its active branch$/, 'active-branch-messages'],
  [/^unreachable fork /, 'unreachable-fork'],
  [/collides with the active thread id$|^duplicate thread row /, 'thread-id-collision'],
  [/^archived thread \S+ has no name$/, 'thread-name'],
  // The phrasings `verifySessionTreeRoundTrip` uses when a decoded tree differs from its source.
  [
    / messages, expected \d+$| message #\d+ is .+, expected |^session field .+ differs$|^fork pivots are /,
    'round-trip-mismatch',
  ],
  [/^fork \S+ (has position .+|was created at .+|has \d+ branches), expected /, 'round-trip-mismatch'],
  [/^session holds \d+ archived threads, expected |^archived thread #\d+ is .+, expected /, 'round-trip-mismatch'],
  [
    /^archived thread \S+ (is named .+, expected .+|was created at .+, expected .+|compaction points differ|prompt context snapshot differs)$/,
    'round-trip-mismatch',
  ],
  [/ message \S+ differs$|^active thread (name|compaction points) differs?$/, 'round-trip-mismatch'],
]

// A noun naming a message, fork or thread is followed by its id, unless another word of the phrase follows.
const ID_AFTER_NOUN =
  /(?<![\w-])(message|fork|thread|pivot|row|summary|boundary|leaf|root|parent|child|point) (?!#)(?!(?:is|has|was|sits|belongs|references|points|names|compacts|contains|stores|holds|differs|differ|row|pivot|point|message|messages|thread|seq|claimed)\b)[^\s,]+/g

/** Removes ids so reasons with the same cause group together. */
export function describeSessionMigrationSkip(reason: string): string {
  return reason
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(~\w+)?/gi, '<id>')
    .replace(ID_AFTER_NOUN, '$1 <id>')
    .slice(0, 200)
}

export function classifySessionMigrationSkip(reason: string): SessionMigrationSkipCategory {
  if (reason.startsWith('row-backed publish failed')) return 'publish-failed'
  if (reason.startsWith('content written by an earlier version was kept')) return 'released-client-content'
  if (reason.startsWith('rows without a record were kept')) return 'orphaned-rows'
  for (const [pattern, category] of TOPOLOGY_PATTERNS) {
    if (pattern.test(reason)) return category
  }
  return 'tree-invariant'
}
