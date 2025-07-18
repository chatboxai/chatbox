import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { a11yDark, atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import * as toastActions from '../stores/toastActions'
import { sanitizeUrl } from '@braintree/sanitize-url'
import * as latex from '../packages/latex'
import * as codeblockStateRecorder from '../packages/codeblock_state_recorder'
import { useSetAtom } from 'jotai'
import * as atoms from '../stores/atoms'
import { isRenderableCodeLanguage } from './Artifact'

import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you
import { copyToClipboard } from '@/packages/navigator'
import { MessageMermaid, SVGPreview } from './Mermaid'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import PlayCircleIcon from '@mui/icons-material/PlayCircle'
import NiceModal from '@ebay/nice-modal-react'
import { MessageCitation } from '../../shared/types'

export default function Markdown(props: {
  children: string
  enableLaTeXRendering?: boolean
  enableMermaidRendering?: boolean
  hiddenCodeCopyButton?: boolean
  className?: string
  generating?: boolean
  preferCollapsedCodeBlock?: boolean
  citations?: MessageCitation[]
}) {
  const {
    children,
    enableLaTeXRendering = true,
    enableMermaidRendering = true,
    hiddenCodeCopyButton,
    preferCollapsedCodeBlock,
    className,
    generating,
    citations,
  } = props

  // Append sources to the text content
  const contentWithSources = useMemo(() => {
    let content = children

    if (citations && citations.length > 0) {
      // Add sources section to the end of the content
      content += '\n\nSources:\n'
      citations.forEach((citation) => {
        content += `[${citation.number}] ${citation.url}\n`
      })
    }

    return content
  }, [children, citations])

  return useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={enableLaTeXRendering ? [remarkGfm, remarkMath, remarkBreaks] : [remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeKatex]}
        className={`break-words ${className || ''}`}
        // react-markdown 默认的 defaultUrlTransform 会错误地编码 URL 中的 Query，比如 & 会被编码成 &amp;
        // 这里改用 sanitizeUrl 库，同时也可以避免 XSS 攻击
        urlTransform={(url) => sanitizeUrl(url)}
        components={{
          code: (props: any) =>
            CodeRenderer({
              ...props,
              hiddenCodeCopyButton,
              enableMermaidRendering,
              generating,
              preferCollapsedCodeBlock,
            }),
          a: ({ node, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.stopPropagation()
              }}
            />
          ),
        }}
      >
        {enableLaTeXRendering ? latex.processLaTeX(contentWithSources) : contentWithSources}
      </ReactMarkdown>
    ),
    [
      contentWithSources,
      enableLaTeXRendering,
      enableMermaidRendering,
      hiddenCodeCopyButton,
      generating,
      preferCollapsedCodeBlock,
      className,
    ]
  )
}

export function CodeRenderer(props: {
  children: string
  className?: string
  hiddenCodeCopyButton?: boolean
  generating?: boolean
  enableMermaidRendering?: boolean
  preferCollapsedCodeBlock?: boolean
}) {
  const theme = useTheme()
  return useMemo(() => {
    const { children, className, hiddenCodeCopyButton, generating, enableMermaidRendering, preferCollapsedCodeBlock } =
      props
    const language = /language-(\w+)/.exec(className || '')?.[1] || 'text'
    if (!String(children).includes('\n')) {
      return <InlineCode children={children} className={className} />
    }
    if (language === 'mermaid' && enableMermaidRendering) {
      return <MessageMermaid source={String(children)} theme={theme.palette.mode} generating={generating} />
    }
    if (
      language === 'svg' ||
      (language === 'text' && String(children).startsWith('<svg')) ||
      (language === 'xml' && String(children).startsWith('<svg')) ||
      (language === 'html' && String(children).startsWith('<svg'))
    ) {
      return (
        <div>
          <BlockCode
            children={children}
            hiddenCodeCopyButton={hiddenCodeCopyButton}
            language={language}
            preferCollapsed={true}
            generating={generating}
          />
          <SVGPreview xmlCode={String(children)} className="max-w-sm" generating={generating} />
        </div>
      )
    }
    return (
      <BlockCode
        children={children}
        hiddenCodeCopyButton={hiddenCodeCopyButton}
        language={language}
        preferCollapsed={preferCollapsedCodeBlock}
        generating={generating}
      />
    )
  }, [props.children, theme.palette.mode, props.enableMermaidRendering])
}

function InlineCode(props: { children: string; className?: string }) {
  const { children, className } = props
  const theme = useTheme()
  return (
    <code
      className={className}
      style={{
        backgroundColor: theme.palette.mode === 'dark' ? '#333' : '#f1f1f1',
        padding: '2px 4px',
        margin: '0 4px',
        borderRadius: '4px',
        border: '1px solid',
        borderColor: theme.palette.mode === 'dark' ? '#444' : '#ddd',
      }}
    >
      {children}
    </code>
  )
}

