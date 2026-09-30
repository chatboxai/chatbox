import { expect, it } from 'vitest'
import type { BackupWarning } from './types'
import { BackupWarningBudgetError, BackupWarningIndex } from './warning-index'

function warning(message: string): BackupWarning {
  return { code: 'external-resource-skipped', itemType: 'resource', message }
}

it('retains the first occurrence and order without spending budget on duplicate identities', () => {
  const first = warning('first')
  const second = warning('second')
  const bytes = new TextEncoder().encode(JSON.stringify([first, second])).length
  const index = new BackupWarningIndex(bytes, 2)
  index.add(first)
  for (let i = 0; i < 10_000; i++) index.add({ ...first })
  index.add(second)
  expect(index.toArray()).toEqual([first, second])
  expect(index.toArray()[0]).toBe(first)
  expect(() => index.add(warning('third'))).toThrow(BackupWarningBudgetError)
  expect(index.toArray()).toEqual([first, second])
})

it('accounts for UTF-8, escaped JSON, commas and brackets before retaining a warning', () => {
  const values = [warning('中🙂\\"\n'), warning('second')]
  const bytes = new TextEncoder().encode(JSON.stringify(values)).length
  const exact = new BackupWarningIndex(bytes)
  exact.addAll(values)
  expect(exact.toArray()).toEqual(values)
  const short = new BackupWarningIndex(bytes - 1)
  short.add(values[0])
  expect(() => short.add(values[1])).toThrow(BackupWarningBudgetError)
  expect(short.toArray()).toEqual([values[0]])
})

it('enforces the count limit independently of the byte limit', () => {
  const index = new BackupWarningIndex(4096, 1)
  index.add(warning('a'))
  expect(() => index.add(warning('b'))).toThrow(BackupWarningBudgetError)
  expect(index.size).toBe(1)
})
