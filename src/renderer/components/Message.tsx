import React, { useEffect, useState, useRef } from 'react'
import Box from '@mui/material/Box'
import Avatar from '@mui/material/Avatar'
import {
    Typography,
    Grid,
    useTheme, MenuItem
} from '@mui/material'
import PersonIcon from '@mui/icons-material/Person'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import SettingsIcon from '@mui/icons-material/Settings'
import { useTranslation } from 'react-i18next'
import { Message, MessageInfo, SessionType } from '../../shared/types'
import { useAtomValue, useSetAtom } from 'jotai'
import {
    showMessageTimestampAtom,
    showModelNameAtom,
    showTokenCountAtom,
    showWordCountAtom,
    openSettingDialogAtom,
    enableMarkdownRenderingAtom,
} from '../stores/atoms'
import { currsentSessionPicUrlAtom, showTokenUsedAtom } from '../stores/atoms'
import * as scrollActions from '../stores/scrollActions'
import Markdown from '@/components/Markdown'
import '../static/Block.css'
import '../static/thinking.css'
import MessageErrTips from './MessageErrTips'
import * as dateFns from "date-fns"
import { cn } from '@/lib/utils'
import { estimateTokensFromMessages } from '@/packages/token'
import { countWord } from '@/packages/word-count'
import MessageThinking from '@/components/MessageThinking'
import { modifyMessage } from '@/stores/sessionActions'
import * as atoms from '@/stores/atoms'
import { useAtom } from 'jotai/index'
import LoadingSpinner from '@/components/LoadingSpinner'
import StarIcon from '@mui/icons-material/Star'
import StyledMenu from './StyledMenu'
import Tooltip from '@mui/material/Tooltip';
import { CachedRounded,InfoOutlined } from '@mui/icons-material'
import MessageActions from '@/components/MessageActions'

export interface Props {
    id?: string
    sessionId: string
    sessionType: SessionType
    msg: Message
    className?: string
    collapseThreshold?: number
    hiddenButtonGroup?: boolean
    small?: boolean
}

