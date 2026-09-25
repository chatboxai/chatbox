import { describe, expect, test } from 'vitest'
import { mergeRestoredSessionFolders } from './session-folders'

describe('mergeRestoredSessionFolders', () => {
  test('keeps local folders and appends imported folders with new ids', () => {
    expect(
      mergeRestoredSessionFolders(
        [
          { id: 'local', name: 'Local' },
          { id: 'shared', name: 'Renamed here' },
        ],
        [
          { id: 'shared', name: 'Shared' },
          { id: 'imported', name: 'Imported' },
        ]
      )
    ).toEqual([
      { id: 'local', name: 'Local' },
      { id: 'shared', name: 'Renamed here' },
      { id: 'imported', name: 'Imported' },
    ])
  })

  test('restores imported folders onto an empty install and drops malformed entries', () => {
    expect(mergeRestoredSessionFolders(undefined, [{ id: 'a', name: 'A' }, { id: 1 }, null, 'x'])).toEqual([
      { id: 'a', name: 'A' },
    ])
    expect(mergeRestoredSessionFolders([{ id: 'a', name: 'A' }], [])).toEqual([{ id: 'a', name: 'A' }])
  })

  test('keeps fields it does not know on local and imported folders', () => {
    expect(
      mergeRestoredSessionFolders([{ id: 'a', name: 'A', source: 'local' }], [{ id: 'b', name: 'B', source: 'x' }])
    ).toEqual([
      { id: 'a', name: 'A', source: 'local' },
      { id: 'b', name: 'B', source: 'x' },
    ])
  })
})
