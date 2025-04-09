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
                <div className="flex-1 min-h-0">
                    <div className="h-full overflow-y-auto">
                        <MessageList />
                    </div>
                </div>
                <div style={{
                    position: 'relative',
                    marginTop: 'auto',
                    paddingTop: 10
                }}>
                    <ScrollToBottomButton />
                    <InputBox currentSessionId={currentSession.id} currentSessionType={currentSession.type || 'chat'} />
                </div>
            </div>
        </Box>
    )
}
