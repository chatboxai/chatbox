import type { Message } from '@shared/types/session'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { createBridgeHostController } from '@/packages/chatbridge/bridge/host-controller'
import { createArtifactPreviewRuntimeMarkup } from '@/packages/chatbridge/bridge/artifact-runtime'
import { getMessageThreadContext } from '@/stores/sessionActions'
import { getMessageText } from '../../shared/utils/message'
import { ChatBridgeShell } from './chatbridge/ChatBridgeShell'
import type { ChatBridgeShellState } from './chatbridge/chatbridge'
import { getArtifactShellState } from './chatbridge/chatbridge'

const RENDERABLE_CODE_LANGUAGES = ['html'] as const
export type RenderableCodeLanguage = (typeof RENDERABLE_CODE_LANGUAGES)[number]

const CODE_BLOCK_LANGUAGES = [...RENDERABLE_CODE_LANGUAGES, 'js', 'javascript', 'css'] as const
export type CodeBlockLanguage = (typeof CODE_BLOCK_LANGUAGES)[number]

export function isContainRenderableCode(markdown: string): boolean {
  if (!markdown) {
    return false
  }
  return (
    RENDERABLE_CODE_LANGUAGES.some((l) => markdown.includes('```' + l + '\n')) ||
    RENDERABLE_CODE_LANGUAGES.some((l) => markdown.includes('```' + l.toUpperCase() + '\n'))
  )
}

export function isRenderableCodeLanguage(language: string): boolean {
  return !!language && RENDERABLE_CODE_LANGUAGES.includes(language.toLowerCase() as RenderableCodeLanguage)
}

export function MessageArtifact(props: {
  sessionId: string
  messageId: string
  messageContent: string
  generating?: boolean
  preview: boolean
  setPreview: (preview: boolean) => void
}) {
  const { sessionId, messageId, messageContent, generating, preview, setPreview } = props

  const [contextMessages, setContextMessages] = useState<Message[]>([])

  useEffect(() => {
    async function fetchContextMessages(): Promise<Message[]> {
      if (!sessionId || !messageId) {
        return []
      }
      const messageList = await getMessageThreadContext(sessionId, messageId)
      const index = messageList.findIndex((m) => m.id === messageId)

      return messageList.slice(0, index)
    }
    void fetchContextMessages().then((msgs) => {
      setContextMessages(msgs)
    })
  }, [messageId, sessionId])

  const htmlCode = useMemo(() => {
    return generateHtml([...contextMessages.map((m) => getMessageText(m)), messageContent])
  }, [contextMessages, messageContent])

  return <ArtifactWithButtons generating={generating} htmlCode={htmlCode} preview={preview} setPreview={setPreview} />
}

export function ArtifactWithButtons(props: {
  generating?: boolean
  htmlCode: string
  preview: boolean
  setPreview: (preview: boolean) => void
}) {
  const { generating, htmlCode, preview, setPreview } = props
  const { t } = useTranslation()
  const [reloadSign, setReloadSign] = useState(0)
  const [bridgeError, setBridgeError] = useState(false)
  const hasRenderableHtml = htmlCode.trim().length > 0
  const shellState = getArtifactShellState({ generating, preview, hasRenderableHtml, bridgeError })
  const inlinePreviewHeightClass = 'h-[460px] md:h-[560px] xl:h-[640px]'

  useEffect(() => {
    if (!preview) {
      setBridgeError(false)
    }
  }, [preview])

  const onReplay = () => {
    setBridgeError(false)
    setReloadSign(Math.random())
  }
  const onPreview = () => {
    setBridgeError(false)
    setPreview(true)
    setReloadSign(Math.random())
  }
  const onStopPreview = () => {
    setPreview(false)
  }
  const descriptions: Record<ChatBridgeShellState, string> = {
    loading: 'The host wrapper is preparing the generated HTML preview.',
    ready: 'The preview is ready to open from the message without dropping into a raw iframe panel.',
    active: 'The preview is mounted inside the host-owned shell and can be refreshed or dismissed from the thread.',
    complete: 'The preview completed inside the host-owned shell.',
    degraded: 'The preview is unavailable, so the host is keeping the recovery path bounded inside the same shell.',
    error: 'No renderable HTML was found, so the host shell is presenting the fallback path instead.',
  }
  const statusLabels: Record<ChatBridgeShellState, string> = {
    loading: 'Loading',
    ready: 'Ready',
    active: 'Running',
    complete: 'Complete',
    degraded: 'Recovery',
    error: 'Fallback',
  }

  return (
    <ChatBridgeShell
      state={shellState}
      title="Embedded app shell"
      description={descriptions[shellState]}
      surfaceTitle="Generated HTML preview"
      surfaceDescription="The runtime surface stays inside the host-owned shell so loading, launch, and fallback remain part of the conversation."
      statusLabel={statusLabels[shellState]}
      fallbackTitle="Fallback"
      fallbackText="The message still keeps its raw markdown content above, but there is no renderable HTML block available for an embedded preview."
      secondaryAction={preview ? { label: t('Close'), onClick: onStopPreview, variant: 'secondary' } : undefined}
      primaryAction={
        hasRenderableHtml
          ? {
              label: preview ? t('Refresh') : t('Preview'),
              onClick: preview ? onReplay : onPreview,
            }
          : undefined
      }
    >
      {preview && hasRenderableHtml && !bridgeError ? (
        <Artifact
          htmlCode={htmlCode}
          reloadSign={reloadSign}
          className={inlinePreviewHeightClass}
          onBridgeError={() => setBridgeError(true)}
        />
      ) : null}
    </ChatBridgeShell>
  )
}