export default function Message(props: Props) {
    const { t } = useTranslation()
    const theme = useTheme()

    const showMessageTimestamp = useAtomValue(showMessageTimestampAtom)
    const showModelName = useAtomValue(showModelNameAtom)
    const showTokenCount = useAtomValue(showTokenCountAtom)
    const showWordCount = useAtomValue(showWordCountAtom)
    const showTokenUsed = useAtomValue(showTokenUsedAtom)
    const enableMarkdownRendering = useAtomValue(enableMarkdownRenderingAtom)
    const currentSessionPicUrl = useAtomValue(currsentSessionPicUrlAtom)
    const setOpenSettingWindow = useSetAtom(openSettingDialogAtom)
    const [messageListRef, setMessageListRef] = useAtom(atoms.messageListRefAtom)
    const [showLoadingIcon, setShowLoadingIcon] = useState(false)
    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null)

    const { msg, className, collapseThreshold, hiddenButtonGroup, small } = props

    const needCollapse = collapseThreshold
        && (JSON.stringify(msg.content)).length > collapseThreshold
        && (JSON.stringify(msg.content)).length - collapseThreshold > 50
    const [isCollapsed, setIsCollapsed] = useState(needCollapse)

    const ref = useRef<HTMLDivElement>(null)
    const tips: string[] = []
    if (props.sessionType === 'chat' || !props.sessionType) {
        if (showWordCount && !msg.generating) {
            tips.push(`word count: ${msg.wordCount !== undefined ? msg.wordCount : countWord(msg.content)}`)
        }
        if (showTokenCount && !msg.generating) {
            if (msg.tokenCount === undefined) {
                msg.tokenCount = estimateTokensFromMessages([msg])
            }
            tips.push(`token count: ${msg.tokenCount}`)
        }
        if (showTokenUsed && msg.role === 'assistant' && !msg.generating) {
            tips.push(`tokens used: ${msg.tokensUsed || 'unknown'}`)
        }
        if (showModelName && props.msg.role === 'assistant') {
            tips.push(`model: ${props.msg.model || 'unknown'}`)
        }
    }

    useEffect(()=>{
        if (msg.role === 'assistant' && (msg.content === '' || msg.error === '')){
            setShowLoadingIcon(true)
        } else {
            setShowLoadingIcon(false)
        }
    },[msg])

    const [isManualScroll, setIsManualScroll] = useState(false);
    const lastScrollTime = useRef(Date.now());

    useEffect(() => {
        if (!messageListRef?.current) return;

        const container = messageListRef.current;

        const handleScroll = () => {
            // Detect manual scrolls (within last 150ms)
            if (Date.now() - lastScrollTime.current > 150) {
                setIsManualScroll(true);
            }
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        if (msg.role === 'user'){
            scrollActions.scrollToBottom();
        }

        if (messageListRef?.current) {
            const { scrollTop, scrollHeight, clientHeight } = messageListRef.current;
            const bottomThreshold = 100;
            const distanceFromBottom = scrollHeight - (scrollTop + clientHeight)
            if (distanceFromBottom < bottomThreshold) {
                setIsManualScroll(false);
            }
            if (!isManualScroll && distanceFromBottom > bottomThreshold) {
                scrollActions.scrollToBottom()
                lastScrollTime.current = Date.now();
            }
        }
    }, [msg])

    let content = msg.content
    if (typeof msg.content !== 'string') {
        content = JSON.stringify(msg.content)
    }
    if (msg.generating) {
        content += '...'
    }
    if (needCollapse && isCollapsed) {
        content = msg.content.slice(0, collapseThreshold) + '... '
    }

    const CollapseButton = (
        <span
            className='cursor-pointer inline-block font-bold text-blue-500 hover:text-white hover:bg-blue-500'
            onClick={() => setIsCollapsed(!isCollapsed)}
        >
            [{isCollapsed ? t('Expand') : t('Collapse')}]
        </span>
    )

    return (
        <Box
            ref={ref}
            id={props.id}
            key={msg.id}
            className={cn(
                'group/message',
                'msg-block',
                'px-2',
                msg.generating ? 'rendering' : 'render-done',
                {
                    user: 'user-msg',
                    system: 'system-msg',
                    assistant: 'assistant-msg',
                }[msg?.role || 'user'],
                className,
            )}
            sx={{
                margin: '0',
                paddingBottom: '0.1rem',
                paddingX: '1rem',
                [theme.breakpoints.down('sm')]: {
                    paddingX: '0.3rem',
                },
            }}
        >
            <Grid container wrap="nowrap" spacing={1.5}>
                <Grid item>
                    <Box sx={{ marginTop: '8px' }}>
                        {
                            {
                                assistant: currentSessionPicUrl ? (
                                    <Avatar
                                        src={currentSessionPicUrl}
                                        sx={{
                                            width: '28px',
                                            height: '28px',
                                        }}
                                    />
                                ) : (
                                    <Avatar
                                        sx={{
                                            backgroundColor: theme.palette.primary.main,
                                            width: '28px',
                                            height: '28px',
                                        }}
                                    >
                                        <SmartToyIcon fontSize='small' />
                                    </Avatar>
                                ),
                                user: (
                                    <Avatar
                                        sx={{
                                            width: '28px',
                                            height: '28px',
                                        }}
                                        className='cursor-pointer'
                                        onClick={() => setOpenSettingWindow('chat')}
                                    >
                                        <PersonIcon fontSize='small' />
                                    </Avatar>
                                ),
                                system:
                                        <Avatar
                                            sx={{
                                                backgroundColor: theme.palette.warning.main,
                                                width: '28px',
                                                height: '28px',
                                            }}
                                        >
                                            <SettingsIcon fontSize='small' />
                                        </Avatar>
                            }[msg.role]
                        }
                    </Box>
                </Grid>
                <Grid item xs sm container sx={{ width: '0px', paddingRight: '15px' }}>
                    <Grid item xs>
                        <Box className={cn('msg-content', { 'msg-content-small': small })} sx={
                            small ? { fontSize: theme.typography.body2.fontSize } : {}
                        }>
                            {
                                showLoadingIcon && <LoadingSpinner speed={0.5} size={'15px'} />
                            }

                            {
                                enableMarkdownRendering && !isCollapsed ? (
                                    <MessageThinking
                                        msg={msg}
                                    />
                                ) : (
                                    <div>
                                        {content}
                                        {
                                            needCollapse && isCollapsed && (
                                                CollapseButton
                                            )
                                        }
                                    </div>
                                )
                            }
                        </Box>
                        <MessageErrTips msg={msg} />
                        {
                            needCollapse && !isCollapsed && CollapseButton
                        }
                        <MessageActions msg={msg}/>
                    </Grid>
                </Grid>
            </Grid>
        </Box>
    )
}
