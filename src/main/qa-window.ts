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

type ParkCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

const PARK_CORNER_PREFERENCE: ParkCorner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left']

function parkedBoundsAtCorner(
  area: QaDisplayWorkArea['workArea'],
  width: number,
  height: number,
  edgePx: number,
  corner: ParkCorner
): QaWindowBounds {
  const parkRight = corner === 'bottom-right' || corner === 'top-right'
  const parkBottom = corner === 'bottom-right' || corner === 'bottom-left'
  return {
    x: parkRight ? area.x + area.width - edgePx : area.x + edgePx - width,
    y: parkBottom ? area.y + area.height - edgePx : area.y + edgePx - height,
    width,
    height,
  }
}

function overlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function overflowOntoOtherDisplays(bounds: QaWindowBounds, parking: QaDisplayWorkArea, displays: QaDisplayWorkArea[]) {
  return displays.reduce((total, display) => {
    if (display.id === parking.id) return total
    return total + overlapArea(bounds, display.workArea)
  }, 0)
}

function parkedBounds(
  parking: QaDisplayWorkArea,
  displays: QaDisplayWorkArea[],
  width: number,
  height: number,
  edgePx: number
): QaWindowBounds {
  let best = parkedBoundsAtCorner(parking.workArea, width, height, edgePx, 'bottom-right')
  let bestOverflow = overflowOntoOtherDisplays(best, parking, displays)
  for (const corner of PARK_CORNER_PREFERENCE) {
    const candidate = parkedBoundsAtCorner(parking.workArea, width, height, edgePx, corner)
    const overflow = overflowOntoOtherDisplays(candidate, parking, displays)
    if (overflow < bestOverflow) {
      best = candidate
      bestOverflow = overflow
    }
  }
  return best
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
  return parkedBounds(target, input.displays, width, height, edgePx)
}
