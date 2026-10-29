// @vitest-environment jsdom

import type { SessionHeader } from '@shared/types'
import { type BuiltInBrowserTabs, EMPTY_BUILT_IN_BROWSER_STATE } from '@shared/built-in-browser'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rendererApplication } from '@/app/renderer-application'
import { DEFAULT_SESSION_PANEL, uiStore } from '@/stores/uiStore'
import { useBrowserTabPanelSync, usePersistedSessionEdit } from './SessionSidePanel'

const panel = () => uiStore.getState().sessionPanels.s1 ?? DEFAULT_SESSION_PANEL

function tabs(entries: Array<[string, boolean]>): BuiltInBrowserTabs {
  return {
    sessionId: 's1',
    tabs: entries.map(([id, reading]) => ({
      ...EMPTY_BUILT_IN_BROWSER_STATE,
      id,
      url: `https://${id}.example/`,
      reading,
    })),
  }
}

describe('browser tabs in the conversation panel', () => {
  beforeEach(() => {
    uiStore.setState({ sessionPanels: {} })
  })

  it('opens the panel on a tab that starts reading, and keeps it closed while another tab is still reading', () => {
    const { rerender } = renderHook(({ state }) => useBrowserTabPanelSync('s1', state), {
      initialProps: { state: tabs([['t1', true]]) },
    })
    expect(panel()).toMatchObject({ open: true, tab: 'web', webTab: 't1' })

    rerender({
      state: tabs([
        ['t1', true],
        ['t2', true],
      ]),
    })
    expect(panel()).toMatchObject({ webTab: 't1', unseenWebTabs: ['t2'] })

    uiStore.getState().closeSessionPanel('s1')
    rerender({
      state: tabs([
        ['t1', false],
        ['t2', true],
      ]),
    })
    expect(panel().open).toBe(false)

    rerender({
      state: tabs([
        ['t1', true],
        ['t2', true],
      ]),
    })
    expect(panel()).toMatchObject({ open: true, webTab: 't1' })
  })

  it('moves to the neighbouring tab when the shown tab closes and treats it as seen', () => {
    const { rerender } = renderHook(({ state }) => useBrowserTabPanelSync('s1', state), {
      initialProps: {
        state: tabs([
          ['t1', true],
          ['t2', false],
        ]),
      },
    })
    rerender({
      state: tabs([
        ['t1', false],
        ['t2', true],
      ]),
    })
    expect(panel()).toMatchObject({ webTab: 't1', unseenWebTabs: ['t2'] })

    rerender({ state: tabs([['t2', false]]) })
    expect(panel()).toMatchObject({ tab: 'web', webTab: 't2', unseenWebTabs: [] })

    rerender({ state: tabs([]) })
    expect(panel()).toMatchObject({ tab: 'settings', webTab: undefined })
  })
})

describe('conversation settings edits', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const session: SessionHeader = {
    id: 's1',
    name: 'Pricing',
    type: 'chat',
    settings: { temperature: 0.3, topP: 0.9 },
  }

  it('commits header fields and system prompts through their row commands', async () => {
    const updateHeader = vi.spyOn(rendererApplication.sessions, 'updateSessionHeader').mockResolvedValue(session)
    const setPrompt = vi.spyOn(rendererApplication.sessions, 'setSessionSystemPrompt').mockResolvedValue(session)
    const { result } = renderHook(() => usePersistedSessionEdit(session))

    await result.current({ settings: { temperature: undefined, stream: false }, name: ' Plans ' })
    expect(setPrompt).not.toHaveBeenCalled()
    const headerUpdater = updateHeader.mock.calls[0][1] as (header: SessionHeader) => SessionHeader
    expect(headerUpdater(session)).toEqual({ ...session, name: 'Plans', settings: { topP: 0.9, stream: false } })

    await result.current({ systemPrompt: ' Answer in French. ' })
    expect(updateHeader).toHaveBeenCalledTimes(1)
    expect(setPrompt).toHaveBeenCalledWith('s1', 'Answer in French.')

    await result.current({ name: 'French', systemPrompt: 'Translate.' })
    expect(updateHeader).toHaveBeenCalledTimes(2)
    expect(setPrompt).toHaveBeenLastCalledWith('s1', 'Translate.')
  })

  it('propagates a failed header save to the settings controls', async () => {
    vi.spyOn(rendererApplication.sessions, 'updateSessionHeader').mockRejectedValue(new Error('Disk full'))
    const { result } = renderHook(() => usePersistedSessionEdit(session))
    await expect(result.current({ settings: { stream: false } })).rejects.toThrow('Disk full')
  })
})
