import { z } from 'zod'

export const DRAWING_KIT_APP_ID = 'drawing-kit'
export const DRAWING_KIT_APP_NAME = 'Drawing Kit'
export const DRAWING_KIT_APP_SNAPSHOT_SCHEMA_VERSION = 1 as const

const MAX_PREVIEW_MARKS = 24
const MAX_LINE_POINTS = 12

const DRAWING_KIT_PROMPT_PACKS = [
  {
    roundLabel: 'Dare 05',
    roundPrompt: 'Draw the weirdest sandwich.',
    rewardLabel: 'Llama sticker',
  },
  {
    roundLabel: 'Dare 07',
    roundPrompt: 'Draw a jellyfish on roller skates.',
    rewardLabel: 'Comet sticker',
  },
  {
    roundLabel: 'Dare 09',
    roundPrompt: 'Draw the flappiest mascot with one noodle line.',
    rewardLabel: 'Rocket sticker',
  },
  {
    roundLabel: 'Dare 11',
    roundPrompt: 'Draw a moon pizza with too many eyes.',
    rewardLabel: 'Meteor sticker',
  },
] as const

export const DrawingKitToolSchema = z.enum(['brush', 'spray', 'stamp'])
export type DrawingKitTool = z.infer<typeof DrawingKitToolSchema>

export const DrawingKitStatusSchema = z.enum(['blank', 'drawing', 'checkpointed', 'complete'])
export type DrawingKitStatus = z.infer<typeof DrawingKitStatusSchema>

export const DrawingKitPreviewPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})
export type DrawingKitPreviewPoint = z.infer<typeof DrawingKitPreviewPointSchema>

export const DrawingKitPreviewMarkSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('line'),
    tool: z.enum(['brush', 'spray']),
    color: z.string().trim().min(1),
    width: z.number().positive(),
    points: z.array(DrawingKitPreviewPointSchema).min(2).max(MAX_LINE_POINTS),
  }),
  z.object({
    kind: z.literal('stamp'),
    stamp: z.enum(['star', 'spark', 'burst']),
    color: z.string().trim().min(1),
    size: z.number().positive(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
])
export type DrawingKitPreviewMark = z.infer<typeof DrawingKitPreviewMarkSchema>

export const DrawingKitAppSnapshotSchema = z.object({
  schemaVersion: z.literal(DRAWING_KIT_APP_SNAPSHOT_SCHEMA_VERSION),
  appId: z.literal(DRAWING_KIT_APP_ID),
  request: z.string().trim().min(1).optional(),
  roundLabel: z.string().trim().min(1),
  roundPrompt: z.string().trim().min(1),
  rewardLabel: z.string().trim().min(1),
  selectedTool: DrawingKitToolSchema,
  status: DrawingKitStatusSchema,
  caption: z.string().trim().min(1).optional(),
  strokeCount: z.number().int().nonnegative(),
  stickerCount: z.number().int().nonnegative().max(9),
  checkpointId: z.string().trim().min(1),
  checkpointSummary: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  statusText: z.string().trim().min(1),
  resumeHint: z.string().trim().min(1),
  previewMarks: z.array(DrawingKitPreviewMarkSchema).max(MAX_PREVIEW_MARKS),
  lastUpdatedAt: z.number().int(),
})

export type DrawingKitAppSnapshot = z.infer<typeof DrawingKitAppSnapshotSchema>

export const DrawingKitDrawShapeSchema = z.enum(['squiggle', 'circle', 'box', 'star', 'burst', 'sticker'])
export type DrawingKitDrawShape = z.infer<typeof DrawingKitDrawShapeSchema>

function hashString(value: string) {
  let hash = 0
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return hash
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural
}

function normalizeCaption(value?: string) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function pickDrawingKitPromptPack(request?: string) {
  const seed = request?.trim() ? request : DRAWING_KIT_APP_ID
  return DRAWING_KIT_PROMPT_PACKS[hashString(seed) % DRAWING_KIT_PROMPT_PACKS.length]
}

function clampPoint(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function encodeSvgDataUrl(svg: string) {
  const encoded =
    typeof Buffer !== 'undefined'
      ? Buffer.from(svg, 'utf8').toString('base64')
      : btoa(unescape(encodeURIComponent(svg)))

  return `data:image/svg+xml;base64,${encoded}`
}

function sampleLinePoints(points: DrawingKitPreviewPoint[]) {
  if (points.length <= MAX_LINE_POINTS) {
    return points.map((point) => ({
      x: clampPoint(point.x),
      y: clampPoint(point.y),
    }))
  }

  const lastIndex = points.length - 1
  return Array.from({ length: MAX_LINE_POINTS }, (_, index) => {
    const sampledIndex = Math.round((index / (MAX_LINE_POINTS - 1)) * lastIndex)
    const point = points[Math.min(lastIndex, sampledIndex)] ?? points[lastIndex]
    return {
      x: clampPoint(point.x),
      y: clampPoint(point.y),
    }
  })
}

export function clampDrawingKitPreviewMarks(marks: DrawingKitPreviewMark[] = []): DrawingKitPreviewMark[] {
  return marks.slice(-MAX_PREVIEW_MARKS).map((mark) => {
    if (mark.kind === 'line') {
      return DrawingKitPreviewMarkSchema.parse({
        ...mark,
        points: sampleLinePoints(mark.points),
      })
    }

    return DrawingKitPreviewMarkSchema.parse({
      ...mark,
      x: clampPoint(mark.x),
      y: clampPoint(mark.y),
    })
  })
}

function buildDrawingKitStatusText(status: DrawingKitStatus, stickerCount: number) {
  if (status === 'complete') {
    return 'Round locked'
  }

  if (status === 'checkpointed') {
    return stickerCount > 0
      ? `${stickerCount} ${pluralize(stickerCount, 'sticker')} banked`
      : 'Checkpoint banked'
  }

  if (status === 'drawing') {
    return 'Round in progress'
  }

  return 'Ready for doodle dare'
}

function buildCheckpointSummary(options: {
  caption?: string
  strokeCount: number
  stickerCount: number
  rewardLabel: string
}) {
  const captionSegment = options.caption ? `"${options.caption}"` : 'Uncaptioned doodle'
  const stickerSegment =
    options.stickerCount > 0
      ? `${options.stickerCount} ${pluralize(options.stickerCount, 'sticker')} (${options.rewardLabel})`
      : 'no stickers banked yet'

  return `${captionSegment}; ${options.strokeCount} ${pluralize(options.strokeCount, 'stroke')}; ${stickerSegment}.`
}

function buildDrawingKitSummary(options: {
  status: DrawingKitStatus
  roundPrompt: string
  caption?: string
  strokeCount: number
  stickerCount: number
  selectedTool: DrawingKitTool
  rewardLabel: string
}) {
  const captionSegment = options.caption
    ? `The doodle is labeled "${options.caption}".`
    : 'The doodle is still uncaptured by caption.'
  const rewardSegment =
    options.stickerCount > 0
      ? `${options.stickerCount} ${pluralize(options.stickerCount, 'sticker')} are banked as ${options.rewardLabel}.`
      : 'No sticker reward is banked yet.'

  if (options.status === 'blank') {
    return `Drawing Kit is ready with the prompt "${options.roundPrompt}". The host keeps a blank canvas checkpoint visible before any marks are made.`
  }

  if (options.status === 'complete') {
    return `Drawing Kit round complete. Prompt "${options.roundPrompt}". ${captionSegment} ${options.strokeCount} ${pluralize(options.strokeCount, 'stroke')} were captured with ${options.selectedTool}. ${rewardSegment} Later chat can recap or replay the saved round without raw stroke history.`
  }

  if (options.status === 'checkpointed') {
    return `Drawing Kit checkpoint banked. Prompt "${options.roundPrompt}". ${captionSegment} ${options.strokeCount} ${pluralize(options.strokeCount, 'stroke')} were saved with ${options.selectedTool}. ${rewardSegment} Later chat can use the checkpoint instead of raw stroke history.`
  }

  return `Drawing Kit round in progress. Prompt "${options.roundPrompt}". ${captionSegment} ${options.strokeCount} ${pluralize(options.strokeCount, 'stroke')} are visible with ${options.selectedTool}. ${rewardSegment}`
}

export function createDrawingKitAppSnapshot(options: {
  request?: string
  roundLabel?: string
  roundPrompt?: string
  rewardLabel?: string
  selectedTool?: DrawingKitTool
  status?: DrawingKitStatus
  caption?: string
  strokeCount?: number
  stickerCount?: number
  checkpointId?: string
  lastUpdatedAt?: number
  previewMarks?: DrawingKitPreviewMark[]
} = {}): DrawingKitAppSnapshot {
  const updatedAt = options.lastUpdatedAt ?? Date.now()
  const promptPack = pickDrawingKitPromptPack(options.request)
  const roundLabel = options.roundLabel ?? promptPack.roundLabel
  const roundPrompt = options.roundPrompt ?? promptPack.roundPrompt
  const rewardLabel = options.rewardLabel ?? promptPack.rewardLabel
  const selectedTool = options.selectedTool ?? 'brush'
  const status = options.status ?? 'blank'
  const caption = normalizeCaption(options.caption)
  const strokeCount = Math.max(0, Math.trunc(options.strokeCount ?? 0))
  const stickerCount = Math.max(0, Math.min(9, Math.trunc(options.stickerCount ?? 0)))
  const checkpointId = options.checkpointId ?? `drawing-kit-${updatedAt}`
  const previewMarks = clampDrawingKitPreviewMarks(options.previewMarks ?? [])

  return DrawingKitAppSnapshotSchema.parse({
    schemaVersion: DRAWING_KIT_APP_SNAPSHOT_SCHEMA_VERSION,
    appId: DRAWING_KIT_APP_ID,
    request: options.request?.trim() || undefined,
    roundLabel,
    roundPrompt,
    rewardLabel,
    selectedTool,
    status,
    caption,
    strokeCount,
    stickerCount,
    checkpointId,
    checkpointSummary: buildCheckpointSummary({
      caption,
      strokeCount,
      stickerCount,
      rewardLabel,
    }),
    summary: buildDrawingKitSummary({
      status,
      roundPrompt,
      caption,
      strokeCount,
      stickerCount,
      selectedTool,
      rewardLabel,
    }),
    statusText: buildDrawingKitStatusText(status, stickerCount),
    resumeHint:
      status === 'complete'
        ? `Play again reopens ${roundLabel} from checkpoint ${checkpointId}.`
        : `Replay round reopens ${roundLabel} from checkpoint ${checkpointId}.`,
    previewMarks,
    lastUpdatedAt: updatedAt,
  })
}

export function parseDrawingKitAppSnapshot(snapshot: unknown) {
  const parsed = DrawingKitAppSnapshotSchema.safeParse(snapshot)
  return parsed.success ? parsed.data : null
}

export function createInitialDrawingKitAppSnapshot(options: {
  request?: string
  updatedAt?: number
  snapshot?: unknown
} = {}) {
  const persisted = parseDrawingKitAppSnapshot(options.snapshot)
  if (persisted) {
    return persisted
  }

  return createDrawingKitAppSnapshot({
    request: options.request,
    lastUpdatedAt: options.updatedAt,
  })
}

export function getDrawingKitStatusLabel(snapshot: DrawingKitAppSnapshot) {
  return snapshot.statusText
}

export function getDrawingKitSurfaceDescription(snapshot: DrawingKitAppSnapshot) {
  if (snapshot.status === 'complete') {
    return 'The doodle round is locked. Chat can recap the caption, sticker reward, and checkpoint without replaying raw marks.'
  }

  if (snapshot.status === 'checkpointed') {
    return 'The host owns a bounded checkpoint with the prompt, caption, sticker reward, and compact preview marks.'
  }

  if (snapshot.status === 'drawing') {
    return 'Use Brush, Spray, or Stamp on the inline canvas, then bank a checkpoint so later chat can reference the round.'
  }

  return 'The round is ready inside the thread. Start doodling or bank an explicit blank checkpoint before handing it back to chat.'
}

export function getDrawingKitFallbackText(snapshot?: DrawingKitAppSnapshot | null) {
  if (!snapshot) {
    return 'The host can keep the last bounded doodle checkpoint visible even if the live drawing surface stops responding.'
  }

  return `The host can fall back to checkpoint ${snapshot.checkpointId} with "${snapshot.checkpointSummary}" even if the live canvas stops responding.`
}

function rebuildDrawingKitSnapshot(
  snapshot: DrawingKitAppSnapshot,
  overrides: Partial<
    Pick<
      DrawingKitAppSnapshot,
      'selectedTool' | 'status' | 'caption' | 'checkpointId' | 'lastUpdatedAt' | 'previewMarks'
    >
  >
) {
  const nextPreviewMarks = overrides.previewMarks ?? snapshot.previewMarks
  return createDrawingKitAppSnapshot({
    request: snapshot.request,
    roundLabel: snapshot.roundLabel,
    roundPrompt: snapshot.roundPrompt,
    rewardLabel: snapshot.rewardLabel,
    selectedTool: overrides.selectedTool ?? snapshot.selectedTool,
    status: overrides.status ?? snapshot.status,
    caption: overrides.caption ?? snapshot.caption,
    strokeCount: nextPreviewMarks.length,
    stickerCount: nextPreviewMarks.filter((mark) => mark.kind === 'stamp').length,
    checkpointId: overrides.checkpointId ?? snapshot.checkpointId,
    lastUpdatedAt: overrides.lastUpdatedAt ?? Date.now(),
    previewMarks: nextPreviewMarks,
  })
}

export function setDrawingKitSelectedTool(
  snapshot: DrawingKitAppSnapshot,
  selectedTool: DrawingKitTool,
  options: { lastUpdatedAt?: number } = {}
) {
  return rebuildDrawingKitSnapshot(snapshot, {
    selectedTool,
    status: snapshot.previewMarks.length > 0 ? 'drawing' : snapshot.status,
    lastUpdatedAt: options.lastUpdatedAt,
  })
}

export function appendDrawingKitPreviewMarks(
  snapshot: DrawingKitAppSnapshot,
  marks: DrawingKitPreviewMark[],
  options: { caption?: string; selectedTool?: DrawingKitTool; lastUpdatedAt?: number } = {}
) {
  const previewMarks = clampDrawingKitPreviewMarks([...snapshot.previewMarks, ...marks])
  return rebuildDrawingKitSnapshot(snapshot, {
    previewMarks,
    selectedTool: options.selectedTool ?? snapshot.selectedTool,
    caption: options.caption ?? snapshot.caption,
    status: previewMarks.length > 0 ? 'drawing' : 'blank',
    checkpointId: `drawing-kit-${options.lastUpdatedAt ?? Date.now()}`,
    lastUpdatedAt: options.lastUpdatedAt,
  })
}

export function eraseLastDrawingKitPreviewMark(
  snapshot: DrawingKitAppSnapshot,
  options: { lastUpdatedAt?: number } = {}
) {
  const previewMarks = snapshot.previewMarks.slice(0, -1)
  return rebuildDrawingKitSnapshot(snapshot, {
    previewMarks,
    status: previewMarks.length > 0 ? 'drawing' : 'blank',
    checkpointId: `drawing-kit-${options.lastUpdatedAt ?? Date.now()}`,
    lastUpdatedAt: options.lastUpdatedAt,
  })
}

export function clearDrawingKitPreviewMarks(
  snapshot: DrawingKitAppSnapshot,
  options: { lastUpdatedAt?: number } = {}
) {
  return rebuildDrawingKitSnapshot(snapshot, {
    previewMarks: [],
    status: 'blank',
    checkpointId: `drawing-kit-${options.lastUpdatedAt ?? Date.now()}`,
    lastUpdatedAt: options.lastUpdatedAt,
  })
}

export function bankDrawingKitSnapshot(
  snapshot: DrawingKitAppSnapshot,
  options: { caption?: string; lastUpdatedAt?: number } = {}
) {
  return rebuildDrawingKitSnapshot(snapshot, {
    caption: options.caption ?? snapshot.caption,
    status: 'checkpointed',
    checkpointId: `drawing-kit-${options.lastUpdatedAt ?? Date.now()}`,
    lastUpdatedAt: options.lastUpdatedAt,
  })
}

function renderLineMark(mark: Extract<DrawingKitPreviewMark, { kind: 'line' }>, width: number, height: number) {
  const points = mark.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${Math.round(point.x * width)} ${Math.round(point.y * height)}`)
    .join(' ')

  if (mark.tool === 'spray') {
    return mark.points
      .map((point, index) => {
        const cx = Math.round(point.x * width)
        const cy = Math.round(point.y * height)
        return Array.from({ length: 5 }, (_, sprayIndex) => {
          const angle = index * 0.8 + sprayIndex
          const radius = 4 + sprayIndex * 2
          const x = cx + Math.round(Math.cos(angle) * radius)
          const y = cy + Math.round(Math.sin(angle) * radius)
          return `<circle cx="${x}" cy="${y}" r="2" fill="${mark.color}" />`
        }).join('')
      })
      .join('')
  }

  return `<path d="${points}" fill="none" stroke="${mark.color}" stroke-width="${mark.width}" stroke-linecap="round" stroke-linejoin="round" />`
}

function renderStampMark(mark: Extract<DrawingKitPreviewMark, { kind: 'stamp' }>, width: number, height: number) {
  const x = Math.round(mark.x * width)
  const y = Math.round(mark.y * height)
  const radius = mark.size

  if (mark.stamp === 'burst') {
    const points = Array.from({ length: 12 }, (_, index) => {
      const outer = index % 2 === 0 ? radius : radius * 0.45
      const angle = (Math.PI / 6) * index
      return `${Math.round(x + Math.cos(angle) * outer)},${Math.round(y + Math.sin(angle) * outer)}`
    }).join(' ')
    return `<polygon points="${points}" fill="${mark.color}" />`
  }

  const points = Array.from({ length: 10 }, (_, index) => {
    const outer = index % 2 === 0 ? radius : radius * 0.45
    const angle = -Math.PI / 2 + (Math.PI / 5) * index
    return `${Math.round(x + Math.cos(angle) * outer)},${Math.round(y + Math.sin(angle) * outer)}`
  }).join(' ')
  return `<polygon points="${points}" fill="${mark.color}" />`
}

export function createDrawingKitScreenshotDataUrl(snapshot: DrawingKitAppSnapshot) {
  const width = 900
  const height = 640
  const canvasX = 40
  const canvasY = 170
  const canvasWidth = 540
  const canvasHeight = 360
  const marks = snapshot.previewMarks
    .map((mark) => (mark.kind === 'line' ? renderLineMark(mark, canvasWidth, canvasHeight) : renderStampMark(mark, canvasWidth, canvasHeight)))
    .join('')

  const caption = escapeSvgText(snapshot.caption ?? 'Uncaptioned doodle')
  const summary = escapeSvgText(snapshot.summary)
  const checkpoint = escapeSvgText(snapshot.checkpointSummary)
  const prompt = escapeSvgText(snapshot.roundPrompt)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" rx="32" fill="#fff7e5" />
    <rect x="${canvasX}" y="${canvasY}" width="${canvasWidth}" height="${canvasHeight}" rx="26" fill="#fffdf4" stroke="#f1c56c" stroke-width="3" />
    <text x="40" y="42" font-size="18" font-weight="800" fill="#b87000">${escapeSvgText(snapshot.roundLabel.toUpperCase())} · STICKER SPRINT</text>
    <text x="40" y="86" font-size="34" font-weight="900" fill="#26211d">Drawing Kit</text>
    <text x="40" y="122" font-size="24" font-weight="800" fill="#ff8a4c">${prompt}</text>
    <rect x="620" y="170" width="240" height="160" rx="24" fill="#f4f9ff" stroke="#bed8ff" />
    <text x="644" y="208" font-size="16" font-weight="800" fill="#267df0">STATUS</text>
    <text x="644" y="242" font-size="18" fill="#1f2933">${escapeSvgText(snapshot.statusText)}</text>
    <text x="644" y="278" font-size="16" fill="#44505c">Tool: ${escapeSvgText(snapshot.selectedTool)}</text>
    <text x="644" y="308" font-size="16" fill="#44505c">Caption: ${caption}</text>
    <rect x="620" y="354" width="240" height="182" rx="24" fill="#fff7de" stroke="#f1c56c" />
    <text x="644" y="392" font-size="16" font-weight="800" fill="#ff8a4c">CHECKPOINT</text>
    <text x="644" y="426" font-size="16" fill="#44505c">${checkpoint}</text>
    <text x="40" y="580" font-size="15" fill="#6f6156">${summary}</text>
    <g transform="translate(${canvasX}, ${canvasY})">${marks}</g>
  </svg>`

  return encodeSvgDataUrl(svg)
}
