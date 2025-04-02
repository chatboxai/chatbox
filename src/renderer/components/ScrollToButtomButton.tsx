import { useState, useEffect, useRef } from 'react';
import { Box, IconButton, Fade } from '@mui/material';
import * as scrollActions from '@/stores/scrollActions'
import { KeyboardArrowDown } from '@mui/icons-material';
import { useAtom } from 'jotai/index'
import * as atoms from '@/stores/atoms'

export default function ScrollToBottomButton ()  {
    const [visible, setVisible] = useState(true);
    const [messageListRef, setMessageListRef] = useAtom(atoms.messageListRefAtom)

    // Get scroll container (body or custom element)
    // useEffect(() => {
        // if (messageListRef?.current) {
        //     messageListRef.current = document.documentElement;
        // }
    // }, []);

    // const checkScrollPosition = () => {
        // if (messageListRef?.current) { return;
        //
        // const { scrollTop, clientHeight, scrollHeight } = messageListRef.current;
        // const isNearBottom = scrollHeight - (scrollTop + clientHeight) > 100;
        // setVisible(isNearBottom);
    // };

    const scrollToBottom = () => {
        scrollActions.scrollToBottom();
    };

    // Listen to scroll events
    // useEffect(() => {
        // const current = messageListRef.current;
        // current?.addEventListener('scroll', checkScrollPosition);
        // return () => current?.removeEventListener('scroll', checkScrollPosition);
    // }, []);

    // Check initial position
    // useEffect(() => {
    //     const timer = setInterval(checkScrollPosition, 1000);
    //     return () => clearInterval(timer);
    // }, []);

    return (
        <Fade in={visible}>
            <IconButton
                onClick={scrollToBottom}
                sx={{
                    position: 'fixed',
                    bottom: 80,
                    right: 5,
                    zIndex: 0,
                    backgroundColor: 'background.paper',
                    boxShadow: 2,
                    '&:hover': {
                        backgroundColor: 'action.hover'
                    }
                }}
            >
                <KeyboardArrowDown />
            </IconButton>
        </Fade>
    );
};
