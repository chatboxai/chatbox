import { useState, useEffect, useRef } from 'react';
import { Box, IconButton, Fade } from '@mui/material';
import * as scrollActions from '@/stores/scrollActions'
import { KeyboardDoubleArrowDown } from '@mui/icons-material';
import { useAtom } from 'jotai/index'
import * as atoms from '@/stores/atoms'
import { StateSnapshot } from 'react-virtuoso'
import { showScrollToBottom } from '@/stores/atoms'

export default function ScrollToBottomButton ()  {
    const [showScrollToBottom, setShowScrollToBottom] = useAtom(atoms.showScrollToBottom)

    const scrollToBottom = () => {
        scrollActions.scrollToBottom('smooth');
    };

    return (
        <Fade in={showScrollToBottom}>
            <IconButton
                onClick={scrollToBottom}
                sx={{
                    position: 'absolute',
                    bottom: '100%',
                    right: 5,
                    zIndex: 9999,
                    backgroundColor: 'background.paper',
                    boxShadow: 2,
                    '&:hover': {
                        backgroundColor: 'action.hover'
                    }
                }}
            >
                <KeyboardDoubleArrowDown/>
            </IconButton>
        </Fade>
    );
};
