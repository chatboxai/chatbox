import { describe, expect, it } from 'vitest'
import {
  clampDrawingKitPreviewMarks,
  createDrawingKitAppSnapshot,
  createInitialDrawingKitAppSnapshot,
  getDrawingKitFallbackText,
} from './drawing-kit'

describe('shared drawing kit helpers', () => {
  it('creates a blank host-owned doodle checkpoint from the launch request', () => {
    const snapshot = createInitialDrawingKitAppSnapshot({
      request: 'Open Drawing Kit and let me doodle something weird.',
      updatedAt: 1_000,
    })

    expect(snapshot.appId).toBe('drawing-kit')
    expect(snapshot.status).toBe('blank')
    expect(snapshot.strokeCount).toBe(0)
    expect(snapshot.previewMarks).toEqual([])
    expect(snapshot.statusText).toBe('Ready for doodle dare')
    expect(snapshot.summary).toContain('blank canvas checkpoint')
  })

  it('clamps preview marks and builds a bounded checkpoint summary', () => {
    const previewMarks = Array.from({ length: 30 }, (_, index) => ({
      kind: 'line' as const,
      tool: index % 2 === 0 ? ('brush' as const) : ('spray' as const),
      color: '#ff8a4c',
      width: 4,
      points: Array.from({ length: 20 }, (__unused, pointIndex) => ({
        x: pointIndex / 19,
        y: (index + pointIndex) / 30,
      })),
    }))

    const snapshot = createDrawingKitAppSnapshot({
      request: 'Open Drawing Kit and start a sticky-note doodle dare.',
      roundLabel: 'Dare 05',
      roundPrompt: 'Draw the weirdest sandwich.',
      rewardLabel: 'Llama sticker',
      caption: 'Triple pickle sandwich',
      selectedTool: 'spray',
      status: 'checkpointed',
      strokeCount: 41,
      stickerCount: 3,
      checkpointId: 'drawing-kit-4242',
      lastUpdatedAt: 4_242,
      previewMarks: clampDrawingKitPreviewMarks(previewMarks),
    })

    expect(snapshot.previewMarks).toHaveLength(24)
    const firstLine = snapshot.previewMarks[0]
    if (firstLine?.kind !== 'line') {
      throw new Error('Expected the preview mark to stay a line.')
    }
    expect(firstLine.points).toHaveLength(12)
    expect(snapshot.statusText).toBe('3 stickers banked')
    expect(snapshot.checkpointSummary).toContain('Triple pickle sandwich')
    expect(snapshot.summary).toContain('Later chat can use the checkpoint instead of raw stroke history.')
    expect(getDrawingKitFallbackText(snapshot)).toContain('drawing-kit-4242')
  })
})
