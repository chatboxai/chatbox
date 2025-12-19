import { sanitizeUrl } from '@braintree/sanitize-url'
import { useTheme } from '@mui/material'
import {
  createContext,
  type ElementType,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import rehypeKatex from 'rehype-katex'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import * as latex from '../packages/latex'
import { isRenderableCodeLanguage } from './Artifact'
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Loader, Stack, Text, Tooltip, useComputedColorScheme } from '@mantine/core'
import {
  IconBrandCpp,
  IconBrandCSharp,
  IconBrandCss3,
  IconBrandDocker,
  IconBrandGolang,
  IconBrandJavascript,
  IconBrandKotlin,
  IconBrandPhp,
  IconBrandPowershell,
  IconBrandPython,
  IconBrandReact,
  IconBrandRust,
  IconBrandSass,
  IconBrandSwift,
  IconBrandTypescript,
  IconBrandVue,
  IconCheck,
  IconChevronRight,
  IconCode,
  IconCopy,
  IconFileTypeCsv,
  IconFileTypeHtml,
  IconFileTypeSql,
  IconFileTypeSvg,
  IconFileTypeTxt,
  IconFileTypeXml,
  IconJson,
  IconPlayerPlayFilled,
  type IconProps,
  IconWorldUpload,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { visit } from 'unist-util-visit'
import { useCopied } from '@/hooks/useCopied'
import { deployHtmlToEdgeOne } from '../packages/edgeone'
import * as toastActions from '../stores/toastActions'
import IconDart from './icons/Dart'
import IconJava from './icons/Java'
import { MessageMermaid, SVGPreview } from './Mermaid'
import { ScalableIcon } from './ScalableIcon'

const CODE_BLOCK_COLLAPSE_LINE_THRESHOLD = 7

function remarkAddCodeIndex() {
  // biome-ignore lint/suspicious/noExplicitAny: remark AST nodes lack a friendly type here
  return (tree: any) => {
    let counter = 0
    visit(tree, 'code', (node) => {
      node.data = node.data || {}
      node.data.hProperties = node.data.hProperties || {}
      node.data.hProperties['data-code-index'] = counter++
    })
  }
}

function Markdown(props: {
  children: string
  uniqueId?: string
  enableLaTeXRendering?: boolean
  enableMermaidRendering?: boolean
  hiddenCodeCopyButton?: boolean
  className?: string
  generating?: boolean
}) {
  const {
    children,
    uniqueId,
    enableLaTeXRendering = true,
    enableMermaidRendering = true,
    hiddenCodeCopyButton,
    className,
    generating,
  } = props

  const codeFences = useMemo(() => (children.match(/```/g) || []).length, [children])
  const generatingCodeIndex = useMemo(() => (codeFences % 2 === 0 ? -1 : Math.floor(codeFences / 2)), [codeFences])

  return (
    <ReactMarkdown
      remarkPlugins={
        enableLaTeXRendering
          ? [remarkGfm, remarkMath, remarkBreaks, remarkAddCodeIndex]
          : [remarkGfm, remarkBreaks, remarkAddCodeIndex]
      }
      rehypePlugins={[rehypeKatex]}
      className={`break-words ${className || ''}`}
      // react-markdown's default defaultUrlTransform will incorrectly encode query parameters in URLs (e.g. & becomes &amp;)
      // Use sanitizeUrl here to avoid that and to prevent XSS attacks
      urlTransform={(url) => sanitizeUrl(url)}
      components={useMemo(
        () => ({
          // biome-ignore lint/suspicious/noExplicitAny: react-markdown code component props are loosely typed
          code: (props: any) => {
            const codeIndex = typeof props['data-code-index'] === 'number' ? props['data-code-index'] : -1
            return (
              <CodeRenderer
                {...props}
                uniqueId={uniqueId ? `${uniqueId}-code-${codeIndex}` : undefined}
                hiddenCodeCopyButton={hiddenCodeCopyButton}
                enableMermaidRendering={enableMermaidRendering}
                generating={generating && generatingCodeIndex === codeIndex}
              />
            )
          },
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
        }),
        [uniqueId, hiddenCodeCopyButton, enableMermaidRendering, generating, generatingCodeIndex]
      )}
    >
      {enableLaTeXRendering ? latex.processLaTeX(children) : children}
    </ReactMarkdown>
  )
}

export default memo(Markdown)

export const CodeRenderer = memo(
  (props: {
    children: string
    className?: string
    uniqueId?: string
    hiddenCodeCopyButton?: boolean
    generating?: boolean
    enableMermaidRendering?: boolean
  }) => {
    const theme = useTheme()
    const { children, className, hiddenCodeCopyButton, generating, enableMermaidRendering } = props
    const language = /language-(\w+)/.exec(className || '')?.[1] || 'text'
    if (!String(children).includes('\n')) {
      return <InlineCode className={className}>{children}</InlineCode>
    }
    if (language === 'mermaid' && enableMermaidRendering) {
      return <MessageMermaid source={String(children)} theme={theme.palette.mode} generating={generating} />
    }

    return (
      <>
        <BlockCode
          uniqueId={props.uniqueId}
          hiddenCodeCopyButton={hiddenCodeCopyButton}
          language={language}
          generating={generating}
        >
          {children}
        </BlockCode>
        {language === 'svg' ||
        (language === 'text' && String(children).startsWith('<svg')) ||
        (language === 'xml' && String(children).startsWith('<svg')) ||
        (language === 'html' && String(children).startsWith('<svg')) ? (
          <SVGPreview xmlCode={String(children)} className="max-w-sm" generating={generating} />
        ) : null}
      </>
    )
  }
)

const InlineCode = memo((props: { children: string; className?: string }) => {
  const { children, className } = props
  return (
    <code
      className={clsx(
        'bg-chatbox-background-secondary border border-solid border-chatbox-border-secondary rounded-sm px-1 py-0.5 mx-1',
        className
      )}
    >
      {children}
    </code>
  )
})

// Define the Context type
interface BlockCodeCollapsedStateContextType {
  collapsedStates: Record<string, boolean>
  toggleCollapse: (id: string) => void
  setCollapse: (id: string, collapsed: boolean) => void
  isCollapsed: (id: string) => boolean
  resetAll: () => void
}

// Create the Context
const BlockCodeCollapsedStateContext = createContext<BlockCodeCollapsedStateContextType | undefined>(undefined)

// Provider Props type
interface BlockCodeCollapsedStateProviderProps {
  children: ReactNode
  defaultCollapsed?: boolean // default collapsed state
}

// Provider component
export const BlockCodeCollapsedStateProvider: React.FC<BlockCodeCollapsedStateProviderProps> = ({
  children,
  defaultCollapsed = false,
}) => {
  const [collapsedStates, setCollapsedStates] = useState<Record<string, boolean>>({})

  // Toggle collapse state
  const toggleCollapse = useCallback(
    (id: string) => {
      setCollapsedStates((prev) => ({
        ...prev,
        [id]: typeof prev[id] === 'boolean' ? !prev[id] : !defaultCollapsed,
      }))
    },
    [defaultCollapsed]
  )

  // Set specific collapse state
  const setCollapse = useCallback((id: string, collapsed: boolean) => {
    setCollapsedStates((prev) => ({
      ...prev,
      [id]: collapsed,
    }))
  }, [])

  // Check if collapsed
  const isCollapsed = useCallback(
    (id: string) => collapsedStates[id] ?? defaultCollapsed,
    [collapsedStates, defaultCollapsed]
  )

  // Reset all states
  const resetAll = useCallback(() => {
    setCollapsedStates({})
  }, [])

  const value: BlockCodeCollapsedStateContextType = useMemo(
    () => ({
      collapsedStates,
      toggleCollapse,
      setCollapse,
      isCollapsed,
      resetAll,
    }),
    [collapsedStates, toggleCollapse, setCollapse, isCollapsed, resetAll]
  )

  return <BlockCodeCollapsedStateContext.Provider value={value}>{children}</BlockCodeCollapsedStateContext.Provider>
}

// Custom hook
export const useBlockCodeCollapsedState = (messageId: string) => {
  const context = useContext(BlockCodeCollapsedStateContext)

  if (context === undefined) {
    throw new Error('useBlockCodeCollapsedState must be used within a BlockCodeCollapsedStateProvider')
  }

  if (!messageId) {
    console.warn('useBlockCodeCollapsedState: messageId is empty, collapse state may not work correctly')
  }

  return {
    collapsed: context.isCollapsed(messageId),
    toggleCollapsed: () => context.toggleCollapse(messageId),
    setCollapsed: (collapsed: boolean) => context.setCollapse(messageId, collapsed),
  }
}

type BlockCodeProps = {
  language: string
  children: string
  uniqueId?: string
  hiddenCodeCopyButton?: boolean
  generating?: boolean
}

const CodeIcons: { [key: string]: ElementType<IconProps> } = {
  HTML: IconFileTypeHtml,
  XML: IconFileTypeXml,
  JSON: IconJson,
  CSS: IconBrandCss3,
  SASS: IconBrandSass,
  SCSS: IconBrandSass,
  CSV: IconFileTypeCsv,
  SVG: IconFileTypeSvg,
  TEXT: IconFileTypeTxt,
  JAVASCRIPT: IconBrandJavascript,
  JS: IconBrandJavascript,
  TYPESCRIPT: IconBrandTypescript,
  TS: IconBrandTypescript,
  JSX: IconBrandReact,
  TSX: IconBrandReact,
  VUE: IconBrandVue,
  JAVA: IconJava,
  SWIFT: IconBrandSwift,
  KOTLIN: IconBrandKotlin,
  PYTHON: IconBrandPython,
  PY: IconBrandPython,
  PHP: IconBrandPhp,
  GO: IconBrandGolang,
  GOLANG: IconBrandGolang,
  CPP: IconBrandCpp,
  CSHARP: IconBrandCSharp,
  RUST: IconBrandRust,
  BASH: IconBrandPowershell,
  SHELL: IconBrandPowershell,
  POWERSHELL: IconBrandPowershell,
  SQL: IconFileTypeSql,
  MYSQL: IconFileTypeSql,
  DOCKER: IconBrandDocker,
  DOCKERFILE: IconBrandDocker,
  DART: IconDart,
}

const BlockCode = memo(({ children, uniqueId, hiddenCodeCopyButton, language, generating }: BlockCodeProps) => {
  const { t } = useTranslation()
  const colorScheme = useComputedColorScheme()
  const languageName = useMemo(() => language.toUpperCase(), [language])
  const isRenderableCode = useMemo(() => isRenderableCodeLanguage(language), [language])
  const [deploying, setDeploying] = useState(false)
  const canDeploy = useMemo(() => isRenderableCode && String(children).trim().length > 0, [children, isRenderableCode])

  const icon = useMemo(() => CodeIcons[languageName] || IconCode, [languageName])

  const { copied, copy } = useCopied(String(children))
  const onClickCopy = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation() // Avoid triggering parent select behavior in search window
      event.preventDefault()
      copy()
    },
    [copy]
  )
  const onClickArtifact = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation() // Avoid triggering parent select behavior in search window
      event.preventDefault()
      NiceModal.show('artifact-preview', {
        htmlCode: String(children),
      }).catch(() => null)
    },
    [children]
  )

  const onClickDeploy = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      if (!canDeploy) {
        return
      }
      setDeploying(true)
      try {
        const url = await deployHtmlToEdgeOne(String(children))
        await NiceModal.show('edgeone-deploy-success', { url })
      } catch (error) {
        toastActions.add((error as Error)?.message || t('Publish failed'))
      } finally {
        setDeploying(false)
      }
    },
    [canDeploy, children, t]
  )

  const needCollapse = useMemo(
    () => !!uniqueId && children.split('\n').length > CODE_BLOCK_COLLAPSE_LINE_THRESHOLD,
    [uniqueId, children]
  )
  const { collapsed, toggleCollapsed } = useBlockCodeCollapsedState(uniqueId || '')
  const onClickCollapse = (event: React.MouseEvent) => {
    event.stopPropagation() // Avoid triggering parent select behavior in search window
    event.preventDefault()
    toggleCollapsed()
  }

  return (
    <Stack gap={0}>
      <Flex
        justify="space-between"
        className={clsx(
          'p-xs bg-chatbox-background-secondary rounded-t-md border border-solid border-[var(--chatbox-border-primary)]',
          !needCollapse || !collapsed ? 'sticky top-0 z-10' : ''
        )}
      >
        <Flex align="center" gap="xs">
          {generating ? (
            <Loader size={10} />
          ) : (
            <ScalableIcon size={16} icon={icon} color="var(--chatbox-tint-tertiary)" />
          )}
          <Text span c="chatbox-tertiary" fw="600" className="font-mono">
            {languageName}
          </Text>
        </Flex>

        <Flex gap="xs" align="center">
          {!hiddenCodeCopyButton && (
            <Tooltip label={t('copy')} withArrow openDelay={1000}>
              <ActionIcon
                variant="transparent"
                color={copied ? 'chatbox-success' : 'chatbox-tertiary'}
                size={20}
                onClick={onClickCopy}
              >
                {copied ? <IconCheck /> : <IconCopy />}
              </ActionIcon>
            </Tooltip>
          )}

          {isRenderableCode && (
            <Tooltip label={t('Preview')} withArrow openDelay={1000}>
              <ActionIcon variant="transparent" color="chatbox-tertiary" size={20} onClick={onClickArtifact}>
                <IconPlayerPlayFilled />
              </ActionIcon>
            </Tooltip>
          )}

          {canDeploy && (
            <Tooltip label={t('Publish Webpage')} withArrow openDelay={1000}>
              <ActionIcon
                variant="transparent"
                color="chatbox-tertiary"
                size={20}
                onClick={onClickDeploy}
                disabled={deploying}
              >
                {deploying ? <Loader size={12} /> : <IconWorldUpload />}
              </ActionIcon>
            </Tooltip>
          )}

          {needCollapse && (
            <Tooltip label={collapsed ? t('Expand') : t('Collapse')} withArrow openDelay={1000}>
              <ActionIcon
                variant="transparent"
                color="chatbox-tertiary"
                size={20}
                onClick={onClickCollapse}
                className={clsx('transition-transform ease-linear', !collapsed ? 'rotate-90' : '')}
              >
                <IconChevronRight />
              </ActionIcon>
            </Tooltip>
          )}
        </Flex>
      </Flex>

      <Stack
        className={clsx(
          'border border-t-0 border-solid border-[var(--chatbox-border-primary)] rounded-b-md',
          needCollapse && collapsed ? 'h-[10rem]' : ''
        )}
      >
        <SyntaxHighlighter
          style={colorScheme !== 'light' ? oneDark : oneLight}
          language={language}
          PreTag="div"
          showLineNumbers
          customStyle={{
            marginTop: '0',
            margin: '0',
            borderTopLeftRadius: '0',
            borderTopRightRadius: '0',
            borderBottomLeftRadius: 'var(--chatbox-radius-md)',
            borderBottomRightRadius: 'var(--chatbox-radius-md)',
            border: 'none',
            background: 'transparent !important',
            ...(generating && needCollapse && collapsed
              ? {
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                }
              : {}),
          }}
          codeTagProps={{
            className: '!bg-transparent',
          }}
        >
          {children}
        </SyntaxHighlighter>
      </Stack>
    </Stack>
  )
})
