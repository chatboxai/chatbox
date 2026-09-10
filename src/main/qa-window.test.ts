import { describe, expect, it } from 'vitest'
import {
  getQaWindowPlacementMode,
  QA_WINDOW_EDGE_PX,
  QA_WINDOW_HEIGHT,
  QA_WINDOW_WIDTH,
  resolveQaWindowBounds,
} from './qa-window'

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } }
const secondary = { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }

describe('getQaWindowPlacementMode', () => {
  it('parks by default and only centers on an explicit value', () => {
    expect(getQaWindowPlacementMode({})).toBe('park')
    expect(getQaWindowPlacementMode({ CHATBOX_QA_WINDOW: 'park' })).toBe('park')
    expect(getQaWindowPlacementMode({ CHATBOX_QA_WINDOW: 'hide' })).toBe('park')
    expect(getQaWindowPlacementMode({ CHATBOX_QA_WINDOW: '1' })).toBe('park')
    expect(getQaWindowPlacementMode({ CHATBOX_QA_WINDOW: 'center' })).toBe('center')
  })
})

describe('resolveQaWindowBounds', () => {
  it('parks a 64px edge on the display that does not have the cursor', () => {
    expect(
      resolveQaWindowBounds({
        displays: [primary, secondary],
        cursor: { x: 100, y: 100 },
        mode: 'park',
      })
    ).toEqual({
      x: secondary.workArea.x + secondary.workArea.width - QA_WINDOW_EDGE_PX,
      y: secondary.workArea.y + secondary.workArea.height - QA_WINDOW_EDGE_PX,
      width: QA_WINDOW_WIDTH,
      height: QA_WINDOW_HEIGHT,
    })
  })

  it('parks on the only display when there is no other screen', () => {
    expect(
      resolveQaWindowBounds({
        displays: [primary],
        cursor: { x: 100, y: 100 },
        mode: 'park',
      })
    ).toEqual({
      x: primary.workArea.x + primary.workArea.width - QA_WINDOW_EDGE_PX,
      y: primary.workArea.y + primary.workArea.height - QA_WINDOW_EDGE_PX,
      width: QA_WINDOW_WIDTH,
      height: QA_WINDOW_HEIGHT,
    })
  })

  it('centers on the other display when observation mode is requested', () => {
    expect(
      resolveQaWindowBounds({
        displays: [primary, secondary],
        cursor: { x: 100, y: 100 },
        mode: 'center',
      })
    ).toEqual({
      x: 1760,
      y: 140,
      width: QA_WINDOW_WIDTH,
      height: QA_WINDOW_HEIGHT,
    })
  })
})
