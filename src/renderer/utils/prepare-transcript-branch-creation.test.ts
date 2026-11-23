import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  navigation: null as {
    owner: symbol
    sessionId: string
    prepareBranchCreation: () => Promise<boolean>
  } | null,
}))
vi.mock('@/stores/uiStore', () => ({
  uiStore: { getState: () => ({ transcriptNavigation: h.navigation }) },
}))

import { prepareTranscriptBranchCreation } from './prepare-transcript-branch-creation'

describe('prepareTranscriptBranchCreation', () => {
  beforeEach(() => {
    h.navigation = null
  })

  test('requires the requested session to own the visible list', async () => {
    expect(await prepareTranscriptBranchCreation('session')).toBe(false)
    const prepare = vi.fn(async () => true)
    h.navigation = { owner: Symbol(), sessionId: 'another-session', prepareBranchCreation: prepare }
    expect(await prepareTranscriptBranchCreation('session')).toBe(false)
    expect(prepare).not.toHaveBeenCalled()
  })

  test('passes on a successful tail preparation by the current list', async () => {
    h.navigation = { owner: Symbol(), sessionId: 'session', prepareBranchCreation: async () => true }
    expect(await prepareTranscriptBranchCreation('session')).toBe(true)
  })

  test('does not continue when preparation is canceled', async () => {
    h.navigation = { owner: Symbol(), sessionId: 'session', prepareBranchCreation: async () => false }
    expect(await prepareTranscriptBranchCreation('session')).toBe(false)
  })

  test('does not continue if another list takes ownership while the old list is preparing', async () => {
    let finish!: (ready: boolean) => void
    h.navigation = {
      owner: Symbol(),
      sessionId: 'session',
      prepareBranchCreation: () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    }
    const result = prepareTranscriptBranchCreation('session')
    h.navigation = { ...h.navigation, owner: Symbol() }
    finish(true)
    expect(await result).toBe(false)
  })
})
