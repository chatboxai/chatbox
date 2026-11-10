import type { CSSProperties } from 'react'

/** Offset of the corner status badge outside the icon box (Tailwind `-bottom-0.5 -right-0.5`). */
const STATUS_BADGE_OFFSET = 2
/** Clear gap kept between the badge and the icon stroke behind it. */
const STATUS_BADGE_GAP = 1

/**
 * Masks a circular hole out of an icon where its corner status badge sits, so the badge reads as separate from the
 * icon without painting an opaque backdrop. The composer is translucent over chat wallpapers, so a solid badge
 * background shows up as a patch.
 */
export function getStatusBadgeCutoutStyle(size: number, statusSize: number): CSSProperties {
  const center = size + STATUS_BADGE_OFFSET - statusSize / 2
  const radius = statusSize / 2 + STATUS_BADGE_GAP
  const mask = `radial-gradient(circle at ${center}px ${center}px, transparent ${radius}px, black ${radius + 0.5}px)`
  return { width: size, height: size, WebkitMaskImage: mask, maskImage: mask }
}
