// @vitest-environment jsdom

import { type BuiltInBrowserTabs, EMPTY_BUILT_IN_BROWSER_STATE } from '@shared/built-in-browser'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SESSION_PANEL, uiStore } from '@/stores/uiStore'
import { useBrowserTabPanelSync } from './SessionSidePanel'

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
