import type { Session } from '@shared/types'
import { beforeEach, expect, it, vi } from 'vitest'
import BaseStorage from '@/storage/BaseStorage'
import { CurrentSessionRecordStore } from './CurrentSessionRecordStore'

const { values, getStoreValue, setStoreValue } = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  return {
    values,
    getStoreValue: vi.fn((key: string) => Promise.resolve(values.get(key))),
    setStoreValue: vi.fn((key: string, value: unknown) => {
      values.set(key, value)
      return Promise.resolve()
    }),
  }
})

vi.mock('@/platform', () => ({
  default: { getStoreValue, setStoreValue, getAllStoreKeys: () => Promise.resolve([...values.keys()]) },
}))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))

beforeEach(() => {
  values.clear()
  vi.clearAllMocks()
})

it('does not add missing conversations to the stored session catalog during repeated reads', async () => {
  const records = new CurrentSessionRecordStore(new BaseStorage())
  await expect(records.getRecord('missing')).resolves.toBeNull()
  await expect(records.getRecord('missing')).resolves.toBeNull()
  await expect(records.listIds()).resolves.toEqual([])
  expect(setStoreValue).not.toHaveBeenCalled()
})

it('preserves existing null records and real conversation data without writing', async () => {
  const session: Session = { id: 'existing', name: 'Existing', messages: [] }
  values.set('session:empty', null)
  values.set('session:existing', session)
  const records = new CurrentSessionRecordStore(new BaseStorage())
  await expect(records.getRecord('empty')).resolves.toBeNull()
  await expect(records.getRecord('existing')).resolves.toEqual(session)
  expect(values.has('session:empty')).toBe(true)
  expect(setStoreValue).not.toHaveBeenCalled()
})

it('propagates a failed read without replacing data with a null record', async () => {
  const failure = new Error('Storage unavailable')
  getStoreValue.mockRejectedValueOnce(failure)
  const records = new CurrentSessionRecordStore(new BaseStorage())
  await expect(records.getRecord('unavailable')).rejects.toBe(failure)
  expect(setStoreValue).not.toHaveBeenCalled()
})
