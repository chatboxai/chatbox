import NiceModal from '@ebay/nice-modal-react'
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined'
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined'
import { ButtonGroup, IconButton } from '@mui/material'
import { debounce } from 'lodash'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { rendererApplication } from '@/app/renderer-application'
import { appendArtifactMarkdown, createArtifactCode, renderArtifactCode, type ArtifactCode } from './artifact-code'
import ArrowRightIcon from './icons/ArrowRightIcon'
import FullscreenIcon from './icons/FullscreenIcon'

const RENDERABLE_CODE_LANGUAGES = ['html'] as const
export type RenderableCodeLanguage = (typeof RENDERABLE_CODE_LANGUAGES)[number]

export type { CodeBlockLanguage } from './artifact-code'

export function isContainRenderableCode(markdown: string): boolean {
  if (!markdown) {
    return false
  }
  return (
    RENDERABLE_CODE_LANGUAGES.some((l) => markdown.includes(`\`\`\`${l}\n`)) ||
    RENDERABLE_CODE_LANGUAGES.some((l) => markdown.includes(`\`\`\`${l.toUpperCase()}\n`))
  )
}

export function isRenderableCodeLanguage(language: string): boolean {
  return !!language && RENDERABLE_CODE_LANGUAGES.includes(language.toLowerCase() as RenderableCodeLanguage)
}

export function MessageArtifact(props: {
  sessionId: string
  messageId: string
  messageContent: string
  preview: boolean
  setPreview: (preview: boolean) => void
}) {
  const { sessionId, messageId, messageContent, preview, setPreview } = props

  const { t } = useTranslation()
  const key = JSON.stringify([sessionId, messageId])
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const current = useRef({ key, messageContent })
  current.current = { key, messageContent }
  const cached = useRef<{ key: string; code: ArtifactCode }>()
  const pending = useRef<{ key: string; abort: AbortController; promise: Promise<ArtifactCode> }>()
  const [history, setHistory] = useState<{ key: string; code: ArtifactCode }>()
  const [loadingKey, setLoadingKey] = useState<string>()
  const [errorKey, setErrorKey] = useState<string>()

  const loadHistory = useCallback((): Promise<ArtifactCode> => {
    if (cached.current?.key === key) return Promise.resolve(cached.current.code)
    if (pending.current?.key === key) return pending.current.promise
    pending.current?.abort.abort()
    const abort = new AbortController()
    setLoadingKey(key)
    setErrorKey(undefined)
    const promise = (async () => {
      const code = createArtifactCode()
      for await (const markdown of rendererApplication.sessions.iterateSessionArtifactMarkdown({
        sessionId,
        messageId,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted || !mounted.current || current.current.key !== key)
          throw new Error('Artifact request canceled')
        appendArtifactMarkdown(code, markdown)
      }
      if (abort.signal.aborted || !mounted.current || current.current.key !== key)
        throw new Error('Artifact request canceled')
      cached.current = { key, code }
      setHistory({ key, code })
      return code
    })()
      .catch((error: unknown) => {
        if (!abort.signal.aborted && current.current.key === key) setErrorKey(key)
        throw error
      })
      .finally(() => {
        if (pending.current?.abort === abort) {
          pending.current = undefined
          setLoadingKey(undefined)
        }
      })
    pending.current = { key, abort, promise }
    return promise
  }, [key, sessionId, messageId])

  useEffect(() => {
    if (preview) void loadHistory().catch(() => {})
    return () => {
      pending.current?.abort.abort()
      pending.current = undefined
      setLoadingKey(undefined)
    }
  }, [preview, loadHistory])

  const resolveHtmlCode = async () => {
    try {
      const code = await loadHistory()
      if (!mounted.current || current.current.key !== key) return null
      return renderArtifactCode(code, current.current.messageContent)
    } catch {
      return null
    }
  }
  const htmlCode = useMemo(
    () => renderArtifactCode(history?.key === key ? history.code : createArtifactCode(), messageContent),
    [history, key, messageContent]
  )

  return (
    <>
      <ArtifactWithButtons
        htmlCode={htmlCode}
        resolveHtmlCode={resolveHtmlCode}
        loading={loadingKey === key}
        preview={preview}
        setPreview={setPreview}
        sessionId={sessionId}
        uniqueId={`${messageId}-artifact`}
      />
      {errorKey === key && <div role="alert">{t('Something went wrong')}</div>}
    </>
  )
}

export function ArtifactWithButtons(props: {
  htmlCode: string
  resolveHtmlCode?: () => Promise<string | null>
  loading?: boolean
  previewUrl?: string
  preview: boolean
  setPreview: (preview: boolean) => void
  sessionId?: string
  uniqueId?: string
}) {
  const { htmlCode, resolveHtmlCode, loading, previewUrl, preview, setPreview, sessionId, uniqueId } = props
  const { t } = useTranslation()
  const [reloadSign, setReloadSign] = useState(0)
  const isSmallScreen = useIsSmallScreen()

  const onReplay = () => {
    setReloadSign(Math.random())
  }
  const onPreview = () => {
    setPreview(true)
    setReloadSign(Math.random())
  }
  const onStopPreview = () => {
    setPreview(false)
  }
  const onOpenFullscreen = async () => {
    if (loading) return
    const content = resolveHtmlCode ? await resolveHtmlCode() : htmlCode
    if (content === null) return
    await NiceModal.show('artifact-preview', {
      htmlCode: content,
      previewUrl,
      sessionId,
      uniqueId,
    })
  }
  if (!preview) {
    return (
      <div
        className="w-full my-1 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-300 cursor-pointer overflow-hidden group"
        onClick={onPreview}
        aria-busy={loading}
      >
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center space-x-3">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-white"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <span className="text-lg font-semibold text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300">
              {loading ? t('Loading...') : t('Preview')}
            </span>
          </div>
          <div className="flex items-center justify-center">
            <button
              type="button"
              aria-label={String(t('Fullscreen'))}
              disabled={loading}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void onOpenFullscreen()
              }}
            >
              <FullscreenIcon className="mr-1 hover:bg-white hover:rounded hover:text-gray-500 p-1 w-8 h-8 text-gray-400 dark:text-gray-500 group-hover:text-blue-500" />
            </button>
            <ArrowRightIcon
              className="hover:bg-white hover:rounded  hover:text-gray-500
                            p-1 w-8 h-8 text-gray-400 dark:text-gray-500 group-hover:text-blue-500 dark:group-hover:text-blue-400"
              onClick={() => setPreview(true)}
            />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div
      className={cn(
        'w-full',
        'border border-solid rounded border-gray-500/40',
        'flex',
        isSmallScreen ? 'flex-col-reverse' : 'flex-row'
      )}
    >
      {loading ? (
        <div role="status" className="w-full p-4">
          {t('Loading...')}
        </div>
      ) : (
        <Artifact htmlCode={htmlCode} previewUrl={previewUrl} reloadSign={reloadSign} />
      )}
      <ButtonGroup
        orientation={isSmallScreen ? 'horizontal' : 'vertical'}
        className={cn(
          'border-solid border-gray-500/20',
          isSmallScreen ? 'border-r-0 border-b-1 border-l-0 border-t-0' : 'border-r-0 border-b-0 border-l-1 border-t-0'
        )}
      >
        <IconButton onClick={onReplay} color="primary">
          <ReplayOutlinedIcon />
        </IconButton>
        <IconButton onClick={onOpenFullscreen} color="primary" aria-label={String(t('Fullscreen'))} disabled={loading}>
          <FullscreenIcon className="w-5 h-5" />
        </IconButton>
        <IconButton onClick={onStopPreview} color="error">
          <StopCircleOutlinedIcon />
        </IconButton>
      </ButtonGroup>
    </div>
  )
}

