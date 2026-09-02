import { describe, expect, it } from 'vitest'
import { areSessionsInSamePinGroup, uniqueSessionRecords } from './session-sort'

describe('areSessionsInSamePinGroup', () => {
  it('treats false and undefined as the same unpinned group', () => {
    expect(areSessionsInSamePinGroup({ starred: false }, {})).toBe(true)
  })

  it('keeps pinned and unpinned sessions in different groups', () => {
    expect(areSessionsInSamePinGroup({ starred: true }, { starred: false })).toBe(false)
    expect(areSessionsInSamePinGroup({ starred: true }, {})).toBe(false)
  })

  it('returns false when either session is missing', () => {
    expect(areSessionsInSamePinGroup(undefined, {})).toBe(false)
    expect(areSessionsInSamePinGroup({}, undefined)).toBe(false)
  })
})

describe('uniqueSessionRecords', () => {
  it('keeps the first occurrence of each id', () => {
    expect(uniqueSessionRecords([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'b' }])).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ])
  })
})
