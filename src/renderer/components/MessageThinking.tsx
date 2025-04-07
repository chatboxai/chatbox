import { useState, useEffect } from 'react'
import { useTheme } from '@mui/material'
import { useTranslation } from 'react-i18next'
import Markdown from '@/components/Markdown'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import { Message } from '../../shared/types'

export default function MessageThinking(props: {
    msg: Message
}) {
    const { t } = useTranslation()
    const theme = useTheme()

    const [isCollapsed, setIsCollapsed] = useState(true)
    const [thinkContent, setThinkContent] = useState('')
    const [remainingContent, setRemainingContent] = useState('')
    const [thinkStartTime, setThinkStartTime] = useState<number>(0)
    const [hasClosingTag, setHasClosingTag] = useState(false)

    useEffect(() => {
        const thinkMatch = props.msg.content.match(/<think>([\s\S]*?)(<\/think>|$)/)

        if (thinkMatch) {
            const fullMatch = thinkMatch[0]
            const extractedThink = thinkMatch[1]

            setThinkContent(extractedThink)
            setRemainingContent(props.msg.content.replace(fullMatch, '').trim())
        } else {
            setThinkContent('')
            setRemainingContent(props.msg.content)
            setHasClosingTag(false)
        }
    }, [props.msg.content])

    const currentThinkDuration = props.msg.thinkingDuration === undefined ? 0 : props.msg.thinkingDuration

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms}ms`
        return `${(ms / 1000).toFixed(2)}s`
    }

    if (!thinkContent) return <Markdown>{props.msg.content}</Markdown>

    return (
        <>
            <div className="think-section" style={{
                margin: '0.5rem 0',
                padding: '0.5rem',
                backgroundColor: theme.palette.mode === 'dark'
                    ? 'rgba(255,255,255,0.1)'
                    : 'rgba(0,0,0,0.05)',
                borderRadius: '4px'
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    color: theme.palette.mode === 'dark'
                        ? '#90caf9'
                        : '#1976d2',
                }} onClick={() => setIsCollapsed(!isCollapsed)}>
                    {currentThinkDuration > 0 && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.75rem',
                            opacity: 0.8
                        }}>
                            <AccessTimeIcon fontSize="small" />
                            <span>{formatDuration(currentThinkDuration)}</span>
                        </div>
                    )}

                    <span style={{ fontWeight: 500 }}>{t('Thinking')}</span>
                    {isCollapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
                </div>

                {!isCollapsed && (
                    <>
                        <Markdown
                            className="think-content"
                            hiddenCodeCopyButton={true}
                        >
                            {thinkContent}
                        </Markdown>
                        <ExpandLessIcon
                            fontSize="small"
                            style={{
                                color: theme.palette.mode === 'dark'
                                    ? '#90caf9'
                                    : '#1976d2',
                            }}
                            onClick={()=>{setIsCollapsed(!isCollapsed)}}
                        />
                    </>
                )}
            </div>
            <Markdown>{remainingContent}</Markdown>
        </>
    )
}