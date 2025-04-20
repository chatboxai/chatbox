import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@mui/material'
import { useMemo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { a11yDark, atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import * as toastActions from '../stores/toastActions'
import { sanitizeUrl } from '@braintree/sanitize-url'

import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you
import { copyToClipboard } from '@/packages/navigator'
import platform from '@/packages/platform'

export default function Markdown(props: {
    children: string
    hiddenCodeCopyButton?: boolean
    className?: string
}) {
    const { children, hiddenCodeCopyButton, className } = props
    return useMemo(() => (
        <ReactMarkdown
            remarkPlugins={
                [remarkGfm, remarkMath, remarkBreaks]
            }
            rehypePlugins={[rehypeKatex]}
            className={`break-words ${className || ''}`}
            urlTransform={(url) => sanitizeUrl(url)}
            components={{
                table: (props: any) => Table({...props}),
                code: (props: any) => CodeBlock({ ...props, hiddenCodeCopyButton }),
                a: ({ node, ...props }) => (
                    <a
                        {...props}
                        target="_blank"
                        rel="noreferrer"
                        onClick={async (e) => {
                            e.stopPropagation()
                            if (props.href) await platform.openLink(props.href);
                        }}
                    />
                ),
            }}
        >
            { children }
        </ReactMarkdown>
    ), [children])
}

export function Table(props: any){
    const { t } = useTranslation()
    const theme = useTheme()
    return useMemo(() => {
        return (
            <div style={{
                overflowX: 'auto',
            }}>
                <table {...props} />
            </div>
        )
    },[props.children, theme.palette.mode])
}

export function CodeBlock(props: any) {
    const { t } = useTranslation()
    const theme = useTheme()
    return useMemo(() => {
        const { children, className, node, hiddenCodeCopyButton, ...rest } = props
        const match = /language-(\w+)/.exec(className || '')
        const language = match?.[1] || 'text'
        if (!String(children).includes('\n')) {
            return (
                <code
                    {...rest}
                    className={className}
                    style={{
                        backgroundColor: theme.palette.mode === 'dark' ? '#333' : '#f1f1f1',
                        padding: '2px 4px',
                        marigin: '0 4px',
                        borderRadius: '4px',
                        border: '1px solid',
                        borderColor: theme.palette.mode === 'dark' ? '#444' : '#ddd',
                    }}
                >
                    {children}
                </code>
            )
        }
        return (
            <div>
                <div
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
                    <span
                        style={{
                            textDecoration: 'none',
                            color: 'gray',
                            padding: '2px',
                            margin: '2px 10px 0 10px',
                        }}
                    >
                        {'<' + language.toUpperCase() + '>'}
                    </span>
                    {
                        !hiddenCodeCopyButton && (
                            <ContentCopyIcon
                                sx={{
                                    textDecoration: 'none',
                                    color: 'white',
                                    padding: '1px',
                                    margin: '2px 10px 0 10px',
                                    cursor: 'pointer',
                                    opacity: 0.5,
                                    ':hover': {
                                        backgroundColor: 'rgb(80, 80, 80)',
                                        opacity: 1,
                                    },
                                }}
                                onClick={() => {
                                    copyToClipboard(String(children))
                                    toastActions.add(t('copied to clipboard'))
                                }}
                            />
                        )
                    }
                </div>
                <SyntaxHighlighter
                    children={String(children).replace(/\n$/, '')}
                    style={
                        theme.palette.mode === 'dark'
                            ? atomDark
                            : a11yDark
                    }
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
        )
    }, [props.children, theme.palette.mode])
}
