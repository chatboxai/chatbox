import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import {
  buildCurrentTimeReminderText,
  formatTimestampWithZone,
  insertTimeGapReminders,
  SYSTEM_REMINDER_PROMPT_INSTRUCTION,
  TIME_REMINDER_MIN_GAP_MS,
  wrapInSystemReminder,
} from './system-reminder'

const TIMESTAMP_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/

describe('system-reminder', () => {
  it('wraps text in a system-reminder envelope', () => {
    expect(wrapInSystemReminder('hello')).toBe('<system-reminder>\nhello\n</system-reminder>')
  })

  it('documents the tag in the prompt instruction', () => {
    expect(SYSTEM_REMINDER_PROMPT_INSTRUCTION).toContain('<system-reminder>')
    expect(SYSTEM_REMINDER_PROMPT_INSTRUCTION).toContain('not part of the user')
  })

  it('formats timestamps to the minute with a UTC offset', () => {
    const formatted = formatTimestampWithZone(new Date('2026-08-15T10:30:45Z').getTime())
    expect(formatted).toMatch(TIMESTAMP_SHAPE)
    // Seconds are dropped: two instants within the same minute format identically.
    expect(formatTimestampWithZone(new Date('2026-08-15T10:30:01Z').getTime())).toBe(formatted)
  })

  it('is deterministic for a fixed instant', () => {
    const instant = new Date('2026-01-05T00:00:00Z').getTime()
    expect(formatTimestampWithZone(instant)).toBe(formatTimestampWithZone(instant))
  })

  it('renders with an explicit frozen offset independent of the device zone', () => {
    const instant = new Date('2026-08-15T10:30:00Z').getTime()
    expect(formatTimestampWithZone(instant, 480)).toBe('2026-08-15 18:30 (UTC+08:00)')
    expect(formatTimestampWithZone(instant, -300)).toBe('2026-08-15 05:30 (UTC-05:00)')
    expect(formatTimestampWithZone(instant, 330)).toBe('2026-08-15 16:00 (UTC+05:30)')
    expect(formatTimestampWithZone(instant, 0)).toBe('2026-08-15 10:30 (UTC+00:00)')
  })

  it('builds the current-time reminder body from an explicit instant', () => {
    const instant = new Date('2026-08-15T10:30:00Z').getTime()
    expect(buildCurrentTimeReminderText(instant)).toBe(`Current date and time: ${formatTimestampWithZone(instant)}`)
  })
})

describe('insertTimeGapReminders', () => {
  const GAP = TIME_REMINDER_MIN_GAP_MS
  const T0 = new Date('2026-08-15T08:00:00Z').getTime()

  const user = (id: string, timestamp: number | undefined, extra?: Partial<Message>): Message => ({
    id,
    role: 'user',
    timestamp,
    contentParts: [{ type: 'text', text: `text-${id}` }],
    ...extra,
  })
  const assistant = (id: string, timestamp: number | undefined): Message => ({
    id,
    role: 'assistant',
    timestamp,
    contentParts: [{ type: 'text', text: `reply-${id}` }],
  })
  const reminderIds = (messages: Message[]) => messages.filter((m) => m.id.startsWith('time-gap-reminder-'))

  it('injects a reminder after a user message that follows a long silence, using its own timestamp', () => {
    const lateTs = T0 + GAP + 60_000
    const messages = [user('u1', T0), assistant('a1', T0 + 1_000), user('u2', lateTs)]

    const result = insertTimeGapReminders(messages, { anchorTimestamp: T0, now: lateTs + 5_000 })

    const reminders = reminderIds(result)
    expect(reminders).toHaveLength(1)
    expect(result.indexOf(reminders[0])).toBe(result.findIndex((m) => m.id === 'u2') + 1)
    const text = reminders[0].contentParts[0].type === 'text' ? reminders[0].contentParts[0].text : ''
    // The reminder freezes the message's own timestamp (not the build-time
    // clock) so every rebuild reproduces identical bytes at the same position.
    expect(text).toBe(wrapInSystemReminder(`Current date and time: ${formatTimestampWithZone(lateTs)}`))
  })

  it('is deterministic across rebuilds', () => {
    const messages = [user('u1', T0), assistant('a1', T0 + 1_000), user('u2', T0 + GAP * 2)]
    const first = insertTimeGapReminders(messages, { anchorTimestamp: T0, now: T0 + GAP * 2 })
    const second = insertTimeGapReminders(messages, { anchorTimestamp: T0, now: T0 + GAP * 2 + 60_000 })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('injects nothing during a rapid exchange', () => {
    const messages = [
      user('u1', T0),
      assistant('a1', T0 + 10_000),
      user('u2', T0 + 60_000),
      assistant('a2', T0 + 70_000),
      user('u3', T0 + 120_000),
    ]
    const result = insertTimeGapReminders(messages, { anchorTimestamp: T0, now: T0 + 125_000 })
    expect(result).toEqual(messages)
  })

  it('orients the first in-window user message against the anchor (compacted / long-idle history)', () => {
    const windowStart = T0 + GAP * 10
    const messages = [user('u5', windowStart), assistant('a5', windowStart + 1_000)]
    const result = insertTimeGapReminders(messages, { anchorTimestamp: T0, now: windowStart + 2_000 })
    expect(reminderIds(result)).toHaveLength(1)
    expect(result[1].id).toBe(`time-gap-reminder-${windowStart}`)
  })

  it('does not remind on the first message when no anchor is known', () => {
    const result = insertTimeGapReminders([user('u1', T0)], { now: T0 + 1_000 })
    expect(reminderIds(result)).toHaveLength(0)
  })

  it('ignores system, summary, and untimestamped messages in the clock walk', () => {
    const summaryTs = T0 + GAP * 3
    const messages: Message[] = [
      { id: 'sys', role: 'system', timestamp: summaryTs + GAP, contentParts: [{ type: 'text', text: 'prompt' }] },
      // A compaction summary is created later than the window messages that
      // follow it; it must neither attach a reminder nor walk the clock forward.
      { ...user('summary', summaryTs), isSummary: true },
      user('u1', T0 + GAP + 1_000),
      assistant('a1', undefined),
      user('u2', T0 + GAP + 120_000),
    ]

    const result = insertTimeGapReminders(messages, { anchorTimestamp: T0, now: T0 + GAP + 180_000 })

    const reminders = reminderIds(result)
    // Only u1 crosses the gap (vs the anchor); the summary's newer timestamp
    // did not advance the clock, so u2 stays within u1's window.
    expect(reminders).toHaveLength(1)
    expect(reminders[0].id).toBe(`time-gap-reminder-${T0 + GAP + 1_000}`)
  })

  it('appends a live trailing reminder when the wall clock outran the whole context', () => {
    const messages = [user('u1', T0), assistant('a1', T0 + 5_000)]
    const now = T0 + GAP * 4
    const result = insertTimeGapReminders(messages, { anchorTimestamp: T0, now })
    expect(result.at(-1)?.id).toBe(`time-gap-reminder-${now}`)
    expect(reminderIds(result)).toHaveLength(1)
  })

  it('suppresses the live trailing reminder when a fresh user message already carries the gap', () => {
    const lateTs = T0 + GAP * 2
    const messages = [user('u1', T0), user('u2', lateTs)]
    const result = insertTimeGapReminders(messages, { anchorTimestamp: T0, now: lateTs + 3_000 })
    const reminders = reminderIds(result)
    expect(reminders).toHaveLength(1)
    expect(reminders[0].id).toBe(`time-gap-reminder-${lateTs}`)
  })
})
