import { Box } from '@mui/material'
import * as atoms from './stores/atoms'
import { useAtomValue } from 'jotai'
import InputBox from './components/InputBox'
import MessageList from './components/MessageList'
import { drawerWidth } from './Sidebar'
import Header from './components/Header'

interface Props {
    toggleSidebar: (newOpen: boolean) => void
}

export default function MainPane(props: Props) {
    const currentSession = useAtomValue(atoms.currentSessionAtom)

    return (
        <Box
            className="h-full w-full"
            sx={{
                flexGrow: 1,
            }}
        >
            <div className="flex flex-col h-full">
                <Header toggleSidebar={props.toggleSidebar} />
                <MessageList />
                <InputBox currentSessionId={currentSession.id} currentSessionType={currentSession.type || 'chat'} />
            </div>
        </Box>
    )
}