function BlockCode(props: {
  language: string
  children: string
  hiddenCodeCopyButton?: boolean
  preferCollapsed?: boolean
  generating?: boolean
}) {
  const { children, hiddenCodeCopyButton, preferCollapsed, language, generating } = props
  const theme = useTheme()
  const { t } = useTranslation()

  const initialState = useMemo(
    () =>
      codeblockStateRecorder.needCollapse({
        content: String(children),
        language,
        generating,
        preferCollapsed,
      }),
    []
  )
  const [collapsedState, setCollapsedState] = useState<codeblockStateRecorder.CodeblockState>(initialState)
  useEffect(() => {
    if (generating) {
      codeblockStateRecorder.saveState({
        content: String(children),
        language,
        generating,
        preferCollapsed,
        collapsed: false, // 如果重新生成消息，那么这个代码快应该保持展开的状态
      })
    }
  }, [generating])

  const languageName = useMemo(() => {
    return language.toUpperCase()
  }, [language])
  const isRenderableCode = useMemo(() => isRenderableCodeLanguage(language), [language])

  const onClickCollapse = (event: React.MouseEvent) => {
    event.stopPropagation() // 优化搜索窗口中的展开逻辑
    event.preventDefault()
    const newState = codeblockStateRecorder.saveState({
      collapsed: !collapsedState.collapsed,
      content: String(children),
      language,
      generating,
      preferCollapsed,
    })
    setCollapsedState(newState)
  }
  const onClickCopy = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation() // 优化搜索窗口中的展开逻辑
      event.preventDefault()
      copyToClipboard(String(children))
      toastActions.add(t('copied to clipboard'))
    },
    [children]
  )
  const onClickArtifact = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation() // 优化搜索窗口中的展开逻辑
      event.preventDefault()
      NiceModal.show('artifact-preview', {
        htmlCode: String(children),
      })
    },
    [children]
  )

  return (
    <div>
      <div
        className="py-0.5 px-1"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          width: '100%',
          backgroundColor: 'rgb(50, 50, 50)',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          borderTopLeftRadius: '0.3rem',
          borderTopRightRadius: '0.3rem',
          borderBottomLeftRadius: '0',
          borderBottomRightRadius: '0',
        }}
      >
        <div className="flex items-center">
          <span
            className="text-gray-400/30 mx-1"
            style={{
              fontSize: theme.typography.body1.fontSize,
            }}
          >
            {languageName}
          </span>
        </div>
        <div className="flex items-center">
          {collapsedState.shouldCollapse &&
            (collapsedState.collapsed ? (
              <ArrowForwardIosIcon
                className="cursor-pointer text-white opacity-30 hover:bg-gray-800 hover:opacity-100 mx-1"
                fontSize="small"
                onClick={onClickCollapse}
              />
            ) : (
              <ArrowForwardIosIcon
                className="cursor-pointer text-white opacity-30 hover:bg-gray-800 hover:opacity-100 mx-1 rotate-90"
                fontSize="small"
                onClick={onClickCollapse}
              />
            ))}
          {isRenderableCode && (
            <PlayCircleIcon
              className="cursor-pointer text-white opacity-30 hover:bg-gray-800 hover:opacity-100 mx-1"
              fontSize="small"
              onClick={onClickArtifact}
            />
          )}
          {!hiddenCodeCopyButton && (
            <ContentCopyIcon
              className="cursor-pointer text-white opacity-30 hover:bg-gray-800 hover:opacity-100 mx-1"
              fontSize="small"
              onClick={onClickCopy}
            />
          )}
        </div>
      </div>
      <div style={{ position: 'relative' }} className="group">
        <div className={collapsedState.collapsed ? 'max-h-28 overflow-hidden' : ''}>
          <SyntaxHighlighter
            children={children}
            style={theme.palette.mode === 'dark' ? atomDark : a11yDark}
            language={language}
            PreTag="div"
            customStyle={{
              marginTop: '0',
              margin: '0',
              borderTopLeftRadius: '0',
              borderTopRightRadius: '0',
              borderBottomLeftRadius: '0.3rem',
              borderBottomRightRadius: '0.3rem',
              border: 'none',
            }}
          />
        </div>
        {collapsedState.collapsed && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '80px',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-end',
              cursor: 'pointer',
            }}
            onClick={onClickCollapse}
          >
            <span className="text-white mb-2 font-bold">{t('Show all ({{x}})', { x: collapsedState.lines })}</span>
          </div>
        )}
        {!collapsedState.collapsed && collapsedState.shouldCollapse && (
          <span
            className="
                                absolute bottom-0 left-0 right-0 w-12 mx-auto
                                cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity duration-300
                                text-white font-bold bg-slate-600/80 py-0 px-4 rounded-t-md"
            onClick={onClickCollapse}
          >
            <ExpandLessIcon className="text-white" fontSize="small" />
          </span>
        )}
      </div>
    </div>
  )
}
