import React, { useEffect, useRef } from 'react';
import './App.css';
import {
    ListItemText, ListItemAvatar, MenuItem, Divider,
    Avatar, IconButton, Button, TextField, Popper, Fade, Typography, ListItemIcon,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { Session } from './types'
import FileCopyIcon from '@mui/icons-material/FileCopy';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import MoreHorizOutlinedIcon from '@mui/icons-material/MoreHorizOutlined';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import StyledMenu from './StyledMenu';

const { useState } = React

export interface Props {
    session: Session
    selected: boolean
    switchMe: () => void
    deleteMe: () => void
    copyMe: () => void
    editMe: () => void
    dragHandleProps?: any
    isDragging?: boolean
}

export default function SessionItem(props: Props) {
    const { session, selected, switchMe, deleteMe, copyMe, editMe, dragHandleProps, isDragging } = props
    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault()
        setAnchorEl(event.currentTarget);
    };
    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleClickWrapper = (e: React.MouseEvent) => {
        if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    return (
        <MenuItem
            key={session.id}
            selected={selected && !isDragging}
            onClick={switchMe}
            {...(dragHandleProps || {})}
            style={{ 
                cursor: isDragging ? 'grabbing' : (dragHandleProps ? 'grab' : 'pointer'),
                ...(isDragging ? { opacity: 0.5 } : {}),
                userSelect: 'none'
            }}
            onPointerDown={handleClickWrapper}
        >
            <ListItemIcon {...(dragHandleProps || {})}>
                <IconButton {...(dragHandleProps || {})}><ChatBubbleOutlineOutlinedIcon fontSize="small" /></IconButton>
            </ListItemIcon>
            <ListItemText>
                <Typography variant="inherit" noWrap>
                    {session.name}
                </Typography>
            </ListItemText>
            <IconButton onClick={handleClick}>
                <MoreHorizOutlinedIcon />
            </IconButton>
            <StyledMenu
                MenuListProps={{
                    'aria-labelledby': 'long-button',
                }}
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
            >
                <MenuItem key={session.id + 'edit'} onClick={() => {
                    editMe()
                    handleClose()
                }} disableRipple>
                    <EditIcon />
                    Rename
                </MenuItem>

                <MenuItem key={session.id + 'copy'} onClick={() => {
                    copyMe()
                    handleClose()
                }} disableRipple>
                    <FileCopyIcon fontSize='small' />
                    Copy
                </MenuItem>

                <Divider sx={{ my: 0.5 }} />

                <MenuItem key={session.id + 'del'} onClick={() => {
                    setAnchorEl(null)
                    handleClose()
                    deleteMe()
                }} disableRipple
                >
                    <DeleteForeverIcon />
                    Delete
                </MenuItem>

            </StyledMenu>
        </MenuItem>
    )
}
