import React, { useMemo } from 'react'
import { useSetAtom } from 'jotai'
import { ListItemText, MenuItem, Avatar, IconButton, Typography, ListItemIcon, useTheme } from '@mui/material'
import { Session } from '../../shared/types'
import CopyIcon from '@mui/icons-material/CopyAll'
import EditIcon from '@mui/icons-material/Edit'
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import MoreHorizOutlinedIcon from '@mui/icons-material/MoreHorizOutlined'
import DeleteIcon from '@mui/icons-material/Delete'
import StyledMenu from './StyledMenu'
import { useTranslation } from 'react-i18next'
import * as sessionActions from '../stores/sessionActions'
import * as atoms from '@/stores/atoms'
import { cn } from '@/lib/utils'
import StarIcon from '@mui/icons-material/Star'

export interface Props {
    session: Session
    selected: boolean
}

function _SessionItem(props: Props) {
    const { session, selected } = props
    const { t } = useTranslation()
    const setChatConfigDialogSession = useSetAtom(atoms.chatConfigDialogAtom)
    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null)
    const open = Boolean(anchorEl)
    const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
        event.stopPropagation()
        event.preventDefault()
        setAnchorEl(event.currentTarget)
    }
    const handleMenuClose = () => {
        setAnchorEl(null)
    }
    const onClick = () => {
        sessionActions.switchCurrentSession(session.id)
    }

    const handleStarred = () => {
        session.starred = !session.starred
        sessionActions.modify(session)
        handleMenuClose()
    }

    const theme = useTheme()
    const medianSize = theme.typography.pxToRem(24)
    // const smallSize = theme.typography.pxToRem(20)
    return (
        <>
            <MenuItem
                key={session.id}
                selected={selected}
                onClick={onClick}
                sx={{ padding: '0.1rem', margin: '0.1rem' }}
                className='group/session-item'
            >
                <ListItemIcon>
                    <IconButton color={'inherit'} onClick={session.starred ? handleStarred : onClick}>
                        {session.picUrl ? (
                            <Avatar sizes={medianSize} sx={{ width: medianSize, height: medianSize }} src={session.picUrl} />
                        ) : (
                            session.starred ? <StarIcon fontSize="small" /> : <ChatBubbleOutlineOutlinedIcon fontSize="small" />
                        )}
                    </IconButton>
                </ListItemIcon>
                <ListItemText>
                    <Typography variant="inherit" noWrap>
                        {session.name}
                    </Typography>
                </ListItemText>
                <span className={cn(anchorEl ? 'inline-flex' : 'hidden group-hover/session-item:inline-flex')}>
                    <IconButton onClick={handleMenuClick} sx={{ color: 'primary.main' }}>
                        <MoreHorizOutlinedIcon fontSize="small" />
                    </IconButton>
                </span>
            </MenuItem>
            <StyledMenu
                MenuListProps={{
                    'aria-labelledby': 'long-button',
                }}
                anchorEl={anchorEl}
                open={open}
                onClose={handleMenuClose}
            >
                <MenuItem
                    key={session.id + 'star'}
                    onClick={() => {
                        handleStarred()
                    }}
                    disableRipple
                >
                    <StarIcon fontSize="small" />
                    {session.starred? t('unstar') : t('star')}
                </MenuItem>
                <MenuItem
                    key={session.id + 'edit'}
                    onClick={() => {
                        setChatConfigDialogSession(session)
                        handleMenuClose()
                    }}
                    disableRipple
                >
                    <EditIcon fontSize="small" />
                    {t('edit')}
                </MenuItem>

                <MenuItem
                    key={session.id + 'copy'}
                    onClick={() => {
                        sessionActions.copy(session)
                        handleMenuClose()
                    }}
                    disableRipple
                >
                    <CopyIcon fontSize="small" />
                    {t('copy')}
                </MenuItem>

                <MenuItem
                    key={session.id + 'del'}
                    onClick={() => {
                        setAnchorEl(null)
                        handleMenuClose()
                        sessionActions.remove(session)
                    }}
                    disableRipple
                    sx={{
                        '&:hover': {
                            backgroundColor: 'rgba(255, 0, 0, 0.1)',
                        },
                    }}
                >
                    <DeleteIcon fontSize="small" />
                    {t('delete')}
                </MenuItem>
            </StyledMenu>
        </>
    )
}

export default function Session(props: Props) {
    return useMemo(() => {
        return <_SessionItem {...props} />
    }, [props.session, props.selected])
}
