import React, { useEffect } from 'react'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { Box, Grid } from '@mui/material'
import SettingDialog from './pages/SettingDialog'
import ChatConfigWindow from './pages/ChatConfigWindow'
import CleanWidnow from './pages/CleanWindow'
import AboutWindow from './pages/AboutWindow'
import useAppTheme from './hooks/useAppTheme'
import CopilotWindow from './pages/CopilotWindow'
import { useI18nEffect } from './hooks/useI18nEffect'
import Toasts from './components/Toasts'
import { useSystemLanguageWhenInit } from './hooks/useDefaultSystemLanguage'
import MainPane from './MainPane'
import { useAtom, useAtomValue } from 'jotai'
import * as atoms from './stores/atoms'
import Sidebar from './Sidebar'
import * as premiumActions from './stores/premiumActions'
import { useInactivityMonitor } from '@/inactiveMonitor'
import SyncDialog from '@/components/SyncDialog'
import platform from '@/packages/platform'
import { synchronizeErrorMessage, synchronizeShowLoading } from './stores/atoms'

function Main() {
    const spellCheck = useAtomValue(atoms.spellCheckAtom)
    const [openSettingWindow, setOpenSettingWindow] = useAtom(atoms.openSettingDialogAtom)
    const [setting,] = useAtom(atoms.settingsAtom);
    const [,setLoading] = useAtom(synchronizeShowLoading);
    const [, setSyncErrMsg] = useAtom(synchronizeErrorMessage);
    const [openAboutWindow, setOpenAboutWindow] = React.useState(false)
    const [openCopilotWindow, setOpenCopilotWindow] = React.useState(false)
    const [openSidebar, setOpenSidebar] = React.useState(false)
    useInactivityMonitor()

    const handleExecuteSync = async () => {
        if (setting?.syncConfig?.onAppLaunch){
            setLoading(true);
            try {
                await platform.executeSync()
            }catch (e: any) {
                console.error(e)
                setSyncErrMsg(e)
            }
        }
    }

    useEffect(() => {
        handleExecuteSync().then()
    }, [])

    return (
        <Box className="box-border App" spellCheck={spellCheck}>
            <Grid container className="h-full">
                <Sidebar
                    openCopilotWindow={() => setOpenCopilotWindow(true)}
                    openAboutWindow={() => setOpenAboutWindow(true)}
                    setOpenSettingWindow={setOpenSettingWindow}
                    toggleSidebar={setOpenSidebar}
                    sidebarOpen={openSidebar}
                />
                <MainPane toggleSidebar={() => setOpenSidebar(true)} />
            </Grid>
            <SyncDialog />
            <SettingDialog
                open={!!openSettingWindow}
                targetTab={openSettingWindow || undefined}
                close={() => setOpenSettingWindow(null)}
            />
            <AboutWindow open={openAboutWindow} close={() => setOpenAboutWindow(false)} />
            <ChatConfigWindow />
            <CleanWidnow />
            <CopilotWindow open={openCopilotWindow} close={() => setOpenCopilotWindow(false)} />
            <Toasts />
        </Box>
    )
}

export default function App() {
    useI18nEffect()
    premiumActions.useAutoValidate()
    useSystemLanguageWhenInit()
    const theme = useAppTheme()
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Main />
        </ThemeProvider>
    )
}
