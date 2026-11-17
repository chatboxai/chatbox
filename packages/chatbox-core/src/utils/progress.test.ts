import { describe, expect, it } from 'vitest'
import { createProgressReporter } from './progress'
import type { TaskProgress } from './progress'

describe('progress reporter', () => {
  it('limits byte updates while delivering stage transitions and final counts immediately', () => {
    const events: TaskProgress[] = []
    let time = 0
    const report = createProgressReporter(
      (event) => events.push(event),
      () => time
    )
    for (let bytes = 0; bytes <= 1000; bytes++) {
      time = bytes
      report({ phase: 'validating', current: 0, total: 0, processedBytes: bytes })
    }
    expect(events.map((event) => event.processedBytes)).toEqual([0, 500, 1000])
    report({ phase: 'restoring', current: 0, total: 2 })
    report({ phase: 'restoring', current: 2, total: 2 })
    report({ phase: 'finishing', current: 0, total: 0 })
    expect(events.slice(-3).map((event) => event.phase)).toEqual(['restoring', 'restoring', 'finishing'])
  })
})
