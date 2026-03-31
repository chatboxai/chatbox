import type { Message } from '@shared/types/session'
import { debounce } from 'lodash'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { getMessageThreadContext } from '@/stores/sessionActions'
import { getMessageText } from '../../shared/utils/message'
import { ChatBridgeShell } from './chatbridge/ChatBridgeShell'
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
  const hasRenderableHtml = htmlCode.trim().length > 0
  const shellState = getArtifactShellState({ generating, preview, hasRenderableHtml })

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
  const descriptions = {
    loading: 'The host wrapper is preparing the generated HTML preview.',
    ready: 'The preview is ready to open from the message without dropping into a raw iframe panel.',
    active: 'The preview is mounted inside the host-owned shell and can be refreshed or dismissed from the thread.',
    complete: 'The preview completed inside the host-owned shell.',
    error: 'No renderable HTML was found, so the host shell is presenting the fallback path instead.',
  } as const

  return (
    <ChatBridgeShell
      state={shellState}
      title="Embedded app shell"
      description={descriptions[shellState]}
      surfaceTitle="Generated HTML preview"
      surfaceDescription="The runtime surface stays inside the host-owned shell so loading, launch, and fallback remain part of the conversation."
      statusLabel={
        {
          loading: 'Loading',
          ready: 'Ready',
          active: 'Running',
          complete: 'Complete',
          error: 'Fallback',
        }[shellState]
      }
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
      {preview && hasRenderableHtml ? <Artifact htmlCode={htmlCode} reloadSign={reloadSign} /> : null}
    </ChatBridgeShell>
  )
}

export function Artifact(props: { htmlCode: string; reloadSign?: number; className?: string }) {
  const { htmlCode, reloadSign, className } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const iframeOrigin = 'https://artifact-preview.chatboxai.app/preview'

  const sendIframeMsg = (type: 'html', code: string) => {
    if (!ref.current) {
      return
    }
    ref.current.contentWindow?.postMessage({ type, code }, '*')
  }
  // 当 reloadSign 改变时，重新加载 iframe 内容
  useEffect(() => {
    ;(async () => {
      sendIframeMsg('html', '')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      sendIframeMsg('html', htmlCode)
    })()
  }, [reloadSign])

  // 当 htmlCode 改变时，防抖地刷新 iframe 内容
  const updateIframe = debounce(() => {
    sendIframeMsg('html', htmlCode)
  }, 300)
  useEffect(() => {
    updateIframe()
    return () => updateIframe.cancel()
  }, [htmlCode])

  return (
    <iframe
      className={cn('w-full', 'border-none', 'h-[400px]', className)}
      sandbox="allow-scripts allow-forms"
      src={iframeOrigin}
      ref={ref}
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
