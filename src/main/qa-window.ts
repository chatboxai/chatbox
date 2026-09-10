export const QA_WINDOW_WIDTH = 1280
export const QA_WINDOW_HEIGHT = 800
export const QA_WINDOW_EDGE_PX = 64

export type QaWindowPlacementMode = 'park' | 'center'

export type QaDisplayWorkArea = {
  id: number
  workArea: { x: number; y: number; width: number; height: number }
}

export type QaWindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

export function getQaWindowPlacementMode(env: { CHATBOX_QA_WINDOW?: string } = {}): QaWindowPlacementMode {
  const raw = (env.CHATBOX_QA_WINDOW || 'park').trim().toLowerCase()
  return raw === 'center' ? 'center' : 'park'
}

function pointInRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

function displayForCursor(displays: QaDisplayWorkArea[], cursor: { x: number; y: number }) {
  return displays.find((display) => pointInRect(cursor, display.workArea)) ?? displays[0]
}

function parkingDisplay(displays: QaDisplayWorkArea[], cursorDisplay: QaDisplayWorkArea) {
  return displays.find((display) => display.id !== cursorDisplay.id) ?? cursorDisplay
}

function centeredBounds(area: QaDisplayWorkArea['workArea'], width: number, height: number): QaWindowBounds {
  const nextWidth = Math.min(width, area.width)
  const nextHeight = Math.min(height, area.height)
  return {
    x: area.x + Math.max(0, Math.floor((area.width - nextWidth) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - nextHeight) / 2)),
    width: nextWidth,
    height: nextHeight,
  }
}

function parkedBounds(
  area: QaDisplayWorkArea['workArea'],
  width: number,
  height: number,
  edgePx: number
): QaWindowBounds {
  return {
    x: area.x + area.width - edgePx,
    y: area.y + area.height - edgePx,
    width,
    height,
  }
}

export function resolveQaWindowBounds(input: {
  displays: QaDisplayWorkArea[]
  cursor: { x: number; y: number }
  mode: QaWindowPlacementMode
  width?: number
  height?: number
  edgePx?: number
}): QaWindowBounds {
  const width = input.width ?? QA_WINDOW_WIDTH
  const height = input.height ?? QA_WINDOW_HEIGHT
  const edgePx = input.edgePx ?? QA_WINDOW_EDGE_PX
  const fallback: QaWindowBounds = { x: 0, y: 0, width, height }
  if (input.displays.length === 0) {
    return fallback
  }

  const cursorDisplay = displayForCursor(input.displays, input.cursor)
  if (!cursorDisplay) {
    return fallback
  }
  const target = parkingDisplay(input.displays, cursorDisplay)
  if (input.mode === 'center') {
    return centeredBounds(target.workArea, width, height)
  }
  return parkedBounds(target.workArea, width, height, edgePx)
}
