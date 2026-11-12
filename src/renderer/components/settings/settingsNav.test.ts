import { describe, expect, test, vi } from 'vitest'

vi.mock('@/platform', () => ({ default: { type: 'web' } }))

import { SETTINGS_SEARCH_ENTRIES } from './settingsNav'

describe('Settings search entries', () => {
  test('finds the message info row by its model name item', () => {
    expect(SETTINGS_SEARCH_ENTRIES).toContainEqual({ page: 'chat', id: 'message-meta', label: 'Model name' })
  })

  test('gives every entry a distinct result key', () => {
    const keys = SETTINGS_SEARCH_ENTRIES.map((entry) => `${entry.page}:${entry.id}:${entry.label}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
