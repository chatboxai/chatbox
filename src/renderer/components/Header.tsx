import React, { useEffect, useRef } from 'react'
import { Button, IconButton, Typography, useTheme } from '@mui/material'
import * as atoms from '../stores/atoms'
import { useAtomValue, useSetAtom } from 'jotai'
import * as sessionActions from '../stores/sessionActions'
import Toolbar from './Toolbar'
import { cn } from '@/lib/utils'
import MenuOpenRoundedIcon from '@mui/icons-material/MenuOpenRounded';
import { getDefaultStore } from 'jotai/index'
import { getModelName } from '@/packages/models'
import AddIcon from '@mui/icons-material/AddCircleOutline'
import { trackingEvent } from '@/packages/event'

interface Props {
    toggleSidebar: (newOpen: boolean) => void
    toggleModelSelect: (newOpen: boolean) => void
}

export default function Header(props: Props) {
    const theme = useTheme()
    const currentSession = useAtomValue(atoms.currentSessionAtom)
    const setChatConfigDialogSession = useSetAtom(atoms.chatConfigDialogAtom)
    const store = getDefaultStore()
    const settings = store.get(atoms.settingsAtom)

    const sessionListRef = useRef<HTMLDivElement>(null)
    const handleCreateNewSession = () => {
        sessionActions.createEmpty('chat')
        if (sessionListRef.current) {
            sessionListRef.current.scrollTo(0, 0)
        }
    }

    useEffect(() => {
        if (
            currentSession.name === 'Untitled'
            && currentSession.messages.length >= 2
        ) {
            sessionActions.generateName(currentSession.id)
            return 
        }
    }, [currentSession.messages.length])

    const editCurrentSession = () => {
        setChatConfigDialogSession(currentSession)
    }
    return (
        <div
            className="pt-3 pb-2 px-4"
            style={{
                borderBottomWidth: '1px',
                borderBottomStyle: 'solid',
                borderBottomColor: theme.palette.divider,
                padding: 5,
            }}
        >
            <div className={cn('w-full mx-auto flex flex-row items-center gap-2')}>
                <Button
                    onClick={() => props.toggleSidebar(true)}
                    sx={{
                        minWidth: 'auto',
                        padding: '4px',
                        margin: 0,
                        borderRadius: '50%',
                        '&:hover': {
                            backgroundColor: theme.palette.action.hover
                        }
                    }}
                >
                    <MenuOpenRoundedIcon sx={{ fontSize: '24px' }} />
                </Button>

                <Button
                    onClick={() => props.toggleModelSelect(true)}
                    sx={{
                        flex: 1,
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        minWidth: 'auto',
                        textTransform: 'none',
                        color: 'inherit',
                        padding: '8px 12px',
                        '&:hover': {
                            backgroundColor: theme.palette.action.hover
                        },
                        gap: '2px'
                    }}
                    className="truncate"
                >
                    <Typography
                        variant="body2"
                        noWrap
                        component="div"
                        sx={{
                            width: '100%',
                            textAlign: 'left',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            color: theme.palette.text.secondary
                        }}
                    >
                        {settings.modelProvider}
                    </Typography>
                    <Typography
                        variant="h6"
                        noWrap
                        component="div"
                        sx={{
                            width: '100%',
                            textAlign: 'left',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            lineHeight: 1.3
                        }}
                    >
                        {settings?.modelProviderList?.find((provider) => (provider.uuid === settings.modelProviderID))?.selectedModel}
                    </Typography>
                </Button>
                <IconButton>
                    <AddIcon fontSize="small" />
                </IconButton>
                <Toolbar />
            </div>
        </div>
    )

}
