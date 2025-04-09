import { useState, useEffect, useRef } from 'react';
import { Box, IconButton, Fade } from '@mui/material';
import * as scrollActions from '@/stores/scrollActions'
import { KeyboardDoubleArrowDown } from '@mui/icons-material';
import { useAtom } from 'jotai/index'
import * as atoms from '@/stores/atoms'

export default function ScrollToBottomButton ()  {
    const [visible, setVisible] = useState(false);
    const [messageListRef, setMessageListRef] = useAtom(atoms.messageListRefAtom)

    const checkScrollPosition = () => {
        if (messageListRef?.current) {
            const { scrollTop, scrollHeight, clientHeight } = messageListRef.current;
            const bottomThreshold = 100;
            const distanceFromBottom = scrollHeight - (scrollTop + clientHeight)
            setVisible(distanceFromBottom >= bottomThreshold)
        }
    };

    const scrollToBottom = () => {
        scrollActions.scrollToBottom();
    };

    useEffect(() => {
        if (!messageListRef?.current) return;
        const timer = setInterval(checkScrollPosition, 500);
        return () => clearInterval(timer);
    }, [messageListRef]);

    return (
        <Fade in={visible}>
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
