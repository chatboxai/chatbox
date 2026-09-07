import type { Message } from '../types'

/**
 * `<system-reminder>` blocks: out-of-band runtime metadata injected into the
 * conversation at request-construction time (mirroring Claude Code's pattern).
 * They are never persisted — the UI, session storage, and future context
 * rebuilds don't contain them — so volatile facts such as the current time can
 * ride the request without rewriting the cached prompt prefix.
 */

const SYSTEM_REMINDER_TAG = 'system-reminder'

export function wrapInSystemReminder(text: string): string {
  return `<${SYSTEM_REMINDER_TAG}>\n${text}\n</${SYSTEM_REMINDER_TAG}>`
}

/**
 * Semantics contract for `<system-reminder>` blocks, carried in the system
 * prompt so models treat them as runtime metadata instead of user input.
 */
export const SYSTEM_REMINDER_PROMPT_INSTRUCTION =
  `<${SYSTEM_REMINDER_TAG}>...</${SYSTEM_REMINDER_TAG}> blocks are out-of-band runtime metadata from Chatbox ` +
  `(e.g. the current date and time), not part of the user's message. ` +
  `Treat their contents as authoritative; do not quote or acknowledge them.`

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * `2026-08-15 23:42 (UTC+08:00)` — minute precision plus a UTC offset. With no
 * explicit offset the device's offset at that instant is used (DST-aware). Pass
 * a frozen `utcOffsetMinutes` (e.g. the snapshot's capture-time offset) to keep
 * the output byte-stable even after the device moves to another timezone. Kept
 * dependency-free: this module is consumed from shared/native code where dayjs
 * is not available.
 */
export function formatTimestampWithZone(timestamp: number, utcOffsetMinutes?: number): string {
  const offsetMinutes = utcOffsetMinutes ?? -new Date(timestamp).getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offset = `${sign}${pad2(Math.floor(absOffset / 60))}:${pad2(absOffset % 60)}`
  // Read the wall clock by shifting the instant and using UTC getters, so the
  // rendered time always matches the offset in the suffix.
  const shifted = new Date(timestamp + offsetMinutes * 60_000)
  const day = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
  return `${day} ${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())} (UTC${offset})`
}

/** Reminder body for a time `<system-reminder>` (always the device's live timezone). */
export function buildCurrentTimeReminderText(now: number = Date.now()): string {
  return `Current date and time: ${formatTimestampWithZone(now)}`
}

/**
 * Minimum silence between messages before a time reminder is worth injecting.
 * Below this the model's sense of time (conversation start + the last gap
 * reminder) is close enough; reminding on every message would be noise.
 */
export const TIME_REMINDER_MIN_GAP_MS = 30 * 60 * 1000

export interface InsertTimeGapRemindersOptions {
  /**
   * Conversation start (snapshot capture time, else the first surface message).
   * Serves as the baseline the first walked message is compared against — a
   * compacted-away or long-idle history then still yields one orienting
   * reminder at the first post-gap user turn.
   */
  anchorTimestamp?: number
  now?: number
  minGapMs?: number
}

function isTimestamped(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function timeReminderMessage(timestamp: number): Message {
  return {
    id: `time-gap-reminder-${timestamp}`,
    role: 'user',
    timestamp,
    contentParts: [{ type: 'text', text: wrapInSystemReminder(buildCurrentTimeReminderText(timestamp)) }],
  }
}

/**
 * Inject time `<system-reminder>`s at conversation gaps instead of on every
 * request. After each user message that follows ≥ `minGapMs` of silence, a
 * reminder carrying that message's own timestamp is inserted (`sequenceMessages`
 * merges it into the turn's tail). Because it is derived purely from persisted
 * message timestamps, every rebuild reproduces the same bytes at the same
 * position — the reminder becomes part of the stable cached prefix while still
 * never being persisted itself.
 *
 * A trailing live reminder (`now`, non-deterministic by nature) is appended only
 * when the wall clock has moved ≥ `minGapMs` past everything in the context —
 * the regenerate-later / resume-stale-run cases where no new user message
 * exists to carry the gap. Rapid exchanges produce no reminders at all.
 */
export function insertTimeGapReminders(messages: Message[], options?: InsertTimeGapRemindersOptions): Message[] {
  const minGapMs = options?.minGapMs ?? TIME_REMINDER_MIN_GAP_MS
  const now = options?.now ?? Date.now()
  const anchor = options?.anchorTimestamp
  let lastSeenTs = isTimestamped(anchor) ? anchor : undefined

  const result: Message[] = []
  for (const message of messages) {
    result.push(message)
    // Injected system prompts carry construction-time timestamps; summaries and
    // fork markers are synthetic. None of them advance the conversation clock.
    if (message.role === 'system' || message.isSummary || message.isForkMarker) continue
    const ts = message.timestamp
    if (!isTimestamped(ts)) continue
    if (message.role === 'user' && lastSeenTs !== undefined && ts - lastSeenTs >= minGapMs) {
      result.push(timeReminderMessage(ts))
    }
    // Monotonic: a compaction summary or out-of-order timestamp never walks the
    // clock backwards (which could double-fire reminders on ordinary gaps).
    if (lastSeenTs === undefined || ts > lastSeenTs) lastSeenTs = ts
  }

  if (lastSeenTs !== undefined && now - lastSeenTs >= minGapMs) {
    result.push(timeReminderMessage(now))
  }

  return result
}
