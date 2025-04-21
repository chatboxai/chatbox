import { Box } from '@mui/material'
import * as atoms from './stores/atoms'
import { useAtomValue } from 'jotai'
import InputBox from './components/InputBox'
import MessageList from './components/MessageList'
import ScrollToBottomButton from './components/ScrollToBottomButton'
import { drawerWidth } from './Sidebar'
import Header from './components/Header'
import { ModelSelectDialog } from '@/components/ModelSelectDialog'
import React, { useEffect, useState } from 'react'
import { useAtom } from 'jotai/index'
import { settingsAtom } from './stores/atoms'
import { Settings } from '../shared/types'
import { useSwipeable } from 'react-swipeable'

interface Props {
    toggleSidebar: (newOpen: boolean) => void
}

export default function MainPane(props: Props) {
    const currentSession = useAtomValue(atoms.currentSessionAtom)
    const [openModelSelect, setOpenModelSelect] = useState(false)
    const [settings, setSettings] = useAtom(settingsAtom)
    const [settingsEdit, _setSettingsEdit] = React.useState<Settings>(settings)
    const setSettingsEdit = (updated: Settings) => {
        _setSettingsEdit(updated)
    }
    const scrollPositionCache = new WeakMap<HTMLElement, number>()
    function isElementOrParentsScrollable(element: HTMLElement | null): boolean {
        if (!element) return false
        let currentElement: HTMLElement | null = element
        while (currentElement) {
            const styles = window.getComputedStyle(currentElement)
            const overflowX = styles.getPropertyValue('overflow-x')
            if (
                (overflowX === 'auto' || overflowX === 'scroll') &&
                currentElement.scrollWidth > currentElement.clientWidth
            ) {
                // if it's scrollable however the scroll position is on the left most
                // return false hence it is still able to open the sidebar.
                const lastScrollLeft = scrollPositionCache.get(currentElement) ?? 0
                const currentScrollLeft = currentElement.scrollLeft
                scrollPositionCache.set(currentElement, currentScrollLeft)
                return !(lastScrollLeft >= 0 && currentScrollLeft === 0)
            }

            currentElement = currentElement.parentElement
            if (currentElement === document.body) break
        }

        return false
    }

    const swipeHandlers = useSwipeable({
        onSwipedRight: (eventData) => {
            if (eventData.event.target) {
                // ignore scrollable element.
                const d = isElementOrParentsScrollable(eventData.event.target as HTMLElement)
                if (d) return
            }
            props.toggleSidebar(true)
        },
        delta: 40,
        trackTouch: true,
    })

    useEffect(() => {
        _setSettingsEdit(settingsEdit)
    }, [settings])
    return (
        <Box
            className="h-full w-full"
            sx={{
                flexGrow: 1,
                height: '100%', // Add explicit height
                display: 'flex', // Ensure flex container
                flexDirection: 'column',
            }}
        >
            <div className="flex flex-col h-full">
                <Header toggleSidebar={props.toggleSidebar} toggleModelSelect={setOpenModelSelect} />
                <ModelSelectDialog
                    open={openModelSelect}
                    settings={settings}
                    onClose={() => setOpenModelSelect(false)}
                />
                <div className="flex-1 min-h-0" {...swipeHandlers}>
                    <div className="h-full overflow-y-auto">
                        <MessageList />
                    </div>
                </div>
                <div
                    style={{
                        position: 'relative',
                        marginTop: 'auto',
                        paddingTop: 10,
                    }}
                >
                    <ScrollToBottomButton />
                    <InputBox currentSessionId={currentSession.id} currentSessionType={currentSession.type || 'chat'} />
                </div>
            </div>
        </Box>
    )
}
