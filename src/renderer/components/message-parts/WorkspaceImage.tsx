import { IconPhotoOff } from '@tabler/icons-react'
import { type ComponentProps, type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  base64ByteLength,
  cacheWorkspaceImage,
  getCachedWorkspaceImage,
  hasFailedWorkspaceImage,
  isWorkspaceImagePath,
  MAX_WORKSPACE_IMAGE_BYTES,
  markWorkspaceImageFailed,
  normalizeWorkspaceImagePath,
  workspaceImageDataUrl,
} from './workspace-image'

type ResolveState =
  /** Not a mobile workspace image after all — render the source verbatim. */
  | { status: 'passthrough' }
  | { status: 'resolving' }
  | { status: 'resolved'; src: string }
  | { status: 'failed'; reason: 'unavailable' | 'too-large' }

/**
 * Retry delays for a path that is not in the workspace *yet*.
 *
 * A markdown reference can be rendered before the file exists: the agent writes
 * `output/chart.png` during a tool call while the message that mentions it is already
 * on screen. Re-checking a few times lets the image appear on its own once the run
 * commits its files, without the user having to re-open the conversation.
 */
const RETRY_DELAYS_MS = [1_500, 4_000]

/**
 * Read a workspace image and turn it into a data URL the WebView can render.
 * Returns the failure reason instead of throwing so the caller can degrade quietly.
 */
async function resolveWorkspaceImage(
  sessionId: string,
  path: string,
  options?: { bypassFailureCache?: boolean }
): Promise<ResolveState> {
  const cached = getCachedWorkspaceImage(sessionId, path)
  if (cached) return { status: 'resolved', src: cached }
  // A scheduled retry is an explicit re-check and must not be short-circuited by the
  // "recently failed" mark the previous attempt just wrote.
  if (!options?.bypassFailureCache && hasFailedWorkspaceImage(sessionId, path)) {
    return { status: 'failed', reason: 'unavailable' }
  }
  try {
    const { CapacitorWorkspace } = await import('@/packages/mobile-work-mode/CapacitorWorkspace')
    const base64 = await new CapacitorWorkspace().readBase64(sessionId, path)
    if (base64ByteLength(base64) > MAX_WORKSPACE_IMAGE_BYTES) {
      markWorkspaceImageFailed(sessionId, path)
      return { status: 'failed', reason: 'too-large' }
    }
    const src = workspaceImageDataUrl(path, base64)
    cacheWorkspaceImage(sessionId, path, src)
    return { status: 'resolved', src }
  } catch (error) {
    // Expected while a run is still producing the file; keep the reason diagnosable
    // without spamming the console on every streaming re-render.
    console.debug('[workspace-image] could not read workspace image', path, error)
    markWorkspaceImageFailed(sessionId, path)
    return { status: 'failed', reason: 'unavailable' }
  }
}

/**
 * Renders a markdown image whose `src` points at a file in the conversation workspace
 * (`output/chart.png`, `artifacts/run/plot.png`, …). The WebView cannot load those paths
 * directly, so on mobile the file is read from the workspace and inlined as a data URL.
 * Desktop and web keep the previous behaviour (plain `<img>` with the original source).
 */
export const WorkspaceImage: FC<
  ComponentProps<'img'> & { sessionId?: string; source: string; retryDelaysMs?: number[] }
> = ({ sessionId, source, alt, className, retryDelaysMs = RETRY_DELAYS_MS, ...props }) => {
  const { t } = useTranslation()
  const path = normalizeWorkspaceImagePath(source)
  const [state, setState] = useState<ResolveState>({ status: 'resolving' })

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (next: ResolveState) => {
      if (active) setState(next)
    }
    if (!sessionId) {
      settle({ status: 'passthrough' })
      return () => {
        active = false
      }
    }
    void (async () => {
      let platformType: string
      try {
        platformType = (await import('@/platform')).default.type
      } catch {
        settle({ status: 'passthrough' })
        return
      }
      if (platformType !== 'mobile') {
        settle({ status: 'passthrough' })
        return
      }
      // Retry a missing file a couple of times: the reference may be on screen before
      // the run that produces the image has committed its workspace files.
      for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
        const next = await resolveWorkspaceImage(sessionId, path, { bypassFailureCache: attempt > 0 })
        if (!active) return
        settle(next)
        if (next.status !== 'failed' || next.reason !== 'unavailable') return
        const delay = retryDelaysMs[attempt]
        if (delay === undefined) return
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, delay)
        })
        if (!active) return
      }
    })()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, path, retryDelaysMs])

  if (state.status === 'passthrough') {
    return <img {...props} src={source} alt={alt} className={className} />
  }

  if (state.status === 'resolved') {
    return <img {...props} src={state.src} alt={alt} className={className} />
  }

  if (state.status === 'resolving') {
    return (
      <span
        className="inline-flex min-h-24 min-w-40 animate-pulse items-center justify-center rounded-md bg-chatbox-background-secondary px-3 py-6 align-middle"
        data-testid="workspace-image-loading"
      >
        <span className="text-xs text-chatbox-tint-tertiary">{t('Loading image…')}</span>
      </span>
    )
  }

  // Degrade to a small chip instead of the WebView's broken-image glyph: the file was
  // referenced but is gone (workspace cleaned/evicted) or too large to inline.
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-sm bg-chatbox-background-secondary px-1.5 py-0.5 align-[-3px] text-[0.9em] opacity-70"
      title={path}
      data-testid="workspace-image-unavailable"
    >
      <IconPhotoOff size={13} className="shrink-0" />
      <span className="truncate">
        {alt || path}
        <span className="ml-1 opacity-75">
          (
          {state.reason === 'too-large'
            ? t('Image is too large to display')
            : t('Image no longer available in this workspace')}
          )
        </span>
      </span>
    </span>
  )
}