export function Artifact(props: { htmlCode: string; previewUrl?: string; reloadSign?: number; className?: string }) {
  const { htmlCode, previewUrl, reloadSign, className } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const iframeOrigin = 'https://artifact-preview.chatboxai.app/preview'

  const sendIframeMsg = useCallback((type: 'html', code: string) => {
    if (!ref.current) {
      return
    }
    ref.current.contentWindow?.postMessage({ type, code }, '*')
  }, [])
  // 当 reloadSign 改变时，重新加载 iframe 内容
  useEffect(() => {
    if (previewUrl) return
    void (async () => {
      void reloadSign
      sendIframeMsg('html', '')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      sendIframeMsg('html', htmlCode)
    })()
  }, [htmlCode, previewUrl, reloadSign, sendIframeMsg])

  // 当 htmlCode 改变时，防抖地刷新 iframe 内容
  const updateIframe = useMemo(
    () =>
      debounce(() => {
        sendIframeMsg('html', htmlCode)
      }, 300),
    [htmlCode, sendIframeMsg]
  )
  useEffect(() => {
    if (previewUrl) return
    updateIframe()
    return () => updateIframe.cancel()
  }, [previewUrl, updateIframe])

  return (
    <iframe
      key={`${previewUrl || iframeOrigin}:${reloadSign ?? 0}`}
      className={cn('w-full', 'border-none', 'h-[400px]', className)}
      sandbox={previewUrl ? 'allow-scripts allow-forms allow-same-origin' : 'allow-scripts allow-forms'}
      src={previewUrl || iframeOrigin}
      ref={ref}
    />
  )
}
