import { Message  } from '../../shared/types'
import {
    Stack,
    useTheme,
    Tooltip,
    IconButton
} from '@mui/material'
import {
    Send,
    Close,
} from '@mui/icons-material'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as sessionActions from '@/stores/sessionActions'
import { cn } from '@/lib/utils'
import TextareaAutosize from 'react-textarea-autosize';
import platform from '@/packages/platform'
import { createMessage } from '../../shared/types'

export interface Props {
    msg: Message
    sessionId: string
    setEditMessage: (show: boolean) => void
}

export default function MessageEdit(props: Props) {

    const {msg, sessionId, setEditMessage} = props

    const theme = useTheme()
    const { t } = useTranslation()

    const [messageInput, setMessageInput] = React.useState(msg.content)
    const [isMobile, setIsMobile] = useState(false)

    const onMessageInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const input = event.target.value
        setMessageInput(input)
    }

    useMemo(async () => {
        setIsMobile( await platform.isMobile())
    },[])

    const handleEditMessage = async () => {
        if (messageInput.trim() === '') {
            return
        }

        const newMessage= createMessage('user',messageInput)
        await sessionActions.editMessage({
            msgId: msg.id,
            newMessage: newMessage,
            sessionId: sessionId,
        })
    }

    const  onKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // on iOS and Android enter will behave as newline instead.
        if (event.key === 'Enter' && isMobile) {
            return
        }

        if (event.key === 'Escape') {
            setEditMessage(false)
            return
        }

        if (
            event.keyCode === 13 &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey
        ) {
            event.preventDefault()
            await handleEditMessage()
            return
        }
    }

    return (
        <>
            <TextareaAutosize
                className={cn(
                    'w-full overflow-y-auto resize-none outline-none',
                    'bg-transparent p-1'
                )}
                maxRows={15}
                onChange={onMessageInput}
                onKeyDown={onKeyDown}
                style={{
                    color: theme.palette.text.primary,
                    fontFamily: theme.typography.fontFamily,
                    fontSize: theme.typography.body1.fontSize,
                }}
                value={messageInput}
            />
            <Stack direction="row" spacing={0}>
                <Tooltip
                    title={"Cancel"}
                    sx={{
                        backgroundColor: theme.palette.background.paper,
                    }}
                    arrow
                >
                    <IconButton
                        size="small"
                        onClick={() => setEditMessage(false)}
                        color={'error'}
                    >
                        <Close fontSize={'inherit'} />
                    </IconButton>
                </Tooltip>
                <Tooltip
                    title={"Send"}
                    sx={{
                        backgroundColor: theme.palette.background.paper,
                    }}
                    arrow
                >
                    <IconButton
                        size="small"
                        onClick={ async () =>  handleEditMessage()}
                        color={'primary'}
                    >
                        <Send fontSize={'inherit'} />
                    </IconButton>
                </Tooltip>
            </Stack>
        </>

    );
}