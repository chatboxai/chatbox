import { useEffect } from 'react'
import { Button, Typography, useTheme } from '@mui/material'
import * as atoms from '../stores/atoms'
import { useAtomValue, useSetAtom } from 'jotai'
import * as sessionActions from '../stores/sessionActions'
import Toolbar from './Toolbar'
import { cn } from '@/lib/utils'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import MenuOpenRoundedIcon from '@mui/icons-material/MenuOpenRounded';

interface Props {
    toggleSidebar: (newOpen: boolean) => void
}

export default function Header(props: Props) {
    const theme = useTheme()
    const currentSession = useAtomValue(atoms.currentSessionAtom)
    const setChatConfigDialogSession = useSetAtom(atoms.chatConfigDialogAtom)

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
                    onClick={editCurrentSession}
                    sx={{
                        flex: 1,
                        justifyContent: 'space-between',
                        minWidth: 'auto',
                        textTransform: 'none',
                        color: 'inherit',
                        padding: '8px 12px',
                        '&:hover': {
                            backgroundColor: theme.palette.action.hover
                        }
                    }}
                    className="truncate"
                >
                    <Typography
                        variant="h6"
                        noWrap
                        component="div"
                        sx={{
                            flex: 1,
                            textAlign: 'left',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}
                    >
                        {currentSession.name}
                    </Typography>

                </Button>

                <Toolbar />
            </div>
        </div>
    )
}