export function Artifact(props: {
  htmlCode: string
  reloadSign?: number
  className?: string
  onBridgeError?: () => void
}) {
  const { htmlCode, reloadSign, className, onBridgeError } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const controllerRef = useRef<ReturnType<typeof createBridgeHostController> | null>(null)
  const runtimeUrl = useMemo(() => {
    const html = createArtifactPreviewRuntimeMarkup()
    return URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  }, [])

  const expectedOrigin = useMemo(() => {
    return window.location.origin || 'null'
  }, [])

  const bootstrapTargetOrigin = expectedOrigin === 'null' ? '*' : expectedOrigin

  useEffect(() => {
    return () => {
      controllerRef.current?.dispose()
      URL.revokeObjectURL(runtimeUrl)
    }
  }, [runtimeUrl])

  useEffect(() => {
    controllerRef.current?.dispose()
    controllerRef.current = null
  }, [reloadSign])

  useEffect(() => {
    controllerRef.current?.renderHtml(htmlCode)
  }, [htmlCode])

  const handleLoad = () => {
    const targetWindow = ref.current?.contentWindow
    if (!targetWindow) {
      onBridgeError?.()
      return
    }

    controllerRef.current?.dispose()
    const controller = createBridgeHostController({
      appId: 'artifact-preview',
      appInstanceId: `artifact-preview-${crypto.randomUUID()}`,
      expectedOrigin,
      bootstrapTargetOrigin,
      capabilities: ['render-html-preview'],
      onRejectedAppEvent: () => {
        onBridgeError?.()
      },
    })

    controller.attach(targetWindow as unknown as Parameters<typeof controller.attach>[0])
    controller.renderHtml(htmlCode)
    controllerRef.current = controller

    void controller.waitForReady().catch(() => {
      onBridgeError?.()
    })
  }

  return (
    <iframe
      key={reloadSign}
      className={cn('w-full', 'border-none', 'min-h-[400px]', className)}
      sandbox="allow-scripts allow-forms"
      src={runtimeUrl}
      ref={ref}
      onLoad={handleLoad}
    />
  )
}

function generateHtml(markdowns: string[]): string {
  const codeBlocks: Record<CodeBlockLanguage, string[]> = {
    html: [],
    js: [],
    javascript: [],
    css: [],
  }
  const languages = Array.from(Object.keys(codeBlocks)) as (keyof typeof codeBlocks)[]
  let currentType: keyof typeof codeBlocks | null = null
  let currentContent = ''
  for (const markdown of markdowns) {
    for (let line of markdown.split('\n')) {
      line = line.trimStart()
      const lang = languages.find((l) => '```' + l === line)
      if (lang) {
        currentType = lang
        continue
      }
      if (line === '```') {
        if (currentContent && currentType) {
          codeBlocks[currentType].push(currentContent)
          currentContent = ''
          currentType = null
          continue
        } else {
          continue
        }
      }
      if (currentType) {
        currentContent += line + '\n'
      }
    }
  }
  // 仅保留最后一个
  // const htmlWholes = codeBlocks.html.filter(c => c.includes('</html>'))
  // codeBlocks.html = [
  //     htmlWholes[htmlWholes.length - 1],
  //     ...codeBlocks.html.filter(c => !c.includes('</html>'))
  // ]

  codeBlocks.html = codeBlocks.html.slice(-1)
  codeBlocks.css = codeBlocks.css.slice(-1)
  codeBlocks.javascript = codeBlocks.javascript.slice(-1)
  codeBlocks.js = codeBlocks.js.slice(-1)

  if (codeBlocks.html.length === 0) {
    return ''
  }

  const srcDoc = `
<script src="https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio,line-clamp,container-queries"></script>

${codeBlocks.html.join('\n')}

<style>
${codeBlocks.css.join('\n')}
</style>

<script>
${codeBlocks.js.join('\n\n// ----------- \n\n')}
${codeBlocks.javascript.join('\n\n// ----------- \n\n')}
</script>
    `
  return srcDoc
}
